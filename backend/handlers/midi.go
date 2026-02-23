package handlers

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"sort"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ── MIDI request / chord-quality tables ──────────────────────────────────────

// MidiRequest is the JSON body for POST /api/midi.
type MidiRequest struct {
	Chords   []string   `json:"chords"   binding:"required"` // e.g. ["C","Am","F","G"]
	Tempo    int        `json:"tempo"`                       // BPM (default 120)
	Pattern  string     `json:"pattern"`                     // "whole","half","quarter","arpeggio-up","arpeggio-down","boom-chick","pop-strum","travis-picking","alberti-bass","triplet-arpeggio","pop-stabs","bossa-nova","reggae-skank","funk-16th","jazz-swing","rock-8th","let-it-be","stand-by-me","creep-arpeggio","twist-and-shout","blues-shuffle","sweet-home-alabama","stairway-arpeggio","hotel-california","wonderwall-strum","blackbird-pick","palm-mute-8th","off-beat-8th","country-alt-bass","pima-arpeggio","four-on-the-floor"
	Octave   int        `json:"octave"`                      // base octave 2–6 (default 4)
	Beats    int        `json:"beats"`                       // beats per chord (default 4)
	Frets    [][]string `json:"frets"`                       // per-chord fret positions (e.g. ["x","3","2","0","1","0"])
	OpenMidi []int      `json:"openMidi"`                    // open-string MIDI notes for the current instrument
}

// qualityIntervals maps the suffix after the root to semitone intervals.
var qualityIntervals = map[string][]int{
	"":      {0, 4, 7},
	"m":     {0, 3, 7},
	"7":     {0, 4, 7, 10},
	"maj7":  {0, 4, 7, 11},
	"m7":    {0, 3, 7, 10},
	"dim":   {0, 3, 6},
	"aug":   {0, 4, 8},
	"sus2":  {0, 2, 7},
	"sus4":  {0, 5, 7},
	"6":     {0, 4, 7, 9},
	"m6":    {0, 3, 7, 9},
	"add9":  {0, 4, 7, 14},
	"madd9": {0, 3, 7, 14},
}

// fretsToMidi converts fret positions + open-string MIDI tuning to a sorted,
// deduplicated slice of MIDI note bytes. Muted strings ("x") are skipped.
func fretsToMidi(frets []string, openMidi []int) []byte {
	var pitches []int
	for i, fv := range frets {
		if fv == "x" || i >= len(openMidi) {
			continue
		}
		fretNum, err := strconv.Atoi(fv)
		if err != nil {
			continue
		}
		pitches = append(pitches, openMidi[i]+fretNum)
	}
	sort.Ints(pitches)
	// Deduplicate unison pitches
	var result []byte
	seen := map[int]bool{}
	for _, p := range pitches {
		if !seen[p] {
			seen[p] = true
			result = append(result, byte(p))
		}
	}
	return result
}

// chordToMidi resolves a chord name (e.g. "C#m7") to a slice of MIDI note numbers.
func chordToMidi(chord string, baseOctave int) []byte {
	root := chordRootIndex(chord)
	if root == -1 {
		root = 0
	}
	suffix := chordSuffix(chord)
	intervals, ok := qualityIntervals[suffix]
	if !ok {
		intervals = qualityIntervals[""] // fallback to major
	}

	baseMidi := byte(12*(baseOctave+1)) + byte(root) // C4 = 60 when baseOctave=4
	notes := make([]byte, len(intervals))
	for i, iv := range intervals {
		notes[i] = baseMidi + byte(iv)
	}
	return notes
}

// ── SMF (Standard MIDI File) writer ─────────────────────────────────────────

const ticksPerQuarter = 480 // resolution

// varLen encodes a MIDI variable-length quantity.
func varLen(v uint32) []byte {
	if v < 0x80 {
		return []byte{byte(v)}
	}
	var buf [4]byte
	n := 0
	for tmp := v; tmp > 0; tmp >>= 7 {
		n++
	}
	for i := n - 1; i >= 0; i-- {
		b := byte((v >> (uint(i) * 7)) & 0x7F)
		if i > 0 {
			b |= 0x80
		}
		buf[n-1-i] = b
	}
	return buf[:n]
}

// noteOn/Off helpers
func noteOnEvent(delta uint32, ch, note, vel byte) []byte {
	out := varLen(delta)
	out = append(out, 0x90|ch, note, vel)
	return out
}

func noteOffEvent(delta uint32, ch, note byte) []byte {
	out := varLen(delta)
	out = append(out, 0x80|ch, note, 0)
	return out
}

func tempoEvent(bpm int) []byte {
	uspq := uint32(60_000_000 / bpm) // microseconds per quarter note
	return []byte{
		0x00,       //delta=0
		0xFF, 0x51, 0x03,
		byte(uspq >> 16), byte(uspq >> 8), byte(uspq),
	}
}

func endOfTrack() []byte {
	return []byte{0x00, 0xFF, 0x2F, 0x00}
}

// buildTrack constructs the MTrk data bytes (without the "MTrk"+length header).
func buildTrack(req MidiRequest) []byte {
	var trk []byte

	// Tempo meta-event
	trk = append(trk, tempoEvent(req.Tempo)...)

	beatTicks := uint32(ticksPerQuarter) // ticks per beat
	chordTicks := beatTicks * uint32(req.Beats)

	for ci, chordName := range req.Chords {
		// Use real fret positions when available, fall back to chord-quality intervals.
		var notes []byte
		if ci < len(req.Frets) && len(req.OpenMidi) > 0 {
			notes = fretsToMidi(req.Frets[ci], req.OpenMidi)
		}
		if len(notes) == 0 {
			notes = chordToMidi(chordName, req.Octave)
		}
		switch req.Pattern {

		case "half":
			// Two block chords per chord slot (each = beats/2)
			halfTicks := chordTicks / 2
			for rep := 0; rep < 2; rep++ {
				for j, n := range notes {
					var d uint32
					if j == 0 {
						d = 0
					}
					if rep == 1 && j == 0 {
						d = 0 // already released prior notes at the right time
					}
					trk = append(trk, noteOnEvent(d, 0, n, 100)...)
				}
				for j, n := range notes {
					var d uint32
					if j == 0 {
						d = halfTicks
					}
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
			}

		case "quarter":
			// Block chord on every beat
			for beat := 0; beat < req.Beats; beat++ {
				for j, n := range notes {
					var d uint32
					if j == 0 && beat > 0 {
						d = 0 // notes-off happened at the gap
					}
					trk = append(trk, noteOnEvent(d, 0, n, 100)...)
				}
				for j, n := range notes {
					var d uint32
					if j == 0 {
						d = beatTicks
					}
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
			}

		case "arpeggio-up":
			// Play notes one at a time, ascending
			noteDur := chordTicks / uint32(len(notes))
			for _, n := range notes {
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(noteDur, 0, n)...)
			}

		case "arpeggio-down":
			// Play notes one at a time, descending
			noteDur := chordTicks / uint32(len(notes))
			for i := len(notes) - 1; i >= 0; i-- {
				trk = append(trk, noteOnEvent(0, 0, notes[i], 100)...)
				trk = append(trk, noteOffEvent(noteDur, 0, notes[i])...)
			}

		case "boom-chick":
			// Beat 1: bass note (root, octave below), Beats 2-4: upper chord
			bassNote := notes[0] - 12
			upperNotes := notes[1:]
			if len(upperNotes) == 0 {
				upperNotes = notes
			}
			// Beat 1: bass
			trk = append(trk, noteOnEvent(0, 0, bassNote, 100)...)
			trk = append(trk, noteOffEvent(beatTicks, 0, bassNote)...)
			// Remaining beats: chord stabs
			for beat := 1; beat < req.Beats; beat++ {
				for j, n := range upperNotes {
					var d uint32
					if j > 0 {
						d = 0
					}
					trk = append(trk, noteOnEvent(d, 0, n, 90)...)
				}
				for j, n := range upperNotes {
					var d uint32
					if j == 0 {
						d = beatTicks
					}
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
			}

		case "pop-strum":
			// D  D  U  D  U  pattern across chord duration (eighth notes)
			eighthTicks := beatTicks / 2
			// Pattern: down(8th), down(8th), up(8th), down(8th), up(8th), rest 3 eighths
			strumPattern := []struct {
				active bool
				up     bool
				vel    byte
			}{
				{true, false, 100}, {true, false, 90}, {true, true, 80}, {true, false, 100}, {true, true, 80},
				{false, false, 0}, {false, false, 0}, {false, false, 0},
			}
			totalEighths := int(chordTicks / eighthTicks)
			for ei := 0; ei < totalEighths; ei++ {
				pi := ei % len(strumPattern)
				sp := strumPattern[pi]

				if sp.active {
					// For "up" strum, play notes in reverse order with slight velocity
					orderedNotes := make([]byte, len(notes))
					if sp.up {
						for k := 0; k < len(notes); k++ {
							orderedNotes[k] = notes[len(notes)-1-k]
						}
					} else {
						copy(orderedNotes, notes)
					}
					for j, n := range orderedNotes {
						var d uint32
						if j > 0 {
							d = 0
						}
						trk = append(trk, noteOnEvent(d, 0, n, sp.vel)...)
					}
					for j, n := range orderedNotes {
						var d uint32
						if j == 0 {
							d = eighthTicks
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "travis-picking":
			// Alternating bass with syncopated treble
			eighthTicks := beatTicks / 2
			totalEighths := int(chordTicks / eighthTicks)
			for ei := 0; ei < totalEighths; ei++ {
				var n byte
				var vel byte = 100
				if ei%2 == 0 { // Downbeat: Thumb
					if (ei/2)%2 == 0 {
						n = notes[0] // Root
					} else {
						if len(notes) > 1 {
							n = notes[1] // Fifth or second bass note
						} else {
							n = notes[0]
						}
					}
				} else { // Upbeat: Finger
					n = notes[len(notes)-1] // Highest note
					vel = 80
				}
				trk = append(trk, noteOnEvent(0, 0, n, vel)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "alberti-bass":
			// 1-5-3-5 pattern (classic accompaniment)
			eighthTicks := beatTicks / 2
			totalEighths := int(chordTicks / eighthTicks)
			for ei := 0; ei < totalEighths; ei++ {
				var n byte
				switch ei % 4 {
				case 0:
					n = notes[0]
				case 1, 3:
					if len(notes) > 2 {
						n = notes[2]
					} else if len(notes) > 1 {
						n = notes[1]
					} else {
						n = notes[0]
					}
				case 2:
					if len(notes) > 1 {
						n = notes[1]
					} else {
						n = notes[0]
					}
				}
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "triplet-arpeggio":
			// 3 notes per beat
			tripletTicks := beatTicks / 3
			totalTriplets := int(chordTicks / tripletTicks)
			for ti := 0; ti < totalTriplets; ti++ {
				n := notes[ti%len(notes)]
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(tripletTicks, 0, n)...)
			}

		case "pop-stabs":
			// Syncopated block chords
			eighthTicks := beatTicks / 2
			// Pattern (eighth notes): X . X X . X . . (Common syncopation)
			pattern := []bool{true, false, true, true, false, true, false, false}
			totalEighths := int(chordTicks / eighthTicks)
			for ei := 0; ei < totalEighths; ei++ {
				if pattern[ei%len(pattern)] {
					for j, n := range notes {
						var d uint32 = 0
						if j == 0 {
							d = 0
						}
						trk = append(trk, noteOnEvent(d, 0, n, 100)...)
					}
					for j, n := range notes {
						var d uint32 = 0
						if j == 0 {
							d = eighthTicks
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "bossa-nova":
			// Bass: 1, 3. Chords: syncopated
			eighthTicks := beatTicks / 2
			totalEighths := int(chordTicks / eighthTicks)
			// Chord pattern: X . X . . X . X (across 8 eighths)
			chordPattern := []bool{true, false, true, false, false, true, false, true}
			for ei := 0; ei < totalEighths; ei++ {
				d := uint32(0)
				// Bass on 1 and 3 (eighth 0 and 4)
				if ei%4 == 0 {
					bassNote := notes[0] - 12
					trk = append(trk, noteOnEvent(d, 0, bassNote, 100)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, bassNote)...)
					d = 0
				}
				// Chords
				if chordPattern[ei%8] {
					for _, n := range notes {
						trk = append(trk, noteOnEvent(d, 0, n, 90)...)
						d = 0
					}
					for j, n := range notes {
						if j == 0 {
							d = eighthTicks
						} else {
							d = 0
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
						d = 0
					}
				} else if ei%4 != 0 {
					// Silence for this eighth
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "reggae-skank":
			// Staccato on 2 and 4
			for beat := 0; beat < req.Beats; beat++ {
				if beat%2 == 1 { // Beats 2 and 4
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 110)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 {
							d = beatTicks / 4 // Very staccato
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
					// Wait for rest of beat
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(3*beatTicks/4, 0, 0)...)
				} else {
					// Silence for beats 1 and 3
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(beatTicks, 0, 0)...)
				}
			}

		case "funk-16th":
			// 16th note syncopation
			sixteenthTicks := beatTicks / 4
			totalSixteenths := int(chordTicks / sixteenthTicks)
			// X . . X . . X . (Common 16th funk)
			pattern := []bool{true, false, false, true, false, false, true, false}
			for si := 0; si < totalSixteenths; si++ {
				if pattern[si%8] {
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 110)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 {
							d = sixteenthTicks
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(sixteenthTicks, 0, 0)...)
				}
			}

		case "jazz-swing":
			// Charleston rhythm: 1, 2-and
			eighthTicks := beatTicks / 2
			totalEighths := int(chordTicks / eighthTicks)
			pattern := []bool{true, false, false, true, false, false, false, false}
			for ei := 0; ei < totalEighths; ei++ {
				if pattern[ei%8] {
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 100)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 {
							d = eighthTicks
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "rock-8th":
			// Driving 8th notes
			eighthTicks := beatTicks / 2
			totalEighths := int(chordTicks / eighthTicks)
			for ei := 0; ei < totalEighths; ei++ {
				for _, n := range notes {
					trk = append(trk, noteOnEvent(0, 0, n, 110)...)
				}
				for j, n := range notes {
					d := uint32(0)
					if j == 0 {
						d = eighthTicks
					}
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
			}

		case "let-it-be":
			// Piano ballad style: Quarters on 1, 2, 3, 4 with a subtle octaved root pulse
			for beat := 0; beat < req.Beats; beat++ {
				// Play chord
				for _, n := range notes {
					trk = append(trk, noteOnEvent(0, 0, n, 95)...)
				}
				// Beat 1 and 3: add a lower octave root for depth
				if beat%2 == 0 {
					trk = append(trk, noteOnEvent(0, 0, notes[0]-12, 100)...)
				}
				// Release all
				trk = append(trk, noteOffEvent(beatTicks, 0, notes[0]-12)...)
				for _, n := range notes {
					trk = append(trk, noteOffEvent(0, 0, n)...)
				}
			}

		case "stand-by-me":
			// Classic 50s bass line + backbeat stabs
			bassNote := notes[0] - 12
			eighthTicks := beatTicks / 2
			// Pattern (8 eighths): Bass(1), ., Bass(2-and), ., Stab(3), ., Stab(4), .
			pattern := []int{1, 0, 1, 0, 2, 0, 2, 0} // 1=Bass, 2=Stab
			for ei := 0; ei < 8; ei++ {
				p := pattern[ei%len(pattern)]
				if p == 1 { // Bass
					trk = append(trk, noteOnEvent(0, 0, bassNote, 110)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, bassNote)...)
				} else if p == 2 { // Stab
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 90)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 {
							d = eighthTicks
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else { // Rest
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "creep-arpeggio":
			// Slow 8th note arpeggio: 1 2 3 4 5 6 7 8
			eighthTicks := beatTicks / 2
			for ei := 0; ei < 8; ei++ {
				n := notes[ei%len(notes)]
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "twist-and-shout":
			// Classic rock strum: D . D U . U D U (8th notes)
			eighthTicks := beatTicks / 2
			strumPattern := []struct {
				active bool
				up     bool
			}{
				{true, false}, {false, false}, {true, false}, {true, true},
				{false, false}, {true, true}, {true, false}, {true, true},
			}
			for ei := 0; ei < 8; ei++ {
				sp := strumPattern[ei%8]
				if sp.active {
					ordered := notes
					if sp.up {
						ordered = make([]byte, len(notes))
						for k := 0; k < len(notes); k++ {
							ordered[k] = notes[len(notes)-1-k]
						}
					}
					for _, n := range ordered {
						trk = append(trk, noteOnEvent(0, 0, n, 105)...)
					}
					for j, n := range ordered {
						d := uint32(0)
						if j == 0 {
							d = eighthTicks
						}
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "blues-shuffle":
			// Swung eighth notes: long-short (triplet feel)
			longTicks := (beatTicks * 2) / 3
			shortTicks := beatTicks / 3
			for beat := 0; beat < req.Beats; beat++ {
				// Downbeat (long)
				for _, n := range notes {
					trk = append(trk, noteOnEvent(0, 0, n, 110)...)
				}
				for j, n := range notes {
					d := uint32(0)
					if j == 0 {
						d = longTicks
					}
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
				// Upbeat (short)
				for _, n := range notes {
					trk = append(trk, noteOnEvent(0, 0, n, 90)...)
				}
				for j, n := range notes {
					d := uint32(0)
					if j == 0 {
						d = shortTicks
					}
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
			}

		case "sweet-home-alabama":
			// D-C-G style syncopated picking: Bass-Bass-Upper-Bass-Upper (8th notes)
			eighthTicks := beatTicks / 2
			bassNote := notes[0]
			for ei := 0; ei < 8; ei++ {
				var n byte
				var vel byte = 100
				switch ei % 8 {
				case 0, 1, 3: // Bass
					n = bassNote
				case 2, 4, 5, 6, 7: // Upper
					n = notes[len(notes)-1] // High note
					if ei > 4 {
						n = notes[len(notes)-2] // alternate
					}
					vel = 90
				}
				trk = append(trk, noteOnEvent(0, 0, n, vel)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "stairway-arpeggio":
			// Fingerstyle ascending: Bass-T1-T2-T3-T2-T1 (8th note triplets feel)
			eighthTicks := beatTicks / 2
			for ei := 0; ei < 8; ei++ {
				var n byte
				switch ei % 8 {
				case 0: n = notes[0] // Bass
				case 1: n = notes[1]
				case 2: n = notes[2]
				case 3: n = notes[len(notes)-1]
				case 4: n = notes[len(notes)-2]
				case 5: n = notes[1]
				case 6: n = notes[2]
				case 7: n = notes[0]
				}
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "hotel-california":
			// 8th note arpeggio: 1 3 2 4 1 3 2 4 (Spanish/Classic feel)
			eighthTicks := beatTicks / 2
			for ei := 0; ei < 8; ei++ {
				var n byte
				idx := 0
				switch ei % 4 {
				case 0: idx = 0
				case 1: idx = 2
				case 2: idx = 1
				case 3: idx = 3
				}
				if idx >= len(notes) { idx = len(notes)-1 }
				n = notes[idx]
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "wonderwall-strum":
			// Syncopated 16th strum: D . D . D U D . D . D U D U D U
			sixteenthTicks := beatTicks / 4
			pattern := []bool{true, false, true, false, true, true, true, false, true, false, true, true, true, true, true, true}
			for si := 0; si < 16; si++ {
				if pattern[si] {
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 100)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 { d = sixteenthTicks }
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(sixteenthTicks, 0, 0)...)
				}
			}

		case "blackbird-pick":
			// Bass + high note pluck, then rhythmic filler
			eighthTicks := beatTicks / 2
			for ei := 0; ei < 8; ei++ {
				if ei % 2 == 0 {
					// Pluck Bass + High
					trk = append(trk, noteOnEvent(0, 0, notes[0], 110)...)
					trk = append(trk, noteOnEvent(0, 0, notes[len(notes)-1], 100)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, notes[0])...)
					trk = append(trk, noteOffEvent(0, 0, notes[len(notes)-1])...)
				} else {
					// Filler
					trk = append(trk, noteOnEvent(0, 0, notes[1%len(notes)], 80)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, notes[1%len(notes)])...)
				}
			}

		case "palm-mute-8th":
			// Constant 8th notes, short duration (staccato)
			eighthTicks := beatTicks / 2
			for ei := 0; ei < 8; ei++ {
				for _, n := range notes {
					trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				}
				for j, n := range notes {
					d := uint32(0)
					if j == 0 { d = eighthTicks / 2 }
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
				// rest of eighth
				trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
				trk = append(trk, noteOffEvent(eighthTicks/2, 0, 0)...)
			}

		case "off-beat-8th":
			// 1 & 2 & 3 & 4 & - play only on the '&'
			eighthTicks := beatTicks / 2
			for ei := 0; ei < 8; ei++ {
				if ei % 2 == 1 {
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 100)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 { d = eighthTicks }
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				} else {
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
				}
			}

		case "country-alt-bass":
			// Bass(1), Strum(2), Bass(3-Fifth), Strum(4)
			bassRoot := notes[0]
			bassFifth := notes[0] + 7 // Default 5th
			if len(notes) > 2 {
				bassFifth = notes[2] // Use actual 5th if available
			}
			if bassFifth > 60 { bassFifth -= 12 } // Keep bass low

			for beat := 0; beat < 4; beat++ {
				if beat == 0 {
					// Root bass
					trk = append(trk, noteOnEvent(0, 0, bassRoot-12, 110)...)
					trk = append(trk, noteOffEvent(beatTicks, 0, bassRoot-12)...)
				} else if beat == 2 {
					// Fifth bass
					trk = append(trk, noteOnEvent(0, 0, bassFifth-12, 110)...)
					trk = append(trk, noteOffEvent(beatTicks, 0, bassFifth-12)...)
				} else {
					// Strum
					for _, n := range notes {
						trk = append(trk, noteOnEvent(0, 0, n, 90)...)
					}
					for j, n := range notes {
						d := uint32(0)
						if j == 0 { d = beatTicks }
						trk = append(trk, noteOffEvent(d, 0, n)...)
					}
				}
			}

		case "pima-arpeggio":
			// Classic fingerstyle: P-i-m-a-m-i (8th notes)
			eighthTicks := beatTicks / 2
			pimaIdxs := []int{0, 1, 2, len(notes)-1, 2, 1, 0, 1}
			for ei := 0; ei < 8; ei++ {
				idx := pimaIdxs[ei % 8]
				if idx >= len(notes) { idx = len(notes)-1 }
				n := notes[idx]
				trk = append(trk, noteOnEvent(0, 0, n, 100)...)
				trk = append(trk, noteOffEvent(eighthTicks, 0, n)...)
			}

		case "four-on-the-floor":
			// Consistent quarter notes with pulse on 1 and 3
			for beat := 0; beat < 4; beat++ {
				vel := byte(90)
				if beat % 2 == 0 { vel = 110 }
				for _, n := range notes {
					trk = append(trk, noteOnEvent(0, 0, n, vel)...)
				}
				for j, n := range notes {
					d := uint32(0)
					if j == 0 { d = beatTicks }
					trk = append(trk, noteOffEvent(d, 0, n)...)
				}
			}

		default: // "whole" — one block chord for the entire duration
			for j, n := range notes {
				var d uint32
				if j > 0 {
					d = 0
				}
				trk = append(trk, noteOnEvent(d, 0, n, 100)...)
			}
			for j, n := range notes {
				var d uint32
				if j == 0 {
					d = chordTicks
				}
				trk = append(trk, noteOffEvent(d, 0, n)...)
			}
		}
	}

	trk = append(trk, endOfTrack()...)
	return trk
}

// buildMidi returns a complete SMF format-0 MIDI file.
func buildMidi(req MidiRequest) []byte {
	trackData := buildTrack(req)

	var buf bytes.Buffer
	// ── MThd ──
	buf.WriteString("MThd")
	binary.Write(&buf, binary.BigEndian, uint32(6))  // header length
	binary.Write(&buf, binary.BigEndian, uint16(0))  // format 0
	binary.Write(&buf, binary.BigEndian, uint16(1))  // 1 track
	binary.Write(&buf, binary.BigEndian, uint16(ticksPerQuarter))

	// ── MTrk ──
	buf.WriteString("MTrk")
	binary.Write(&buf, binary.BigEndian, uint32(len(trackData)))
	buf.Write(trackData)

	return buf.Bytes()
}

// GenerateMidi handles POST /api/midi
func GenerateMidi(c *gin.Context) {
	var req MidiRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Defaults
	if req.Tempo <= 0 {
		req.Tempo = 120
	}
	if req.Octave < 2 || req.Octave > 6 {
		req.Octave = 4
	}
	if req.Beats <= 0 {
		req.Beats = 4
	}
	if req.Pattern == "" {
		req.Pattern = "quarter"
	}

	midi := buildMidi(req)

	c.Data(http.StatusOK, "audio/midi", midi)
}

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
	Pattern  string     `json:"pattern"`                     // "whole","half","quarter","arpeggio-up","arpeggio-down","boom-chick","pop-strum","travis-picking","alberti-bass","triplet-arpeggio","pop-stabs"
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
				up  bool
				vel byte
			}{
				{false, 100}, {false, 90}, {true, 80}, {false, 100}, {true, 80},
			}
			totalEighths := int(chordTicks / eighthTicks)
			for ei := 0; ei < totalEighths; ei++ {
				pi := ei % len(strumPattern)
				sp := strumPattern[pi]
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
					// Rest: just wait
					// In MIDI, we don't need an event for silence, but we need to track delta time.
					// However, our noteOff already moved us forward by eighthTicks.
					// If we don't play a note, we need to make sure the NEXT note starts at the right time.
					// Wait, the current logic of building track is a bit sequential with deltas.
					// Let's use a dummy note or just add to delta of next note.
					// Actually, the way it's written, we always append noteOn/Off.
					
					// To handle silence, we can just play a note with velocity 0 or just skip and adjust delta.
					// But the current helper functions noteOnEvent/noteOffEvent take delta.
					// Let's use a "silent" note or fix the delta logic.
					
					// Alternative: add a 0-velocity note or just use a placeholder to advance time.
					// Let's add a silent note (Note 0, velocity 0)
					trk = append(trk, noteOnEvent(0, 0, 0, 0)...)
					trk = append(trk, noteOffEvent(eighthTicks, 0, 0)...)
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

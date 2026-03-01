package handlers

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// ── chordRootIndex ────────────────────────────────────────────────────────

func TestChordRootIndex_NaturalNotes(t *testing.T) {
	cases := []struct {
		chord string
		want  int
	}{
		{"C", 0}, {"D", 2}, {"E", 4}, {"F", 5},
		{"G", 7}, {"A", 9}, {"B", 11},
	}
	for _, tc := range cases {
		got := chordRootIndex(tc.chord)
		if got != tc.want {
			t.Errorf("chordRootIndex(%q) = %d, want %d", tc.chord, got, tc.want)
		}
	}
}

func TestChordRootIndex_Sharps(t *testing.T) {
	cases := []struct {
		chord string
		want  int
	}{
		{"C#", 1}, {"D#", 3}, {"F#", 6}, {"G#", 8}, {"A#", 10},
		{"C#m7", 1}, {"F#maj7", 6},
	}
	for _, tc := range cases {
		got := chordRootIndex(tc.chord)
		if got != tc.want {
			t.Errorf("chordRootIndex(%q) = %d, want %d", tc.chord, got, tc.want)
		}
	}
}

func TestChordRootIndex_Flats(t *testing.T) {
	cases := []struct {
		chord string
		want  int
	}{
		{"Db", 1}, {"Eb", 3}, {"Gb", 6}, {"Ab", 8}, {"Bb", 10},
		{"Bbm", 10},
	}
	for _, tc := range cases {
		got := chordRootIndex(tc.chord)
		if got != tc.want {
			t.Errorf("chordRootIndex(%q) = %d, want %d", tc.chord, got, tc.want)
		}
	}
}

func TestChordRootIndex_Empty(t *testing.T) {
	if got := chordRootIndex(""); got != -1 {
		t.Errorf("chordRootIndex(\"\") = %d, want -1", got)
	}
}

// ── transposeChord ────────────────────────────────────────────────────────

func TestTransposeChord(t *testing.T) {
	cases := []struct {
		chord     string
		semitones int
		want      string
	}{
		{"C", 7, "G"},
		{"G", 5, "C"},
		{"B", 1, "C"},
		{"Am", 3, "Cm"},
		{"F#m7", 6, "Cm7"},
		{"Bb", 2, "C"},
	}
	for _, tc := range cases {
		got := transposeChord(tc.chord, tc.semitones)
		if got != tc.want {
			t.Errorf("transposeChord(%q, %d) = %q, want %q", tc.chord, tc.semitones, got, tc.want)
		}
	}
}

// ── getTransposition ──────────────────────────────────────────────────────

func TestGetTransposition(t *testing.T) {
	cases := []struct {
		from, to string
		want     int
	}{
		{"C", "G", 7},
		{"G", "C", 5},
		{"C", "C", 0},
		{"B", "C", 1},
		{"A", "A#", 1},
	}
	for _, tc := range cases {
		got := getTransposition(tc.from, tc.to)
		if got != tc.want {
			t.Errorf("getTransposition(%q, %q) = %d, want %d", tc.from, tc.to, got, tc.want)
		}
	}
}

// ── fretsToMidi ───────────────────────────────────────────────────────────

func TestFretsToMidi_Basic(t *testing.T) {
	// Standard guitar open E chord: x-2-2-1-0-0, openMidi = E2 tuning
	openMidi := []int{40, 45, 50, 55, 59, 64} // E2,A2,D3,G3,B3,E4
	frets := []string{"x", "2", "2", "1", "0", "0"}
	got := fretsToMidi(frets, openMidi)
	// Expected: A2+2=47(B2), D3+2=52(E3), G3+1=56(G#3), B3+0=59, E4+0=64
	want := []byte{47, 52, 56, 59, 64}
	if !bytes.Equal(got, want) {
		t.Errorf("fretsToMidi = %v, want %v", got, want)
	}
}

func TestFretsToMidi_MutedStrings(t *testing.T) {
	openMidi := []int{40, 45, 50, 55, 59, 64}
	frets := []string{"x", "x", "x", "x", "x", "x"}
	got := fretsToMidi(frets, openMidi)
	if len(got) != 0 {
		t.Errorf("fretsToMidi with all muted = %v, want empty", got)
	}
}

func TestFretsToMidi_OutOfRange(t *testing.T) {
	// Open MIDI values near the top of range — result must stay ≤ 127
	openMidi := []int{120}
	frets := []string{"10"} // 120+10 = 130 > 127, should be excluded
	got := fretsToMidi(frets, openMidi)
	for _, n := range got {
		if n > 127 {
			t.Errorf("fretsToMidi produced out-of-range MIDI note %d", n)
		}
	}
}

// ── chordToMidi ───────────────────────────────────────────────────────────

func TestChordToMidi_CMajor(t *testing.T) {
	got := chordToMidi("C", 4)
	// C4=60, E4=64, G4=67
	want := []byte{60, 64, 67}
	if !bytes.Equal(got, want) {
		t.Errorf("chordToMidi(C, 4) = %v, want %v", got, want)
	}
}

func TestChordToMidi_AMinor(t *testing.T) {
	got := chordToMidi("Am", 4)
	// A4=69, C5=72, E5=76
	want := []byte{69, 72, 76}
	if !bytes.Equal(got, want) {
		t.Errorf("chordToMidi(Am, 4) = %v, want %v", got, want)
	}
}

func TestChordToMidi_NoOverflow(t *testing.T) {
	// B8 + maj7 extension would push beyond 127; must be clamped
	got := chordToMidi("Bmaj7", 8)
	for _, n := range got {
		if n > 127 {
			t.Errorf("chordToMidi(Bmaj7, 8) produced out-of-range MIDI note %d", n)
		}
	}
}

func TestChordToMidi_UnknownChord(t *testing.T) {
	// Unknown chord falls back to major root-0; should not panic
	got := chordToMidi("ZZ", 4)
	if len(got) == 0 {
		t.Error("chordToMidi(ZZ, 4) returned empty slice")
	}
}

// ── noteAt / lowerOctave helpers ──────────────────────────────────────────

func TestNoteAt(t *testing.T) {
	notes := []byte{60, 64, 67}
	if noteAt(notes, 0) != 60 {
		t.Error("noteAt(notes, 0) should return 60")
	}
	if noteAt(notes, 3) != 60 { // wraps
		t.Error("noteAt(notes, 3) should wrap to 60")
	}
	if noteAt(notes, -1) != 67 { // negative wraps
		t.Error("noteAt(notes, -1) should wrap to 67")
	}
}

func TestLowerOctave(t *testing.T) {
	if lowerOctave(60) != 48 {
		t.Errorf("lowerOctave(60) = %d, want 48", lowerOctave(60))
	}
	if lowerOctave(11) != 11 { // would underflow, stays
		t.Errorf("lowerOctave(11) = %d, want 11", lowerOctave(11))
	}
	if lowerOctave(12) != 0 {
		t.Errorf("lowerOctave(12) = %d, want 0", lowerOctave(12))
	}
}

// ── buildMidi smoke tests ─────────────────────────────────────────────────

// validMidiHeader checks the first 14 bytes of a MIDI file are a valid MThd.
func validMidiHeader(t *testing.T, midi []byte) {
	t.Helper()
	if len(midi) < 14 {
		t.Fatalf("MIDI too short: %d bytes", len(midi))
	}
	if string(midi[0:4]) != "MThd" {
		t.Errorf("missing MThd signature, got %q", midi[0:4])
	}
	hdrLen := binary.BigEndian.Uint32(midi[4:8])
	if hdrLen != 6 {
		t.Errorf("MThd length = %d, want 6", hdrLen)
	}
	if string(midi[14:18]) != "MTrk" {
		t.Fatalf("missing MTrk signature")
	}
}

func TestBuildMidi_Quarter(t *testing.T) {
	req := MidiRequest{
		Chords:  []string{"C", "Am", "F", "G"},
		Tempo:   120,
		Pattern: "quarter",
		Octave:  4,
		Beats:   4,
	}
	midi := buildMidi(req)
	validMidiHeader(t, midi)
}

func TestBuildMidi_AllPatterns(t *testing.T) {
	chords := []string{"C", "G"}
	for pattern := range validPatterns {
		t.Run(pattern, func(t *testing.T) {
			req := MidiRequest{
				Chords:  chords,
				Tempo:   120,
				Pattern: pattern,
				Octave:  4,
				Beats:   4,
			}
			// Must not panic; must produce valid MIDI header
			midi := buildMidi(req)
			validMidiHeader(t, midi)
		})
	}
}

func TestBuildMidi_UnknownChord_NoPanic(t *testing.T) {
	// Unrecognised chord names must not cause a panic or empty output
	req := MidiRequest{
		Chords:  []string{"ZZZ", "C"},
		Tempo:   120,
		Pattern: "quarter",
		Octave:  4,
		Beats:   4,
	}
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("buildMidi panicked with unknown chord: %v", r)
		}
	}()
	midi := buildMidi(req)
	validMidiHeader(t, midi)
}

func TestBuildMidi_SingleChord(t *testing.T) {
	req := MidiRequest{
		Chords:  []string{"Em"},
		Tempo:   90,
		Pattern: "arpeggio-up",
		Octave:  4,
		Beats:   4,
	}
	midi := buildMidi(req)
	validMidiHeader(t, midi)
}

func TestBuildMidi_FretsMode(t *testing.T) {
	// Fret-mode: send actual guitar fret positions
	req := MidiRequest{
		Chords:   []string{"C"},
		Tempo:    120,
		Pattern:  "whole",
		Octave:   4,
		Beats:    4,
		OpenMidi: []int{40, 45, 50, 55, 59, 64},
		Frets:    [][]string{{"x", "3", "2", "0", "1", "0"}},
	}
	midi := buildMidi(req)
	validMidiHeader(t, midi)
}

// ── validPatterns map ─────────────────────────────────────────────────────

func TestValidPatterns_Count(t *testing.T) {
	// There should be exactly 31 patterns (matches the UI selector count)
	if len(validPatterns) != 31 {
		t.Errorf("validPatterns has %d entries, want 31", len(validPatterns))
	}
}

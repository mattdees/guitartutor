package models

// Instrument describes a string instrument supported by the app.
type Instrument struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Strings     int      `json:"strings"`
	StringNames []string `json:"stringNames"`
	Icon        string   `json:"icon"`
	DisplayType string   `json:"displayType"` // "fretboard" or "keyboard"
}

// Progression is a named chord progression.
type Progression struct {
	Name        string   `json:"name"`
	Chords      []string `json:"chords"`
	OriginalKey string   `json:"originalKey"`
	Description string   `json:"description"`
	Songs       []string `json:"songs"`
}

// ChordVariant is a single fingering for a chord.
// For fretboard instruments: Frets, Fingers, Position are used.
// For keyboard instruments (piano): Keys is used (note strings like "C4", "F#3").
type ChordVariant struct {
	Name     string   `json:"name"`
	Frets    []string `json:"frets,omitempty"`
	Fingers  []string `json:"fingers,omitempty"`
	Position int      `json:"position,omitempty"`
	Keys     []string `json:"keys,omitempty"` // piano: MIDI-style note names, e.g. "C4", "F#3"
}

// ChordDiagrams maps chord name → slice of variants.
type ChordDiagrams map[string][]ChordVariant

// BatchChordsRequest asks for diagrams for a list of chord names on one instrument.
type BatchChordsRequest struct {
	Instrument string   `json:"instrument" binding:"required"`
	Chords     []string `json:"chords" binding:"required"`
}

// BatchChordsResponse maps each requested chord name to its variants.
type BatchChordsResponse map[string][]ChordVariant

// TransposeRequest asks to transpose a list of chords from one key to another.
type TransposeRequest struct {
	FromKey string   `json:"from_key" binding:"required"`
	ToKey   string   `json:"to_key"   binding:"required"`
	Chords  []string `json:"chords"   binding:"required"`
}

// TransposedChord holds the original and transposed name of a single chord.
type TransposedChord struct {
	Original   string `json:"original"`
	Transposed string `json:"transposed"`
}

// TransposeResponse is the result of a batch transpose operation.
type TransposeResponse struct {
	Semitones int               `json:"semitones"`
	Results   []TransposedChord `json:"results"`
}

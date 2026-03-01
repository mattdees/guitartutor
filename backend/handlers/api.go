package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"guitartutor/backend/data"
	"guitartutor/backend/models"
)

var chromatic = []string{"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}

var flatToSharp = map[string]string{
	"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#",
}

// chordRootIndex returns the semitone index (0–11) of the root note of a chord name,
// or -1 if the root cannot be identified.
func chordRootIndex(chord string) int {
	if len(chord) == 0 {
		return -1
	}
	root := string(chord[0])
	if len(chord) > 1 && (chord[1] == '#' || chord[1] == 'b') {
		root += string(chord[1])
	}
	if sharp, ok := flatToSharp[root]; ok {
		root = sharp
	}
	for i, n := range chromatic {
		if n == root {
			return i
		}
	}
	return -1
}

// chordSuffix returns everything after the root note letter (and optional accidental).
func chordSuffix(chord string) string {
	if len(chord) == 0 {
		return ""
	}
	if len(chord) > 1 && (chord[1] == '#' || chord[1] == 'b') {
		return chord[2:]
	}
	return chord[1:]
}

// transposeChord shifts a chord name by semitones.
func transposeChord(chord string, semitones int) string {
	idx := chordRootIndex(chord)
	if idx == -1 {
		return chord
	}
	newIdx := ((idx+semitones)%12 + 12) % 12
	return chromatic[newIdx] + chordSuffix(chord)
}

// getTransposition returns the number of semitones from fromKey to toKey.
func getTransposition(fromKey, toKey string) int {
	from := -1
	to := -1
	for i, n := range chromatic {
		if n == fromKey {
			from = i
		}
		if n == toKey {
			to = i
		}
	}
	if from == -1 || to == -1 {
		return 0
	}
	return ((to - from) + 12) % 12
}

// loadChordDiagrams reads the embedded JSON for the given instrument key.
func loadChordDiagrams(instrument string) (models.ChordDiagrams, error) {
	// Sanitise: only allow known instrument names.
	allowed := map[string]bool{"guitar": true, "ukulele": true, "mandolin": true, "banjo": true, "piano": true}
	if !allowed[strings.ToLower(instrument)] {
		return nil, fmt.Errorf("unknown instrument: %s", instrument)
	}
	path := fmt.Sprintf("chords/%s.json", strings.ToLower(instrument))
	b, err := data.ChordsFS.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("could not read chord data for %s: %w", instrument, err)
	}
	var diagrams models.ChordDiagrams
	if err := json.Unmarshal(b, &diagrams); err != nil {
		return nil, fmt.Errorf("could not parse chord data for %s: %w", instrument, err)
	}
	return diagrams, nil
}

// GetInstruments returns the list of supported instruments.
func GetInstruments(c *gin.Context) {
	var instruments []models.Instrument
	if err := json.Unmarshal(data.InstrumentsJSON, &instruments); err != nil {
		log.Printf("error loading instruments: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load instruments"})
		return
	}
	c.JSON(http.StatusOK, instruments)
}

// GetProgressions returns all chord progressions.
func GetProgressions(c *gin.Context) {
	var progressions []models.Progression
	if err := json.Unmarshal(data.ProgressionsJSON, &progressions); err != nil {
		log.Printf("error loading progressions: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load progressions"})
		return
	}
	c.JSON(http.StatusOK, progressions)
}

// GetChords returns all chord diagrams for a single instrument.
func GetChords(c *gin.Context) {
	instrument := c.Param("instrument")
	diagrams, err := loadChordDiagrams(instrument)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, diagrams)
}

// BatchChords returns chord diagrams for a requested subset of chord names on one instrument.
func BatchChords(c *gin.Context) {
	var req models.BatchChordsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	diagrams, err := loadChordDiagrams(req.Instrument)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp := make(models.BatchChordsResponse)
	for _, chord := range req.Chords {
		if variants, ok := diagrams[chord]; ok {
			resp[chord] = variants
		} else {
			resp[chord] = []models.ChordVariant{}
		}
	}
	c.JSON(http.StatusOK, resp)
}

// Transpose performs a batch transposition of chord names from one key to another.
func Transpose(c *gin.Context) {
	var req models.TransposeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	semitones := getTransposition(req.FromKey, req.ToKey)
	results := make([]models.TransposedChord, len(req.Chords))
	for i, ch := range req.Chords {
		results[i] = models.TransposedChord{
			Original:   ch,
			Transposed: transposeChord(ch, semitones),
		}
	}
	c.JSON(http.StatusOK, models.TransposeResponse{
		Semitones: semitones,
		Results:   results,
	})
}

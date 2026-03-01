package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func newRouter() *gin.Engine {
	r := gin.New()
	r.GET("/api/instruments", GetInstruments)
	r.GET("/api/progressions", GetProgressions)
	r.POST("/api/transpose", Transpose)
	r.POST("/api/chords/batch", BatchChords)
	r.POST("/api/midi", GenerateMidi)
	return r
}

// ── /api/instruments ──────────────────────────────────────────────────────

func TestGetInstruments(t *testing.T) {
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/instruments", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/instruments = %d, want 200", w.Code)
	}
	var instruments []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &instruments); err != nil {
		t.Fatalf("could not decode instruments: %v", err)
	}
	if len(instruments) == 0 {
		t.Error("instruments list is empty")
	}
	// Each instrument must have a "key" field
	for _, inst := range instruments {
		if _, ok := inst["key"]; !ok {
			t.Errorf("instrument missing 'key' field: %v", inst)
		}
	}
}

// ── /api/progressions ─────────────────────────────────────────────────────

func TestGetProgressions(t *testing.T) {
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/progressions", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/progressions = %d, want 200", w.Code)
	}
	var progressions []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &progressions); err != nil {
		t.Fatalf("could not decode progressions: %v", err)
	}
	if len(progressions) == 0 {
		t.Error("progressions list is empty")
	}
}

// ── /api/transpose ────────────────────────────────────────────────────────

func TestTranspose_CtoG(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"from_key": "C",
		"to_key":   "G",
		"chords":   []string{"C", "Am", "F", "G"},
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/transpose", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("POST /api/transpose = %d, want 200; body: %s", w.Code, w.Body)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	results := resp["results"].([]interface{})
	if len(results) != 4 {
		t.Fatalf("expected 4 transposed chords, got %d", len(results))
	}
	// C → G (7 semitones up) should become G
	first := results[0].(map[string]interface{})
	if first["transposed"] != "G" {
		t.Errorf("transposed[0] = %v, want G", first["transposed"])
	}
}

func TestTranspose_SameKey(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"from_key": "C",
		"to_key":   "C",
		"chords":   []string{"C", "Dm7", "G"},
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/transpose", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("POST /api/transpose = %d, want 200", w.Code)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if int(resp["semitones"].(float64)) != 0 {
		t.Errorf("same-key transposition should have 0 semitones")
	}
}

// ── /api/chords/batch ─────────────────────────────────────────────────────

func TestBatchChords_Guitar(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"instrument": "guitar",
		"chords":     []string{"C", "G", "Am"},
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/chords/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("POST /api/chords/batch = %d, want 200; body: %s", w.Code, w.Body)
	}
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if _, ok := resp["C"]; !ok {
		t.Error("response missing 'C' key")
	}
}

func TestBatchChords_UnknownInstrument(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"instrument": "kazoo",
		"chords":     []string{"C"},
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/chords/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("unknown instrument should return 400, got %d", w.Code)
	}
}

// ── /api/midi ─────────────────────────────────────────────────────────────

func TestGenerateMidi_Basic(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"chords":  []string{"C", "G"},
		"tempo":   120,
		"pattern": "quarter",
		"octave":  4,
		"beats":   4,
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/midi", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("POST /api/midi = %d, want 200; body: %s", w.Code, w.Body)
	}
	if ct := w.Header().Get("Content-Type"); ct != "audio/midi" {
		t.Errorf("Content-Type = %q, want audio/midi", ct)
	}
	midi := w.Body.Bytes()
	if string(midi[0:4]) != "MThd" {
		t.Errorf("response is not a valid MIDI file")
	}
}

func TestGenerateMidi_EmptyChords(t *testing.T) {
	body, _ := json.Marshal(map[string]interface{}{
		"chords":  []string{},
		"tempo":   120,
		"pattern": "quarter",
		"octave":  4,
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/midi", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	// "chords" is required binding; empty slice should fail binding or be accepted
	// depending on validation. Either 400 or 200 with minimal MIDI is acceptable.
	// The important thing is it must not 500.
	if w.Code == http.StatusInternalServerError {
		t.Errorf("empty chords returned 500 (should be 400 or 200 with empty track)")
	}
}

func TestGenerateMidi_DefaultsApplied(t *testing.T) {
	// Omit optional fields; server should apply defaults and return 200
	body, _ := json.Marshal(map[string]interface{}{
		"chords": []string{"Am"},
	})
	r := newRouter()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/midi", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("POST /api/midi with defaults = %d, want 200; body: %s", w.Code, w.Body)
	}
}

func TestGenerateMidi_AllPatterns(t *testing.T) {
	for pattern := range validPatterns {
		t.Run(pattern, func(t *testing.T) {
			body, _ := json.Marshal(map[string]interface{}{
				"chords":  []string{"C", "Am"},
				"tempo":   120,
				"pattern": pattern,
				"octave":  4,
				"beats":   4,
			})
			r := newRouter()
			w := httptest.NewRecorder()
			req, _ := http.NewRequest("POST", "/api/midi", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Errorf("pattern %q returned %d, want 200; body: %s", pattern, w.Code, w.Body)
			}
		})
	}
}

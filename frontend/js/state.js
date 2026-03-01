// ── Application state ────────────────────────────────────────────────
// All mutable state lives here. Every module that needs to read or write
// state imports this object directly. Because ES modules are singletons,
// all imports receive the same reference.

export const state = {
    // ── Data loaded from API ──
    currentInstruments:   [],   // [{key, name, strings, stringNames, openMidi, icon, displayType}]
    currentProgressions:  [],   // [{name, chords, originalKey, description, songs}]

    // ── Current selections ──
    currentInstrument:    null, // active instrument object
    currentProgression:   null, // active progression object
    currentIndex:         -1,
    currentKey:           'C',
    currentChordDiagrams: {},   // chord → ChordVariant[]
    currentChordVariants: {},   // "{pos}-{chord}" → variantIndex (manual overrides)
    currentTransposed:    [],   // [{original, transposed}]
    preferredPosition:    0,    // 0 = any; >0 = target fret (guitar only)

    // ── Soundfont cache ──
    loadedSoundfonts: {},       // name → soundfont-player instrument

    // ── Playback state ──
    currentMidiNotes:     [],
    midiRefreshTimer:     null,
    audioCtx:             null,
    isPlaying:            false,
    isLooping:            false,
    scheduledNodes:       [],
    _audioUnlocked:       false,
    playbackTimer:        null,
    timelineAnimFrame:    null,
    playbackStartTime:    0,
    playbackChordDurSec:  0,

    // ── Sheet music cache ──
    lastParsedNotes:  [],
    sheetNoteData:    [],   // [{startSec, endSec, svgId}]
    sheetMeasureData: [],   // [{startSec, endSec, svgRectId}]
    lastSheetNotes:   [],
    lastSheetChords:  [],
    lastSheetDur:     0,
};

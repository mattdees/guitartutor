package data

import "embed"

//go:embed instruments.json
var InstrumentsJSON []byte

//go:embed progressions.json
var ProgressionsJSON []byte

//go:embed chords
var ChordsFS embed.FS

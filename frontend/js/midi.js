// ── MIDI file parser ─────────────────────────────────────────────────
// Pure function: takes an ArrayBuffer of a Standard MIDI File and returns
// an array of note objects with timing in seconds.

export function parseMidi(arrayBuffer) {
    const data  = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    let pos = 0;

    // MThd header
    pos = 8; // skip "MThd" + 4-byte length
    /*const format   =*/ data.getUint16(pos); pos += 2;
    /*const ntracks  =*/ data.getUint16(pos); pos += 2;
    const division = data.getUint16(pos); pos += 2;

    // MTrk chunk
    pos += 4; // skip "MTrk"
    const trkLen = data.getUint32(pos); pos += 4;
    const trkEnd = pos + trkLen;

    let tempo = 500000; // default 120 BPM in microseconds/quarter
    const events = [];
    let tickPos = 0;

    function readVarLen() {
        let val = 0;
        while (pos < trkEnd && pos < bytes.length) {
            const b = bytes[pos++];
            val = (val << 7) | (b & 0x7F);
            if (!(b & 0x80)) break;
        }
        return val;
    }

    while (pos < trkEnd && pos < bytes.length) {
        const delta = readVarLen();
        tickPos += delta;
        if (pos >= bytes.length) break;
        const status = bytes[pos++];

        if (status === 0xFF) {
            // Meta event
            if (pos >= bytes.length) break;
            const type = bytes[pos++];
            const len  = readVarLen();
            if (type === 0x51 && len === 3 && pos + 2 < bytes.length) {
                tempo = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
            }
            pos += len;
        } else if ((status & 0xF0) === 0x90) {
            // Note-on
            if (pos + 1 >= bytes.length) break;
            const note = bytes[pos++];
            const vel  = bytes[pos++];
            events.push({ tick: tickPos, note, velocity: vel, on: vel > 0 });
        } else if ((status & 0xF0) === 0x80) {
            // Note-off
            if (pos + 1 >= bytes.length) break;
            const note = bytes[pos++];
            pos++; // velocity (ignored)
            events.push({ tick: tickPos, note, velocity: 0, on: false });
        }
    }

    // Convert ticks → seconds
    const secPerTick = (tempo / 1_000_000) / division;
    const noteOns = {};
    const notes   = [];

    for (const evt of events) {
        const timeSec = evt.tick * secPerTick;
        if (evt.on) {
            if (!noteOns[evt.note]) noteOns[evt.note] = [];
            noteOns[evt.note].push({ time: timeSec, velocity: evt.velocity });
        } else {
            if (noteOns[evt.note]?.length > 0) {
                const start = noteOns[evt.note].shift();
                notes.push({
                    note:     evt.note,
                    start:    start.time,
                    duration: Math.max(0.05, timeSec - start.time),
                    velocity: start.velocity,
                });
            }
        }
    }
    return notes;
}

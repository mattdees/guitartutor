// ── API fetch wrappers ───────────────────────────────────────────────
// Pure functions — fetch data from the backend, return parsed JSON.
// No state mutations; callers are responsible for updating state.

async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
    }
    return res.json();
}

export async function fetchInstruments() {
    return apiFetch('/api/instruments');
}

export async function fetchProgressions() {
    return apiFetch('/api/progressions');
}

export async function transposeChords(fromKey, toKey, chords) {
    return apiFetch('/api/transpose', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from_key: fromKey, to_key: toKey, chords }),
    });
}

export async function fetchChordsBatch(instrument, chords) {
    return apiFetch('/api/chords/batch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ instrument, chords }),
    });
}

export async function postMidi(body) {
    const res = await fetch('/api/midi', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });
    if (!res.ok) throw new Error('MIDI generation failed');
    return res.arrayBuffer();
}

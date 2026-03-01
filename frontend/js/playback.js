// ── Playback logic ────────────────────────────────────────────────────────
import { state } from './state.js';
import { ensureAudioCtx, unlockAudio, loadSoundfont, synthNote } from './audio.js';
import { parseMidi } from './midi.js';
import { getHitStrings } from './patterns.js';
import { renderSheetMusic, midiToNoteName } from './sheet-music.js';
import { pickVariantByPosition } from './render.js';

// ── Active fret / string helpers ──────────────────────────────────────────
export function getActiveDiagramFrets(chordIdx) {
    const chord = state.currentTransposed[chordIdx]?.transposed;
    if (!chord) return null;
    const variants = state.currentChordDiagrams[chord] || [];
    const key = `${chordIdx}-${chord}`;
    const variantIdx = state.currentChordVariants[key] !== undefined
        ? state.currentChordVariants[key]
        : pickVariantByPosition(variants, state.preferredPosition);
    const variant = variants[variantIdx] || variants[0];
    return variant?.frets || null;
}

// ── MIDI fetch ────────────────────────────────────────────────────────────
export async function fetchMidiBuffer() {
    const chords  = state.currentTransposed.map(r => r.transposed);
    const tempo   = parseInt(document.getElementById('tempoSlider').value);
    const pattern = document.getElementById('patternSelect').value;
    const octave  = parseInt(document.getElementById('octaveSelect').value);

    const body = { chords, tempo, pattern, octave, beats: 4 };

    if (state.currentInstrument && state.currentInstrument.openMidi && state.currentInstrument.openMidi.length > 0) {
        body.openMidi = state.currentInstrument.openMidi;
        body.frets    = state.currentTransposed.map((_, i) => getActiveDiagramFrets(i) || []);
    }

    const res = await fetch('/api/midi', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    });

    if (!res.ok) {
        let message = `MIDI generation failed: ${res.status} ${res.statusText}`;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await res.json();
                if (data && typeof data.error === 'string' && data.error.trim()) {
                    message += ` - ${data.error}`;
                }
            } else {
                const text = await res.text();
                if (text && text.trim()) {
                    message += ` - ${text}`;
                }
            }
        } catch (_) {
            // Ignore parsing errors; fall back to basic status message.
        }
        throw new Error(message);
    }
    return res.arrayBuffer();
}

// ── MIDI refresh + sheet music rebuild ────────────────────────────────────
export async function refreshMidiAndSheetMusic(immediate = false) {
    if (!state.currentTransposed.length) return;

    try {
        const midiBuffer = await fetchMidiBuffer();
        const notes      = parseMidi(midiBuffer);
        state.currentMidiNotes = notes;
        state.lastParsedNotes  = notes;

        const tempo    = parseInt(document.getElementById('tempoSlider').value);
        state.playbackChordDurSec = 4 * (60 / tempo);
        const chordNames = state.currentTransposed.map(r => r.transposed);
        renderSheetMusic(notes, chordNames, state.playbackChordDurSec);

        if (state.isPlaying && immediate) {
            const loopDuration  = state.currentTransposed.length * state.playbackChordDurSec;
            const elapsed       = state.audioCtx.currentTime - state.playbackStartTime;
            const currentOffset = elapsed % loopDuration;

            silencePlayback();
            const newStartTime       = state.audioCtx.currentTime + 0.05;
            state.playbackStartTime  = newStartTime - currentOffset;
            startMidiPlayback(state.currentMidiNotes, state.playbackStartTime);
        }
    } catch (err) {
        console.error('MIDI refresh error:', err);
    }
}

// ── Silence all scheduled audio ───────────────────────────────────────────
export function silencePlayback() {
    if (state.playbackTimer) { clearTimeout(state.playbackTimer); state.playbackTimer = null; }
    const now = state.audioCtx ? state.audioCtx.currentTime : 0;
    Object.values(state.loadedSoundfonts).forEach(inst => {
        if (inst.stop) inst.stop(now + 0.01);
    });
    state.scheduledNodes.forEach(node => {
        try { if (node.stop) node.stop(now + 0.01); node.disconnect(); } catch (e) {}
    });
    state.scheduledNodes = [];
}

// ── Looping toggle ────────────────────────────────────────────────────────
export function toggleLooping() {
    state.isLooping = !state.isLooping;
    const btn = document.getElementById('loopBtn');
    btn.textContent = state.isLooping ? '🔁 Loop: On' : '🔁 Loop: Off';
    btn.classList.toggle('loop-active', state.isLooping);
}

// ── rAF animation loop ────────────────────────────────────────────────────
export function animatePlaybackVisuals() {
    if (!state.isPlaying || !state.audioCtx) return;

    const numChords    = state.currentTransposed.length;
    const loopDuration = numChords * state.playbackChordDurSec;

    let elapsed = state.audioCtx.currentTime - state.playbackStartTime;
    if (state.isLooping) {
        elapsed = elapsed % loopDuration;
        if (elapsed < 0) elapsed += loopDuration;
    }

    const activeIdx = elapsed < loopDuration
        ? Math.min(Math.floor(elapsed / state.playbackChordDurSec), numChords - 1)
        : -1;

    // Highlight active chord tile + diagram
    const chordEls   = document.querySelectorAll('.chord-wrapper .chord');
    const diagramEls = document.querySelectorAll('.chord-wrapper .chord-diagram');
    chordEls.forEach((el, i)   => el.classList.toggle('chord-playing',   i === activeIdx));
    diagramEls.forEach((el, i) => el.classList.toggle('diagram-playing', i === activeIdx));

    // Highlight individual strings being hit
    document.querySelectorAll('.string-hit').forEach(el => el.classList.remove('string-hit'));
    if (activeIdx >= 0) {
        const activeDiagram = document.querySelector(`.chord-diagram[data-chord-idx="${activeIdx}"]`);
        if (activeDiagram && !activeDiagram.classList.contains('piano-chord-diagram')) {
            const chordElapsed = elapsed - activeIdx * state.playbackChordDurSec;
            const pattern      = document.getElementById('patternSelect').value;
            const frets        = getActiveDiagramFrets(activeIdx);
            const hitStrings   = getHitStrings(chordElapsed, state.playbackChordDurSec, pattern, frets);
            hitStrings.forEach(s => {
                activeDiagram.querySelectorAll(`[data-string="${s}"]`).forEach(el => el.classList.add('string-hit'));
            });
        }
    }

    // Show currently-sounding note names under each diagram
    for (let i = 0; i < numChords; i++) {
        const lbl = document.getElementById(`pnl-${i}`);
        if (!lbl) continue;
        if (i === activeIdx) {
            const activeNotes = state.lastParsedNotes
                .filter(n => elapsed >= n.start && elapsed < n.start + n.duration)
                .map(n => midiToNoteName(n.note));
            const unique = [...new Set(activeNotes)];
            lbl.textContent = unique.length ? '\u266A ' + unique.join('  ') : '';
        } else {
            lbl.textContent = '';
        }
    }

    // Sheet music: highlight active notes and current measure
    state.sheetNoteData.forEach(nd => {
        const el = document.getElementById(nd.svgId);
        if (el) el.classList.toggle('sh-active', elapsed >= nd.startSec && elapsed < nd.endSec);
    });
    state.sheetMeasureData.forEach(md => {
        const el = document.getElementById(md.svgRectId);
        if (el) el.classList.toggle('sh-mh-active', elapsed >= md.startSec && elapsed < md.endSec);
    });

    if (state.isPlaying) {
        state.timelineAnimFrame = requestAnimationFrame(animatePlaybackVisuals);
    } else {
        // Playback stopped — clean up visuals
        chordEls.forEach(el => el.classList.remove('chord-playing'));
        diagramEls.forEach(el => el.classList.remove('diagram-playing'));
        document.querySelectorAll('.playing-notes-label').forEach(l => l.textContent = '');
        document.querySelectorAll('.string-hit').forEach(el => el.classList.remove('string-hit'));
        document.querySelectorAll('.sh-active').forEach(el => el.classList.remove('sh-active'));
        document.querySelectorAll('.sh-mh-active').forEach(el => el.classList.remove('sh-mh-active'));
        state.timelineAnimFrame = null;
    }
}

// ── Schedule MIDI playback ────────────────────────────────────────────────
export function startMidiPlayback(notes, startTime) {
    if (!state.isPlaying) return;

    const numChords    = state.currentTransposed.length;
    const loopDuration = numChords * state.playbackChordDurSec;
    const tone         = document.getElementById('toneSelect').value;
    const now          = state.audioCtx.currentTime;

    if (tone === 'synth') {
        for (const n of notes) {
            const scheduledTime = startTime + n.start;
            if (scheduledTime > now - 0.05) {
                synthNote(state.audioCtx, n.note, scheduledTime, n.duration, n.velocity);
            }
        }
    } else {
        const instrument = state.loadedSoundfonts[tone];
        if (instrument) {
            for (const n of notes) {
                const scheduledTime = startTime + n.start;
                if (scheduledTime > now - 0.05) {
                    const humanDelay = Math.random() * 0.015;
                    const humanVol   = (n.velocity / 127) * (0.85 + Math.random() * 0.15);
                    instrument.play(n.note, scheduledTime + humanDelay, {
                        duration: n.duration,
                        gain:     humanVol,
                    });
                }
            }
        }
    }

    state.playbackStartTime = startTime;

    if (!state.timelineAnimFrame) {
        animatePlaybackVisuals();
    }

    // Schedule next loop or stop
    const nextStartTime = startTime + loopDuration;
    const delayMs       = (nextStartTime - state.audioCtx.currentTime - 0.1) * 1000;

    state.playbackTimer = setTimeout(() => {
        if (state.isLooping && state.isPlaying) {
            startMidiPlayback(notes, nextStartTime);
        } else {
            state.playbackTimer = setTimeout(() => stopPlayback(), 100);
        }
    }, Math.max(0, delayMs));
}

// ── Stop playback ─────────────────────────────────────────────────────────
export function stopPlayback() {
    state.isPlaying = false;
    silencePlayback();

    const btn = document.getElementById('playBtn');
    btn.textContent = '▶ Play';
    btn.classList.remove('playing');

    if (state.timelineAnimFrame) {
        cancelAnimationFrame(state.timelineAnimFrame);
        state.timelineAnimFrame = null;
    }
    document.querySelectorAll('.sh-active').forEach(el => el.classList.remove('sh-active'));
    document.querySelectorAll('.sh-mh-active').forEach(el => el.classList.remove('sh-mh-active'));
}

// ── Toggle play / stop ────────────────────────────────────────────────────
export async function togglePlayback() {
    if (state.isPlaying) { stopPlayback(); return; }
    if (!state.currentTransposed.length) return;

    const btn = document.getElementById('playBtn');
    btn.classList.add('playing');
    state.isPlaying = true;

    try {
        ensureAudioCtx();
        unlockAudio();
        if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

        const tone = document.getElementById('toneSelect').value;
        if (tone !== 'synth') {
            btn.textContent = '⏳ Loading...';
            await loadSoundfont(tone);
        }
        btn.textContent = '⏹ Stop';

        await refreshMidiAndSheetMusic();

        const startTime = state.audioCtx.currentTime + 0.1;
        startMidiPlayback(state.currentMidiNotes, startTime);
    } catch (err) {
        console.error('Playback error:', err);
        stopPlayback();
    }
}

// ── MIDI download ─────────────────────────────────────────────────────────
export async function downloadMidi() {
    if (!state.currentTransposed.length) return;
    const midiBuffer = await fetchMidiBuffer();
    const blob = new Blob([midiBuffer], { type: 'audio/midi' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (state.currentProgression ? state.currentProgression.name : 'progression') + '.mid';
    a.click();
    URL.revokeObjectURL(url);
}

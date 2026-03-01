// ── Application bootstrap ─────────────────────────────────────────────────
import { state } from './state.js';
import { ensureAudioCtx, unlockAudio, loadSoundfont } from './audio.js';
import { rerenderProgression, toggleSongsCollapse, pickVariantByPosition } from './render.js';
import { initSheetResizeObserver } from './sheet-music.js';
import {
    refreshMidiAndSheetMusic,
    silencePlayback,
    startMidiPlayback,
    stopPlayback,
    togglePlayback,
    toggleLooping,
    downloadMidi,
} from './playback.js';

// ── Progression data loaders ──────────────────────────────────────────────

async function refreshChordDiagrams() {
    if (!state.currentTransposed.length) return;

    const uniqueChords = [...new Set(state.currentTransposed.map(r => r.transposed))];

    const batchRes = await fetch('/api/chords/batch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            instrument: state.currentInstrument.key,
            chords:     uniqueChords,
        }),
    }).then(r => r.json());

    state.currentChordDiagrams = batchRes;
    rerenderProgression();
}

async function refreshTransposeAndDiagrams() {
    const progression = state.currentProgressions[state.currentIndex];

    const transposeRes = await fetch('/api/transpose', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            from_key: progression.originalKey,
            to_key:   state.currentKey,
            chords:   progression.chords,
        }),
    }).then(r => r.json());

    state.currentTransposed = transposeRes.results;
    await refreshChordDiagrams();
}

export async function displayProgression(index, updateKeySelector = true) {
    const progression      = state.currentProgressions[index];
    state.currentIndex     = index;
    state.currentProgression = progression;

    if (updateKeySelector) {
        state.currentKey = progression.originalKey;
        document.getElementById('keySelect').value = state.currentKey;
    }
    document.getElementById('progressionSelect').value = index;

    await refreshTransposeAndDiagrams();
}

export function showRandomProgression() {
    if (!state.currentProgressions.length) return;
    state.currentChordVariants = {};
    const idx = Math.floor(Math.random() * state.currentProgressions.length);
    return displayProgression(idx, true);
}

// ── Chord variant pickers ──────────────────────────────────────────────────
export function setChordVariant(positionIndex, chordName, variantIndex) {
    state.currentChordVariants[`${positionIndex}-${chordName}`] = variantIndex;
    rerenderProgression();
    refreshMidiAndSheetMusic(true);
}

export function toggleVariantMenu(positionIndex, chordName, event) {
    event.stopPropagation();
    document.querySelectorAll('.chord-variant-menu').forEach(m => m.classList.remove('show'));
    const menu = document.getElementById(`variant-menu-${positionIndex}`);
    if (menu) menu.classList.toggle('show');
}

// ── Main init ──────────────────────────────────────────────────────────────
async function init() {
    const [instruments, progressions] = await Promise.all([
        fetch('/api/instruments').then(r => r.json()),
        fetch('/api/progressions').then(r => r.json()),
    ]);

    state.currentInstruments  = instruments;
    state.currentProgressions = progressions;
    state.currentInstrument   = instruments.find(i => i.key === 'guitar') || instruments[0];

    // Populate instrument dropdown
    const instrSel = document.getElementById('instrumentSelect');
    instruments.forEach(inst => {
        const opt       = document.createElement('option');
        opt.value       = inst.key;
        opt.textContent = `${inst.icon} ${inst.name}`;
        instrSel.appendChild(opt);
    });
    instrSel.value = state.currentInstrument.key;

    // Populate progression dropdown
    const progSel = document.getElementById('progressionSelect');
    progSel.innerHTML = '';
    progressions.forEach((p, i) => {
        const opt       = document.createElement('option');
        opt.value       = i;
        opt.textContent = p.name;
        progSel.appendChild(opt);
    });

    document.getElementById('footer').textContent = `${progressions.length} progressions available`;

    // Show neck-position selector only for guitar
    document.getElementById('positionRow').style.display =
        state.currentInstrument.key === 'guitar' ? 'flex' : 'none';

    // ── Event wiring ──────────────────────────────────────────────────────

    instrSel.addEventListener('change', e => {
        state.currentInstrument = state.currentInstruments.find(i => i.key === e.target.value);
        document.getElementById('instrumentIcon').textContent = state.currentInstrument.icon;
        state.currentChordVariants = {};

        const posRow = document.getElementById('positionRow');
        if (state.currentInstrument.key === 'guitar') {
            posRow.style.display = 'flex';
        } else {
            posRow.style.display = 'none';
            state.preferredPosition = 0;
            document.getElementById('positionSelect').value = '0';
        }

        if (state.currentIndex >= 0) {
            refreshChordDiagrams().then(() => refreshMidiAndSheetMusic(true));
        }
    });

    progSel.addEventListener('change', e => {
        state.currentChordVariants = {};
        displayProgression(parseInt(e.target.value), true).then(() => refreshMidiAndSheetMusic(true));
    });

    document.getElementById('keySelect').addEventListener('change', e => {
        state.currentKey = e.target.value;
        state.currentChordVariants = {};
        if (state.currentIndex >= 0) {
            refreshTransposeAndDiagrams().then(() => refreshMidiAndSheetMusic(true));
        }
    });

    document.getElementById('positionSelect').addEventListener('change', e => {
        state.preferredPosition = parseInt(e.target.value);
        state.currentChordVariants = {};
        rerenderProgression();
        refreshMidiAndSheetMusic(true);
    });

    document.getElementById('tempoSlider').addEventListener('input', e => {
        document.getElementById('tempoValue').textContent = e.target.value;
        if (state.midiRefreshTimer) clearTimeout(state.midiRefreshTimer);
        state.midiRefreshTimer = setTimeout(() => refreshMidiAndSheetMusic(true), 150);
    });

    document.getElementById('patternSelect').addEventListener('change', () => {
        refreshMidiAndSheetMusic(true);
    });

    document.getElementById('octaveSelect').addEventListener('change', () => {
        refreshMidiAndSheetMusic(true);
    });

    document.getElementById('toneSelect').addEventListener('change', async (e) => {
        const tone = e.target.value;
        if (tone !== 'synth') {
            const btn = document.getElementById('playBtn');
            const originalText = btn.textContent;
            if (state.isPlaying) btn.textContent = '⏳ Loading...';
            await loadSoundfont(tone);
            if (state.isPlaying) btn.textContent = originalText;
        }
        if (state.isPlaying) {
            silencePlayback();
            const loopDuration  = state.currentTransposed.length * state.playbackChordDurSec;
            const elapsed       = state.audioCtx.currentTime - state.playbackStartTime;
            const currentOffset = elapsed % loopDuration;
            const newStartTime  = state.audioCtx.currentTime + 0.05;
            state.playbackStartTime = newStartTime - currentOffset;
            startMidiPlayback(state.currentMidiNotes, state.playbackStartTime);
        }
    });

    // Close variant menus when clicking outside
    document.addEventListener('click', e => {
        if (!e.target.closest('.chord')) {
            document.querySelectorAll('.chord-variant-menu').forEach(m => m.classList.remove('show'));
        }
    });

    // iOS audio unlock
    document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
    document.addEventListener('click',      unlockAudio, { once: true });

    // Sheet music resize observer
    initSheetResizeObserver();

    await showRandomProgression();
    await refreshMidiAndSheetMusic();
}

// ── Expose globals for inline onclick handlers ────────────────────────────
window.showRandomProgression = showRandomProgression;
window.toggleSongsCollapse   = toggleSongsCollapse;
window.setChordVariant       = setChordVariant;
window.toggleVariantMenu     = toggleVariantMenu;
window.togglePlayback        = togglePlayback;
window.toggleLooping         = toggleLooping;
window.downloadMidi          = downloadMidi;

// ── Start ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

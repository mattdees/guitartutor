// ── Web Audio API helpers ────────────────────────────────────────────
import { state } from './state.js';

export function ensureAudioCtx() {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// iOS Safari requires AudioContext to be created+resumed in a synchronous
// user-gesture handler. We do it on the first touch/click anywhere on the page.
export function unlockAudio() {
    if (state._audioUnlocked) return;
    ensureAudioCtx();
    // Play one frame of silence to unlock the context on iOS
    const buf = state.audioCtx.createBuffer(1, 1, state.audioCtx.sampleRate);
    const src = state.audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(state.audioCtx.destination);
    src.start(0);
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    state._audioUnlocked = true;
}

export async function loadSoundfont(name) {
    if (state.loadedSoundfonts[name]) return state.loadedSoundfonts[name];
    ensureAudioCtx();
    const inst = await Soundfont.instrument(state.audioCtx, name, {
        soundfont: 'MusyngKite',
    });
    state.loadedSoundfonts[name] = inst;
    return inst;
}

// ADSR constants for the fallback synthesiser
const SYNTH_ATTACK  = 0.015;
const SYNTH_DECAY   = 0.1;
const SYNTH_RELEASE = 0.15;
const SYNTH_MIX_OSC1 = 0.7;
const SYNTH_MIX_OSC2 = 0.3;
const SYNTH_VOL_SCALE = 0.15;

export function synthNote(ctx, midiNote, startTime, duration, velocity) {
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const vol  = (velocity / 127) * SYNTH_VOL_SCALE;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.value = freq;
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;

    const mix1 = ctx.createGain();
    const mix2 = ctx.createGain();
    mix1.gain.value = SYNTH_MIX_OSC1;
    mix2.gain.value = SYNTH_MIX_OSC2;

    osc1.connect(mix1); mix1.connect(gain);
    osc2.connect(mix2); mix2.connect(gain);
    gain.connect(ctx.destination);

    const sustain = vol * 0.6;
    const release = Math.min(SYNTH_RELEASE, duration * 0.2);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + SYNTH_ATTACK);
    gain.gain.linearRampToValueAtTime(sustain, startTime + SYNTH_ATTACK + SYNTH_DECAY);
    gain.gain.setValueAtTime(sustain, startTime + duration - release);
    gain.gain.linearRampToValueAtTime(0.001, startTime + duration);

    const endTime = startTime + duration + 0.02;
    osc1.start(startTime); osc1.stop(endTime);
    osc2.start(startTime); osc2.stop(endTime);

    state.scheduledNodes.push(osc1, osc2, gain, mix1, mix2);
}

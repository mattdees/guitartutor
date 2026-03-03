# Audio Quality Research: Beyond MIDI Soundfonts

## Executive Summary

The current app uses MIDI generation (Go backend) + soundfont-player with MusyngKite samples (frontend). This produces acceptable but clearly synthetic audio. This document outlines concrete paths to achieve near-realistic guitar audio with a full effects chain in the browser — no plugins, no desktop software.

---

## 1. Current State

| Layer | Technology | Limitation |
|---|---|---|
| Note data | SMF MIDI (Go backend) | Fine — keep this |
| Synthesis | soundfont-player v0.12.0 + MusyngKite | MP3-compressed, single velocity per note, no round-robin, no effects |
| Fallback synth | Triangle + Sine oscillators | Thin, unrealistic |
| Effects | None | No reverb, distortion, chorus, delay |
| Format | Binary MIDI → parsed to note events | Fine — keep this pipeline |

The MIDI generation pipeline (Go → SMF → frontend parse) is solid and should be preserved. The improvement opportunity is entirely on the **synthesis and effects** side.

---

## 2. Better Sample Libraries

### Option A: @tonejs/midi + Tone.js Sampler (Recommended)

**Tone.js Sampler** (`Tone.Sampler`) loads multi-velocity audio samples and interpolates between them. It supports:
- Multiple velocity layers (soft/medium/hard pick attack)
- Round-robin variations (different takes of the same note)
- Per-note samples or interpolated neighbors
- OGG/MP3/WAV/WebM formats

**High-quality free guitar sample packs for the web:**

| Library | Quality | Notes |
|---|---|---|
| **Versilian Studios VSCO-2 CE** | ★★★★☆ | Free, multi-velocity, CC0 license |
| **Iowa Guitar** (University of Iowa) | ★★★★☆ | Free, dry studio recordings |
| **Sonatina Symphonic Orchestra** | ★★★☆☆ | Free, guitar included |
| **MIDI.js Soundfonts (FluidR3)** | ★★★☆☆ | Better than MusyngKite, same format |
| **FluidR3_GM** | ★★★★☆ | Higher-quality GM soundfont, OGG available |

**Drop-in soundfont upgrade (minimal code change):**
```js
// Current: MusyngKite
const inst = await Soundfont.instrument(ctx, name, { soundfont: 'MusyngKite' });

// Better: FluidR3_GM (same API, noticeably better quality)
const inst = await Soundfont.instrument(ctx, name, { soundfont: 'FluidR3_GM' });
```
CDN: `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/`

### Option B: AudioBuffer Sample Loading (Most Flexible)

Load raw audio files into `AudioBufferSourceNode` for full control:

```js
async function loadSample(url) {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    return audioCtx.decodeAudioData(arr);
}

function playSample(buffer, startTime, detune = 0, gain = 1) {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.detune.value = detune; // cents — interpolate to neighbor notes
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = gain;
    src.connect(gainNode);
    gainNode.connect(effectsChain); // route through effects
    src.start(startTime);
}
```

**Best audio format:** OGG Vorbis or WebM/Opus — ~50% smaller than MP3 at equivalent quality, natively supported in all modern browsers except Safari (use OGG with MP3 fallback).

---

## 3. Physical Modeling: Karplus-Strong

The **Karplus-Strong algorithm** produces strikingly realistic plucked-string sounds using only:
1. A short burst of white noise (simulates the pick)
2. A feedback delay line (simulates the string length / pitch)
3. A simple low-pass filter (simulates how high frequencies decay faster)

**Web Audio API implementation:**

```js
function karplussStrong(ctx, frequency, startTime, duration, gain = 0.7) {
    const sampleRate = ctx.sampleRate;
    const N = Math.round(sampleRate / frequency); // delay line length

    // Create noise burst buffer
    const noiseBuffer = ctx.createBuffer(1, N, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < N; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    // Feedback delay (string resonance)
    const delay = ctx.createDelay();
    delay.delayTime.value = 1 / frequency;

    // Low-pass filter (string damping)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency * 6; // damp harmonics above 6x fundamental

    // Feedback gain (controls sustain — <1 = decay)
    const feedbackGain = ctx.createGain();
    feedbackGain.gain.value = 0.98; // closer to 1 = longer sustain (electric-like)

    const outputGain = ctx.createGain();
    outputGain.gain.value = gain;

    // Signal path: noise → delay → filter → feedbackGain → delay (loop)
    noise.connect(delay);
    delay.connect(filter);
    filter.connect(feedbackGain);
    feedbackGain.connect(delay); // feedback loop
    filter.connect(outputGain); // also send to output

    outputGain.connect(ctx.destination);

    noise.start(startTime);
    noise.stop(startTime + N / sampleRate); // only inject noise briefly

    return outputGain; // return so caller can route through effects
}
```

**Parameters:**
- `feedbackGain.gain.value = 0.98` → acoustic guitar feel
- `feedbackGain.gain.value = 0.999` → electric guitar (longer sustain)
- `filter.frequency.value` → adjusts brightness/tone

**Reference implementations:**
- https://github.com/mrahtz/javascript-karplus-strong
- https://luciopaiva.com/karplus/ (live demo — multi-string chord demo)

---

## 4. JavaScript Audio Libraries

### Tone.js (Primary Recommendation)

**What it is:** A complete Web Audio framework — synthesizers, effects, scheduling, sequencing, MIDI support. Think of it as a "DAW in a library."

**Why it fits this project:**
- Built-in effects: `Tone.Reverb`, `Tone.Distortion`, `Tone.Chorus`, `Tone.FeedbackDelay`, `Tone.Compressor`, `Tone.EQ3`
- `Tone.Sampler` handles multi-sample instruments with pitch interpolation
- Musical time scheduling: `"4n"` (quarter note), `"8t"` (eighth triplet) — complements existing tempo system
- MIDI input/output support
- Signal routing mirrors a guitar pedalboard (guitar → pedals → amp)

**CDN:**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js"></script>
```

**Example guitar signal chain in Tone.js:**
```js
// Load guitar samples
const guitar = new Tone.Sampler({
    urls: {
        "E2": "E2.ogg",
        "A2": "A2.ogg",
        "D3": "D3.ogg",
        "G3": "G3.ogg",
        "B3": "B3.ogg",
        "E4": "E4.ogg",
    },
    baseUrl: "/samples/guitar/",
}).connect(effectsChain);

// Effects chain (guitar → distortion → cabinet IR → reverb → compressor → output)
const distortion = new Tone.Distortion(0.4);
const reverb     = new Tone.Reverb({ decay: 1.5, wet: 0.3 });
const delay      = new Tone.FeedbackDelay("8n", 0.3);
const compressor = new Tone.Compressor(-24, 3);

distortion.chain(reverb, delay, compressor, Tone.Destination);
guitar.connect(distortion);
```

**Installation:** `npm install tone` or unpkg CDN.

### Howler.js (For Sample Playback Only)

Best for playing pre-recorded chord/note audio files. Lightweight (7KB gzipped), great cross-browser support including IE9 fallback. **Does not support synthesis or effects chains** — use only if the goal is simple sample playback without effects.

### soundfont-player (Current — Keep as Baseline)

The existing library works well as a no-frills baseline. The main limitation is no effects routing — notes go directly to the audio destination with no processing.

---

## 5. Guitar Effects Implementation

All effects below use native Web Audio API nodes (no library required). They can be combined into a signal chain.

### 5.1 Distortion / Overdrive

Uses `WaveShaperNode` with a sigmoid-style transfer curve:

```js
function createDistortion(ctx, amount = 200) {
    const node = ctx.createWaveShaper();
    const curve = new Float32Array(ctx.sampleRate);
    const k = amount;
    for (let i = 0; i < ctx.sampleRate; i++) {
        const x = (i * 2) / ctx.sampleRate - 1;
        curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    node.curve = curve;
    node.oversample = '4x'; // reduce aliasing
    return node;
}
```

### 5.2 Reverb (Room / Hall / Plate)

Uses `ConvolverNode` with **Impulse Responses (IRs)** — real recordings of rooms. Free IR packs:
- **OpenAIR** (open-source IR library): https://www.openair.hosted.york.ac.uk/
- **Voxengo Impulses** (free): various rooms and amp cabinets

```js
async function createReverb(ctx, irUrl) {
    const response = await fetch(irUrl);
    const arrayBuffer = await response.arrayBuffer();
    const irBuffer = await ctx.decodeAudioData(arrayBuffer);
    const convolver = ctx.createConvolver();
    convolver.buffer = irBuffer;
    return convolver;
}

// Usage: chain guitar → reverb → output
const reverb = await createReverb(ctx, '/ir/small-room.ogg');
guitarOutput.connect(reverb);
reverb.connect(ctx.destination);
```

For **amp cabinet simulation**, use guitar cabinet IRs (same API, different IR file). This dramatically improves realism by removing the "direct injection" sound and adding speaker coloration.

### 5.3 Chorus / Flanger

Built from a short modulated delay:

```js
function createChorus(ctx, { rate = 1.5, depth = 0.003, delay = 0.03 } = {}) {
    const input  = ctx.createGain();
    const wet    = ctx.createGain();
    const dry    = ctx.createGain();
    const delayNode = ctx.createDelay(0.1);
    const lfo    = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    lfo.frequency.value = rate;           // rate of modulation (Hz)
    lfoGain.gain.value = depth;           // depth of pitch wobble
    delayNode.delayTime.value = delay;    // base delay (30ms = chorus, 5ms = flanger)

    lfo.connect(lfoGain);
    lfoGain.connect(delayNode.delayTime);
    input.connect(delayNode);
    input.connect(dry);
    delayNode.connect(wet);

    dry.gain.value = 0.7;
    wet.gain.value = 0.3;

    lfo.start();
    return { input, dry, wet }; // merge dry + wet at output
}
```

### 5.4 Delay / Echo

```js
function createDelay(ctx, { time = 0.375, feedback = 0.4, mix = 0.3 } = {}) {
    const delay    = ctx.createDelay(2.0);
    const feedback = ctx.createGain();
    const wet      = ctx.createGain();

    delay.delayTime.value = time;         // delay time in seconds (sync to tempo: 60/bpm * 0.75 for dotted eighth)
    feedback.gain.value   = 0.4;          // how much feeds back (0=no echo, 1=infinite)
    wet.gain.value        = mix;

    delay.connect(feedback);
    feedback.connect(delay);              // feedback loop
    delay.connect(wet);

    return { input: delay, output: wet };
}

// Tempo-sync: dotted 8th note delay (U2 / The Edge style)
const delayTime = (60 / bpm) * 0.75; // dotted eighth
```

### 5.5 Compression

Essential for guitar — evens out dynamics between soft and hard picking:

```js
const compressor = ctx.createDynamicsCompressor();
compressor.threshold.value = -24;  // dB — start compressing here
compressor.knee.value      = 10;   // dB — soft knee
compressor.ratio.value     = 4;    // 4:1 compression ratio
compressor.attack.value    = 0.003; // 3ms attack
compressor.release.value   = 0.25; // 250ms release
```

### 5.6 Wah-Wah Effect

A bandpass filter with a modulated center frequency:

```js
function createWah(ctx, { frequency = 1200, Q = 8 } = {}) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency; // sweep this 300Hz–3000Hz for wah
    filter.Q.value = Q;

    // Auto-wah: LFO drives the frequency
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 2;     // wah speed (Hz)
    lfoGain.gain.value = 800;    // modulation depth (Hz)
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    return filter;
}
```

---

## 6. Recommended Signal Chain

```
Guitar Notes (MIDI → note events)
    │
    ▼
[Sampler / Karplus-Strong]
    │
    ▼
[Compressor]        ← tighten dynamics
    │
    ▼
[Distortion]        ← optional: overdrive/crunch
    │
    ▼
[Chorus / Flanger]  ← optional: add width
    │
    ▼
[Delay]             ← optional: rhythmic echo
    │
    ▼
[Cabinet IR]        ← ConvolverNode with guitar cab impulse
    │
    ▼
[Room Reverb]       ← ConvolverNode with room impulse
    │
    ▼
[Master Gain]
    │
    ▼
AudioContext.destination
```

---

## 7. WebAssembly Options (Advanced / Future)

| Tool | Description | Feasibility |
|---|---|---|
| **Faust → WASM** | DSP language compiled to AudioWorklet + WASM. Best for custom DSP algorithms | High — good browser support |
| **JUCE → WASM** | Full plugin framework compiled with Emscripten | Medium — large output, complex setup |
| **Csound** | Classic DSP engine, has a web port | Medium — large, specialized |
| **DawDreamer** | Python-based DAW for rendering, not real-time web | Low — server-side only |

**Faust** is the most practical option for writing custom guitar synthesis or effects in a high-performance DSP language that compiles to WebAssembly and runs as an `AudioWorkletProcessor`. The Faust online IDE can export directly to a self-contained WASM module.

Faust Web IDE: https://faustide.grame.fr/

---

## 8. Implementation Roadmap

### Phase 1 — Quick Win (1–2 days)

**Switch soundfont from MusyngKite to FluidR3_GM.** No architecture changes — one line in `audio.js`. FluidR3 has noticeably better guitar samples (more velocity layers, less compression).

```js
// audio.js line 29 — change soundfont parameter
const inst = await Soundfont.instrument(state.audioCtx, name, {
    soundfont: 'FluidR3_GM',  // was 'MusyngKite'
});
```

Add a **master compressor** at the output to tighten up the sound:
```js
// audio.js — add after ensureAudioCtx()
state.masterCompressor = state.audioCtx.createDynamicsCompressor();
state.masterCompressor.threshold.value = -18;
state.masterCompressor.ratio.value = 4;
state.masterCompressor.connect(state.audioCtx.destination);
// Route all audio through masterCompressor instead of directly to destination
```

### Phase 2 — Effects Chain (1 week)

1. Add a new `effects.js` module with a signal chain (compressor → reverb → master gain)
2. Add **Room Reverb** via `ConvolverNode` with a free room IR
3. Add **guitar cabinet IR** for amp simulation
4. Add a simple effects UI panel: Reverb (dry/wet), Room size
5. Store effects settings in `state.js`

### Phase 3 — Karplus-Strong Synthesis (1–2 weeks)

1. Implement Karplus-Strong in a new `synth-guitar.js` module
2. Use it as an alternative "tone" option alongside soundfonts
3. Route its output through the effects chain
4. Add parameters: attack (pick hardness), sustain (electric vs acoustic)

### Phase 4 — Tone.js Integration (2–3 weeks)

1. Replace soundfont-player with `Tone.Sampler` using higher-quality samples
2. Migrate note scheduling from manual `AudioBufferSourceNode` to `Tone.Part`
3. Add full effects UI: distortion amount, delay time, chorus rate, reverb wet
4. Expose effects presets: Clean, Crunch, Heavy, Blues, Jazz, Country

### Phase 5 — High-Quality Samples (1 week)

1. Select and prepare sample pack (Iowa Guitar or VSCO-2 CE)
2. Convert to OGG format, serve from backend or CDN
3. Implement multi-velocity layer selection based on MIDI velocity
4. Add round-robin variation to avoid the "machine gun effect"

---

## 9. File Size / Performance Considerations

| Approach | First Load Cost | Notes |
|---|---|---|
| FluidR3_GM soundfonts | ~200KB per instrument (CDN cached) | Lazy-load per instrument |
| Tone.js library | ~350KB minified | Load once, CDN cached |
| Guitar sample pack (6 notes × 3 velocities) | ~1–2MB total OGG | Load on first play, cache in AudioBuffer |
| Impulse responses (reverb + cabinet) | ~100–500KB per IR | Load when effects enabled |
| Karplus-Strong synthesizer | 0KB (pure JS) | No load cost |
| Faust WASM module | ~200–500KB | Load on demand |

Lazy loading all audio assets (only when playback starts) keeps the initial page load fast.

---

## 10. Key Resources

- [Tone.js Documentation](https://tonejs.github.io/)
- [Web Audio API MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Karplus-Strong JS Demo](https://luciopaiva.com/karplus/)
- [mrahtz/javascript-karplus-strong](https://github.com/mrahtz/javascript-karplus-strong)
- [FluidR3_GM Soundfonts CDN](https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/)
- [OpenAIR Impulse Response Library](https://www.openair.hosted.york.ac.uk/)
- [Faust Web IDE](https://faustide.grame.fr/)
- [VSCO-2 Community Edition Samples](https://vis.versilstudios.com/vsco-community.html)
- [University of Iowa Electronic Music Studios](https://theremin.music.uiowa.edu/MIS.html)

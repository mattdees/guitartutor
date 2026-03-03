// ── Chord Dictionary ──────────────────────────────────────────────────────
import { state } from './state.js';
import { apiFetch } from './api.js';
import { renderChordDiagram } from './render.js';
import { renderSheetMusicStatic } from './sheet-music.js';

// ── Module-level cache ────────────────────────────────────────────────────
let _chordCache     = {};   // instrKey → {chordName: [variants]}
let _initDone       = false;
let _allSheetData   = [];   // [{el, notes, chordName}] — one entry per instrument column
let _sheetResizeObs = null;
let _enabledInstrs  = null; // null = all; Set<key> when filtered

// ── Note / MIDI helpers ───────────────────────────────────────────────────
const _NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const _FLAT_MAP   = { Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#', Bb:'A#', Cb:'B', Fb:'E' };

function _noteNameToMidi(noteName) {
    const m = noteName.match(/^([A-G][#b]?)(\d+)$/);
    if (!m) return 60;
    const root   = _FLAT_MAP[m[1]] || m[1];
    const octave = parseInt(m[2]);
    const semi   = _NOTE_NAMES.indexOf(root);
    return semi === -1 ? 60 : 12 * (octave + 1) + semi;
}

function _variantToMidiNotes(variant, instrument) {
    if (variant.keys && variant.keys.length) {
        return variant.keys.map(_noteNameToMidi);
    }
    if (!instrument || !instrument.openMidi || !variant.frets) return [];
    const pitches = [];
    for (let i = 0; i < variant.frets.length; i++) {
        const fv = variant.frets[i];
        if (fv === 'x') continue;
        const fretNum = parseInt(fv);
        if (isNaN(fretNum) || i >= instrument.openMidi.length) continue;
        pitches.push(instrument.openMidi[i] + fretNum);
    }
    return pitches.sort((a, b) => a - b);
}

function _pitchesToNoteNames(pitches) {
    const seen = new Set(), names = [];
    pitches.forEach(p => {
        const n = _NOTE_NAMES[p % 12];
        if (!seen.has(n)) { seen.add(n); names.push(n); }
    });
    return names;
}

// ── Chord name sort ───────────────────────────────────────────────────────
const _ROOT_ORDER = ['C','C#','Db','D','D#','Eb','E','F','F#','Gb','G','G#','Ab','A','A#','Bb','B'];

function _chordSort(a, b) {
    const parse = s => { const m = s.match(/^([A-G][#b]?)(.*)/); return m ? [m[1], m[2]] : [s, '']; };
    const [ar, as] = parse(a);
    const [br, bs] = parse(b);
    const ai = _ROOT_ORDER.indexOf(ar);
    const bi = _ROOT_ORDER.indexOf(br);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return as.localeCompare(bs);
}

// ── Data loading ──────────────────────────────────────────────────────────
async function _ensureChords(instrKey) {
    if (!_chordCache[instrKey]) {
        _chordCache[instrKey] = await apiFetch(`/api/chords/${instrKey}`);
    }
    return _chordCache[instrKey];
}

// ── Instrument filter dropdown ────────────────────────────────────────────
function _buildInstrFilter() {
    const panel = document.getElementById('dictInstrPanel');
    if (!panel) return;
    panel.innerHTML = '';
    state.currentInstruments.forEach(instr => {
        const label = document.createElement('label');
        label.className = 'dict-instr-check';
        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.value   = instr.key;
        cb.checked = !_enabledInstrs || _enabledInstrs.has(instr.key);
        cb.addEventListener('change', () => {
            _updateEnabledInstrs();
            if (state.dictSelectedChord) renderDictionary();
        });
        const iconEl = document.createElement('span');
        iconEl.textContent = instr.icon || '';
        const nameEl = document.createElement('span');
        nameEl.textContent = instr.name;
        label.append(cb, iconEl, nameEl);
        panel.appendChild(label);
    });
}

function _updateEnabledInstrs() {
    const panel = document.getElementById('dictInstrPanel');
    if (!panel) return;
    const checked = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
    // Use null to mean "all" (avoids filtering); otherwise store the exact set,
    // including an empty Set so the "No instruments selected" message can appear.
    _enabledInstrs = checked.length === state.currentInstruments.length ? null : new Set(checked);
    _updateInstrBtnLabel();
}

function _updateInstrBtnLabel() {
    const btn   = document.getElementById('dictInstrBtn');
    if (!btn) return;
    const total = state.currentInstruments.length;
    const count = _enabledInstrs ? _enabledInstrs.size : total;
    btn.textContent = (count === total ? 'All Instruments' : `${count} Instruments`) + ' ▾';
}

// ── Chord sidebar list ────────────────────────────────────────────────────
async function _populateChordList() {
    const refKey = state.currentInstruments.find(i => i.key === 'guitar')?.key
                || state.currentInstruments[0]?.key;
    if (!refKey) return;

    const chords = await _ensureChords(refKey);
    const names  = Object.keys(chords).sort(_chordSort);
    const listEl = document.getElementById('dictChordList');
    if (!listEl) return;

    listEl.innerHTML = '';
    names.forEach(name => {
        const btn = document.createElement('button');
        btn.className   = 'dict-chord-item' + (name === state.dictSelectedChord ? ' active' : '');
        btn.dataset.chord = name;
        btn.textContent = name;
        btn.addEventListener('click', () => {
            state.dictSelectedChord  = name;
            state.dictVariantByInstr = {};
            _setActiveChordInList(name);
            renderDictionary().then(() => updateHash());
        });
        listEl.appendChild(btn);
    });
}

function _setActiveChordInList(chordName) {
    const listEl = document.getElementById('dictChordList');
    if (!listEl) return;
    listEl.querySelectorAll('.dict-chord-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.chord === chordName);
    });
    const active = listEl.querySelector('.dict-chord-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

// ── Sheet music helpers ───────────────────────────────────────────────────
function _pitchesToNotes(pitches) {
    return pitches.map(p => ({ note: p, start: 0, duration: 2.0, velocity: 100 }));
}

// Always clear the container first so SVGs don't accumulate on re-render.
function _renderSheet(el, notes, chordName) {
    if (!el || !notes?.length) return;
    el.innerHTML = '';
    renderSheetMusicStatic(notes, chordName, el);
}

function _attachGridResizeObs(containerEl) {
    if (_sheetResizeObs) _sheetResizeObs.disconnect();
    let lastW = 0;
    _sheetResizeObs = new ResizeObserver(entries => {
        if (!_allSheetData.length) return;
        const w = Math.floor(entries[0].contentRect.width);
        if (Math.abs(w - lastW) > 4) {
            lastW = w;
            _allSheetData.forEach(d => {
                if (d.notes.length) _renderSheet(d.el, d.notes, d.chordName);
            });
        }
    });
    _sheetResizeObs.observe(containerEl);
}

// ── Footer note names ─────────────────────────────────────────────────────
function _updateFooterNotes(pitches) {
    const el = document.getElementById('dictFooterNotes');
    if (!el) return;
    // Always update — clear stale text when the new variant has no pitches.
    el.textContent = pitches?.length ? _pitchesToNoteNames(pitches).join(' · ') : '';
}

// ── Populate one instrument's grid cells ──────────────────────────────────
// Returns pitches of the active variant (for footer note names), or null.
function _populateInstrCells(instrument, variants, tabsCell, diagCell, sheetCell) {
    const instrKey = instrument.key;

    if (!variants.length) {
        diagCell.innerHTML = '<span class="dict-empty-msg">—</span>';
        return null;
    }

    const varIdx = Math.min(
        state.dictVariantByInstr[instrKey] ?? 0,
        Math.max(0, variants.length - 1)
    );
    state.dictVariantByInstr[instrKey] = varIdx;

    function _draw(i) {
        const v = variants[i];
        diagCell.innerHTML = renderChordDiagram(v, 0, instrument);
        return _variantToMidiNotes(v, instrument);
    }

    // Variant tab buttons
    if (variants.length > 1) {
        variants.forEach((v, i) => {
            const btn = document.createElement('button');
            btn.className   = 'dict-variant-tab' + (i === varIdx ? ' active' : '');
            btn.textContent = v.name;
            btn.addEventListener('click', () => {
                tabsCell.querySelectorAll('.dict-variant-tab')
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.dictVariantByInstr[instrKey] = i;
                const pitches = _draw(i);
                // Update sheet music — clear if the variant has no pitch data.
                if (sheetCell) {
                    const notes = pitches.length ? _pitchesToNotes(pitches) : [];
                    const entry = _allSheetData.find(d => d.el === sheetCell);
                    if (entry) { entry.notes = notes; entry.chordName = state.dictSelectedChord; }
                    if (notes.length) { _renderSheet(sheetCell, notes, state.dictSelectedChord); }
                    else { sheetCell.innerHTML = ''; }
                }
                // Always update footer notes to avoid showing stale text.
                if (instrument.key === 'piano') _updateFooterNotes(pitches);
            });
            tabsCell.appendChild(btn);
        });
    }

    return _draw(varIdx);
}

// ── Main render ───────────────────────────────────────────────────────────
// Each instrument is rendered as a self-contained card.
// Cards use CSS auto-fit so they wrap to new rows when the viewport is narrow.
export async function renderDictionary() {
    const chord = state.dictSelectedChord;
    if (!chord) return;

    document.getElementById('dictChordNameDisplay').textContent = chord;

    const tableEl     = document.getElementById('dictTable');
    tableEl.innerHTML = '';

    const instruments = _enabledInstrs
        ? state.currentInstruments.filter(i => _enabledInstrs.has(i.key))
        : state.currentInstruments;

    if (instruments.length === 0) {
        tableEl.innerHTML = '<p class="dict-placeholder-msg">No instruments selected — use the filter above.</p>';
        return;
    }

    // Fetch chord data only for the instruments we are about to render.
    await Promise.all(instruments.map(i => _ensureChords(i.key)));

    // ── Wrapping card grid ──
    const grid = document.createElement('div');
    grid.className = 'dict-cards-grid';
    tableEl.appendChild(grid);

    _allSheetData = [];
    let sheetPitches = null;

    instruments.forEach(instr => {
        const card = document.createElement('div');
        card.className = 'dict-instr-card';
        card.dataset.instr = instr.key;

        const headerEl = document.createElement('div');
        headerEl.className = 'dict-card-header';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'dict-col-icon';
        iconSpan.textContent = instr.icon || '';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'dict-col-name';
        nameSpan.textContent = instr.name;
        headerEl.append(iconSpan, nameSpan);

        const tabsEl  = document.createElement('div');
        tabsEl.className = 'dict-card-tabs';

        const diagEl  = document.createElement('div');
        diagEl.className = 'dict-card-diagram';

        const sheetEl = document.createElement('div');
        sheetEl.className = 'dict-card-sheet';

        card.append(headerEl, tabsEl, diagEl, sheetEl);
        grid.appendChild(card);

        const variants = (_chordCache[instr.key] || {})[chord] || [];
        const pitches  = _populateInstrCells(instr, variants, tabsEl, diagEl, sheetEl);
        const notes    = pitches?.length ? _pitchesToNotes(pitches) : [];
        _allSheetData.push({ el: sheetEl, notes, chordName: chord });

        if (!sheetPitches && pitches?.length) sheetPitches = pitches;
        if (instr.key === 'piano' && pitches?.length) sheetPitches = pitches;
    });

    // ── Footer: note names ──
    const footer  = document.createElement('div');
    footer.className = 'dict-footer';

    const notesEl = document.createElement('div');
    notesEl.id = 'dictFooterNotes';
    notesEl.className = 'dict-footer-notes';
    if (sheetPitches?.length) notesEl.textContent = _pitchesToNoteNames(sheetPitches).join(' · ');
    footer.appendChild(notesEl);
    tableEl.appendChild(footer);

    // ── Render sheet music after layout pass ──
    requestAnimationFrame(() => {
        _allSheetData.forEach(d => {
            if (d.notes.length) _renderSheet(d.el, d.notes, d.chordName);
        });
        _attachGridResizeObs(grid);
    });
}

// ── Hash routing ──────────────────────────────────────────────────────────
export function updateHash(replace = false) {
    let hash = '';
    if (state.currentPage === 'dictionary') {
        hash = 'dictionary';
        if (state.dictSelectedChord) hash += '/' + encodeURIComponent(state.dictSelectedChord);
    } else {
        hash = 'progression';
        if (state.currentInstrument) hash += '/' + state.currentInstrument.key;
        if (state.currentKey)        hash += '/' + encodeURIComponent(state.currentKey);
        if (state.currentIndex >= 0) hash += '/' + state.currentIndex;
    }
    if (replace) {
        history.replaceState(null, '', '#' + hash);
    } else {
        history.pushState(null, '', '#' + hash);
    }
}

// ── Navigation ────────────────────────────────────────────────────────────
export function navigateTo(page, replace = false) {
    state.currentPage = page;

    const progressionCard   = document.querySelector('.progression-card');
    const selectorContainer = document.querySelector('.selector-container');
    const dictSection       = document.getElementById('dictionarySection');
    const navProg           = document.getElementById('navProgression');
    const navDict           = document.getElementById('navDictionary');
    const title             = document.getElementById('pageTitle');
    const subtitle          = document.getElementById('pageSubtitle');

    if (page === 'dictionary') {
        progressionCard.style.display   = 'none';
        selectorContainer.style.display = 'none';
        dictSection.style.display       = 'block';
        navProg.classList.remove('active');
        navDict.classList.add('active');
        if (title)    title.textContent    = 'Chord Dictionary';
        if (subtitle) subtitle.textContent = 'Look up fingerings for any chord';
        if (!_initDone) _lazyInit().catch(err => console.error('Chord dictionary init failed:', err));
    } else {
        progressionCard.style.display   = 'block';
        selectorContainer.style.display = 'flex';
        dictSection.style.display       = 'none';
        navProg.classList.add('active');
        navDict.classList.remove('active');
        if (title)    title.textContent    = 'Chord Progressions';
        if (subtitle) subtitle.textContent = 'Select an instrument and progression';
    }
    updateHash(replace);
}

// ── Open from progression chord pills ─────────────────────────────────────
export async function openChordInDictionary(chordName, replace = false) {
    state.dictSelectedChord  = chordName;
    state.dictVariantByInstr = {};

    navigateTo('dictionary', replace);

    if (!_initDone) await _lazyInit();

    _setActiveChordInList(chordName);

    await renderDictionary();
    updateHash(replace);
}

// ── Instrument change (no-op: all instruments always shown) ───────────────
export function onDictInstrumentChange() {}

// ── Lazy init ─────────────────────────────────────────────────────────────
async function _lazyInit() {
    _initDone = true;

    // Instrument filter toggle
    const instrBtn = document.getElementById('dictInstrBtn');
    if (instrBtn) {
        instrBtn.addEventListener('click', e => {
            e.stopPropagation();
            const panel = document.getElementById('dictInstrPanel');
            if (panel) panel.hidden = !panel.hidden;
        });
    }
    // Close filter panel on outside click
    document.addEventListener('click', e => {
        const filter = document.getElementById('dictInstrFilter');
        if (filter && !filter.contains(e.target)) {
            const panel = document.getElementById('dictInstrPanel');
            if (panel) panel.hidden = true;
        }
    });

    _buildInstrFilter();
    await _populateChordList();
}

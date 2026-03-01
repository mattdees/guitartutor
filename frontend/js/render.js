// ── Chord diagram rendering ───────────────────────────────────────────────
import { state } from './state.js';

// ── Piano keyboard layout constants ──────────────────────────────────────
export const PIANO_WHITE_KEYS = [
    'C3','D3','E3','F3','G3','A3','B3',
    'C4','D4','E4','F4','G4','A4','B4','C5',
];
// left offset (px) of each black key from the left edge of the keyboard container
export const PIANO_BLACK_KEYS = [
    {note:'C#3', left:15}, {note:'D#3', left:37}, {note:'F#3', left:81},
    {note:'G#3', left:103},{note:'A#3', left:125},
    {note:'C#4', left:169},{note:'D#4', left:191},{note:'F#4', left:235},
    {note:'G#4', left:257},{note:'A#4', left:279},
];
export const PIANO_WHITE_W = 22;
export const PIANO_WHITE_H = 90;
export const PIANO_BLACK_W = 13;
export const PIANO_BLACK_H = 55;

// ── Neck-position variant picker ──────────────────────────────────────────
export function pickVariantByPosition(variants, prefPos) {
    if (!prefPos || !variants.length) return 0;
    let best = 0, bestDist = Infinity;
    variants.forEach((v, i) => {
        const d = Math.abs(v.position - prefPos);
        if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
}

// ── Songs-section collapse toggle ─────────────────────────────────────────
export function toggleSongsCollapse() {
    const section = document.getElementById('songsSection');
    if (!section) return;
    const isCollapsed = section.classList.toggle('collapsed');
    const toggle = document.getElementById('songsToggle');
    if (toggle) {
        toggle.textContent = isCollapsed ? '▶' : '▼';
    }
    const header = document.querySelector('.songs-header');
    if (header) {
        header.setAttribute('aria-expanded', String(!isCollapsed));
    }
}

// ── Piano diagram renderer ────────────────────────────────────────────────
export function renderPianoChordDiagram(diagram, chordIdx) {
    if (!diagram || !diagram.keys || !diagram.keys.length) {
        return '<div class="chord-diagram piano-chord-diagram"><div style="color:#888;font-size:12px;padding:20px;">No diagram<br/>available</div></div>';
    }
    const active = new Set(diagram.keys);
    const totalW = PIANO_WHITE_KEYS.length * PIANO_WHITE_W;
    let html = `<div class="chord-diagram piano-chord-diagram" data-chord-idx="${chordIdx}">`;
    html += `<div class="piano-keyboard" style="width:${totalW}px;height:${PIANO_WHITE_H}px;">`;

    // White keys
    PIANO_WHITE_KEYS.forEach(note => {
        const on = active.has(note);
        html += `<div class="piano-key piano-white${on ? ' piano-active' : ''}" style="width:${PIANO_WHITE_W}px;height:${PIANO_WHITE_H}px;">`;
        if (on) html += `<span class="piano-key-label">${note.replace(/\d+$/, '')}</span>`;
        html += '</div>';
    });

    // Black keys (absolutely positioned)
    PIANO_BLACK_KEYS.forEach(({note, left}) => {
        const on = active.has(note);
        const noteName = note.replace(/\d+$/, '');
        html += `<div class="piano-key piano-black${on ? ' piano-active' : ''}" style="left:${left}px;top:0;width:${PIANO_BLACK_W}px;height:${PIANO_BLACK_H}px;">`;
        if (on) html += `<span class="piano-key-label">${noteName}</span>`;
        html += '</div>';
    });

    html += '</div></div>';
    return html;
}

// ── Fretboard diagram renderer ────────────────────────────────────────────
export function renderChordDiagram(diagram, chordIdx) {
    if (state.currentInstrument && state.currentInstrument.displayType === 'keyboard') {
        return renderPianoChordDiagram(diagram, chordIdx);
    }
    if (!diagram) {
        return '<div class="chord-diagram"><div style="color:#888;font-size:12px;padding:20px;">No diagram<br/>available</div></div>';
    }

    const stringCount = state.currentInstrument.strings;
    const stringNames = state.currentInstrument.stringNames;
    const stringWidth = 18;
    const nutWidth    = stringCount * stringWidth;

    let html = `<div class="chord-diagram" data-chord-idx="${chordIdx}">`;

    // String name labels
    html += `<div class="string-indicators" style="font-size:9px;color:#888;margin-bottom:2px;grid-template-columns:repeat(${stringCount},${stringWidth}px);">`;
    stringNames.forEach(n => { html += `<span>${n}</span>`; });
    html += '</div>';

    // Open / muted indicators
    html += `<div class="string-indicators" style="grid-template-columns:repeat(${stringCount},${stringWidth}px);">`;
    for (let i = 0; i < stringCount; i++) {
        if      (diagram.frets[i] === 'x') html += `<span class="string-indicator muted-string" data-string="${i}">✕</span>`;
        else if (diagram.frets[i] === '0') html += `<span class="string-indicator open-string" data-string="${i}">○</span>`;
        else                               html += `<span class="string-indicator" data-string="${i}"></span>`;
    }
    html += '</div>';

    // Nut bar or position label
    if (diagram.position === 1) {
        html += `<div class="nut-bar" style="margin-left:20px;width:${nutWidth}px;"></div>`;
    } else {
        html += `<div class="position-indicator" style="margin-left:20px;">${diagram.position}fr</div>`;
    }

    // Fret grid
    html += `<div class="diagram-grid strings-${stringCount}">`;
    for (let fret = diagram.position; fret < diagram.position + 4; fret++) {
        html += '<div class="fret-row">';
        html += `<span class="fret-number">${fret}</span>`;
        for (let s = 0; s < stringCount; s++) {
            html += `<div class="fret-cell" data-string="${s}">`;
            const fv = diagram.frets[s];
            if (fv !== 'x' && fv !== '0' && parseInt(fv) === fret) {
                const finger = diagram.fingers[s] || '●';
                html += `<span class="finger-dot">${finger}</span>`;
            }
            html += '</div>';
        }
        html += '</div>';
    }
    html += '</div></div>';
    return html;
}

// ── Progression re-render (no API calls) ──────────────────────────────────
export function rerenderProgression() {
    if (state.currentIndex < 0 || !state.currentProgression) return;

    document.getElementById('progressionName').textContent = state.currentProgression.name;
    document.getElementById('description').textContent     = state.currentProgression.description;

    const songsList = document.getElementById('songsList');
    songsList.innerHTML = '';
    songsList.style.maxHeight = 'none';

    state.currentProgression.songs.forEach(song => {
        const item = document.createElement('div');
        item.className = 'song-item';
        item.style.marginBottom = '8px';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.fontSize = '0.9rem';

        const mainInfo = document.createElement('span');
        mainInfo.innerHTML = `<strong style="color: #fff;">${song.title}</strong> by ${song.artist}`;

        const yearInfo = document.createElement('span');
        yearInfo.style.color = '#666';
        yearInfo.textContent = song.year || '';

        item.appendChild(mainInfo);
        item.appendChild(yearInfo);
        songsList.appendChild(item);
    });

    setTimeout(() => {
        songsList.style.maxHeight = songsList.scrollHeight + 'px';
    }, 0);

    const container = document.getElementById('chordsContainer');
    container.innerHTML = '';

    state.currentTransposed.forEach(({ transposed: chord }, i) => {
        const variants          = state.currentChordDiagrams[chord] || [];
        const key               = `${i}-${chord}`;
        const currentVariantIdx = state.currentChordVariants[key] !== undefined
            ? state.currentChordVariants[key]
            : pickVariantByPosition(variants, state.preferredPosition);
        const currentVariant    = variants[currentVariantIdx] || variants[0] || null;
        const hasVariants       = variants.length > 1;

        let variantMenuHtml = '';
        if (hasVariants) {
            variantMenuHtml = `<div class="chord-variant-menu" id="variant-menu-${i}">`;
            variants.forEach((v, vi) => {
                const active = vi === currentVariantIdx ? 'active' : '';
                variantMenuHtml += `<div class="chord-variant-option ${active}" onclick="setChordVariant(${i},'${chord}',${vi})">${v.name}</div>`;
            });
            variantMenuHtml += '</div>';
        }

        const variantBtnHtml = hasVariants
            ? `<button class="chord-variant-btn" onclick="toggleVariantMenu(${i},'${chord}',event)" aria-label="Choose ${chord} variant">▼</button>`
            : '';

        const variantLabelHtml = hasVariants && currentVariant
            ? `<div class="chord-variant-label">${currentVariant.name}</div>`
            : '<div class="chord-variant-label"></div>';

        const wrapper = document.createElement('div');
        wrapper.className = 'chord-wrapper';
        wrapper.innerHTML = `
            <div class="chord">
                <span class="chord-name">${chord}</span>
                ${variantBtnHtml}
                ${variantMenuHtml}
            </div>
            ${variantLabelHtml}
            ${renderChordDiagram(currentVariant, i)}
            <div class="playing-notes-label" id="pnl-${i}"></div>
        `;
        container.appendChild(wrapper);

        if (i < state.currentTransposed.length - 1) {
            const arrow = document.createElement('div');
            arrow.className  = 'arrow';
            arrow.textContent = '→';
            container.appendChild(arrow);
        }
    });
}

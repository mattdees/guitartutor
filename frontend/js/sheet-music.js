// ── Sheet music rendering ─────────────────────────────────────────────────
import { state } from './state.js';

// ── Note name helpers ─────────────────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function midiToNoteName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    return NOTE_NAMES[midi % 12] + octave;
}

// ── Staff mapping ─────────────────────────────────────────────────────────
// MIDI semitone → diatonic steps within an octave (C=0,D=1,E=2,F=3,G=4,A=5,B=6)
const _SM_DIAT  = [0,0,1,1,2,3,3,4,4,5,5,6];
// Which semitones are sharps
const _SM_SHARP = [false,true,false,true,false,false,true,false,true,false,true,false];

// Returns { clef: 'treble'|'bass', step: number }
function _midiToStaffStep(midi) {
    const octave = Math.floor(midi / 12) - 1;
    const diatonicTotal = octave * 7 + _SM_DIAT[midi % 12];
    if (midi >= 60) { // C4 and above use treble staff
        const e4Diatonic = 4 * 7 + _SM_DIAT[64 % 12]; // 30
        return { clef: 'treble', step: diatonicTotal - e4Diatonic };
    } else { // Below C4 use bass staff
        const g2Diatonic = 2 * 7 + _SM_DIAT[43 % 12]; // 18
        return { clef: 'bass', step: diatonicTotal - g2Diatonic };
    }
}

// ── Rest renderer ─────────────────────────────────────────────────────────
export function renderRest(svgParts, x, y, durSec, beatDur) {
    const color = '#94a3b8';
    if (durSec >= 3.5 * beatDur) {
        // Whole rest
        svgParts.push(`<rect x="${x - 10}" y="${y - 11}" width="20" height="6" fill="${color}" rx="1"/>`);
    } else if (durSec >= 1.5 * beatDur) {
        // Half rest
        svgParts.push(`<rect x="${x - 10}" y="${y - 6}" width="20" height="6" fill="${color}" rx="1"/>`);
    } else if (durSec >= 0.75 * beatDur) {
        // Quarter rest
        svgParts.push(`<path d="M${x-4},${y-15} L${x+4},${y-7} L${x-4},${y+1} L${x+2},${y+9} Q${x+4},${y+12} ${x-2},${y+14}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`);
    } else if (durSec >= 0.35 * beatDur) {
        // Eighth rest
        svgParts.push(`<circle cx="${x-3}" cy="${y-4}" r="3" fill="${color}"/>`);
        svgParts.push(`<path d="M${x-3},${y-4} Q${x+5},${y-4} ${x},${y+12}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
    } else {
        // Sixteenth rest
        svgParts.push(`<circle cx="${x-3}" cy="${y-4}" r="2.5" fill="${color}"/>`);
        svgParts.push(`<path d="M${x-3},${y-4} Q${x+5},${y-4} ${x},${y+12}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`);
        svgParts.push(`<circle cx="${x-5}" cy="${y+2}" r="2.5" fill="${color}"/>`);
        svgParts.push(`<path d="M${x-5},${y+2} Q${x+3},${y+2} ${x-2},${y+8}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`);
    }
}

// ── Main sheet music renderer ─────────────────────────────────────────────
export function renderSheetMusic(notes, chords, chordDurSec) {
    // Cache for ResizeObserver re-renders
    state.lastSheetNotes  = notes;
    state.lastSheetChords = chords;
    state.lastSheetDur    = chordDurSec;

    state.sheetNoteData    = [];
    state.sheetMeasureData = [];

    const section   = document.getElementById('sheetMusicSection');
    const container = document.getElementById('sheetMusicContainer');
    if (!notes.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    // ── Layout constants ──────────────────────────────────────────────────
    const STAFF_LINE_SPACING = 11;   // px between staff lines
    const HALF_STEP_PX       = STAFF_LINE_SPACING / 2; // px per diatonic step
    const CLEF_W             = 44;   // clef + key-sig area width
    const TIMESIG_W          = 22;   // time-signature area width
    const MIN_BAR_W          = 240;  // minimum bar width before row-wrapping

    const containerW   = container.clientWidth || section.clientWidth || 800;
    const availW       = containerW - CLEF_W - TIMESIG_W - 6;
    const numMeasures  = chords.length;
    const MEAS_PER_ROW = Math.max(1, Math.floor(availW / MIN_BAR_W));
    const MEAS_W       = availW / Math.min(numMeasures, MEAS_PER_ROW);

    const ROW_H      = 160;
    const STAFF_GAP  = 45;
    const TREBLE_BOT = 56;                                     // y of treble bottom line (E4)
    const BASS_BOT   = TREBLE_BOT + 4 * STAFF_LINE_SPACING + STAFF_GAP; // y of bass bottom line (G2)

    const NOTE_HEAD_W  = 8;   // note head half-width
    const NOTE_HEAD_H  = 5;   // note head half-height
    const STEM_H       = 28;  // stem length (px)
    const NOTE_PAD_L   = 28;  // padding left inside measure note area
    const NOTE_PAD_R   = 16;  // padding right

    const numRows = Math.ceil(numMeasures / MEAS_PER_ROW);
    const svgW    = containerW;
    const svgH    = numRows * ROW_H + 10;

    const svgParts = [];
    svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" style="display:block;">`);
    svgParts.push(`<defs>
      <filter id="smGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`);

    for (let row = 0; row < numRows; row++) {
        const rowY   = row * ROW_H + 5;
        const trbY   = rowY + TREBLE_BOT;             // treble bottom line Y
        const basY   = rowY + BASS_BOT;               // bass bottom line Y
        const trtY   = trbY - 4 * STAFF_LINE_SPACING; // treble top line Y
        const batY   = basY - 4 * STAFF_LINE_SPACING; // bass top line Y

        const noteAreaStartX = CLEF_W + TIMESIG_W;
        const mStart = row * MEAS_PER_ROW;
        const mEnd   = Math.min(mStart + MEAS_PER_ROW, numMeasures);
        const rowEndX = noteAreaStartX + (mEnd - mStart) * MEAS_W;

        // 5 staff lines (treble)
        for (let l = 0; l < 5; l++) {
            const ly = trbY - l * STAFF_LINE_SPACING;
            svgParts.push(`<line x1="0" y1="${ly}" x2="${rowEndX}" y2="${ly}" stroke="#3d4d63" stroke-width="1"/>`);
        }
        // 5 staff lines (bass)
        for (let l = 0; l < 5; l++) {
            const ly = basY - l * STAFF_LINE_SPACING;
            svgParts.push(`<line x1="0" y1="${ly}" x2="${rowEndX}" y2="${ly}" stroke="#3d4d63" stroke-width="1"/>`);
        }

        // Treble clef (𝄞 U+1D11E)
        svgParts.push(`<text x="2" y="${trbY + 6}" font-family="'Times New Roman',Georgia,serif" font-size="56" fill="#506070">&#x1D11E;</text>`);
        // Bass clef (𝄢 U+1D122)
        svgParts.push(`<text x="2" y="${basY - 14}" font-family="'Times New Roman',Georgia,serif" font-size="44" fill="#506070">&#x1D122;</text>`);

        // Time signature 4/4
        const tsx = CLEF_W + TIMESIG_W / 2;
        svgParts.push(`<text x="${tsx}" y="${trbY - STAFF_LINE_SPACING - 1}" text-anchor="middle" font-family="serif" font-size="13" font-weight="bold" fill="#506070">4</text>`);
        svgParts.push(`<text x="${tsx}" y="${trbY + 4}"                      text-anchor="middle" font-family="serif" font-size="13" font-weight="bold" fill="#506070">4</text>`);
        svgParts.push(`<text x="${tsx}" y="${basY - STAFF_LINE_SPACING - 1}" text-anchor="middle" font-family="serif" font-size="13" font-weight="bold" fill="#506070">4</text>`);
        svgParts.push(`<text x="${tsx}" y="${basY + 4}"                      text-anchor="middle" font-family="serif" font-size="13" font-weight="bold" fill="#506070">4</text>`);

        // Opening barlines
        svgParts.push(`<line x1="${noteAreaStartX}" y1="${trtY}" x2="${noteAreaStartX}" y2="${trbY}" stroke="#3d4d63" stroke-width="1.5"/>`);
        svgParts.push(`<line x1="${noteAreaStartX}" y1="${batY}" x2="${noteAreaStartX}" y2="${basY}" stroke="#3d4d63" stroke-width="1.5"/>`);
        // Connecting barline (grand staff)
        svgParts.push(`<line x1="0" y1="${trtY}" x2="0" y2="${basY}" stroke="#3d4d63" stroke-width="1.5"/>`);

        for (let mi = mStart; mi < mEnd; mi++) {
            const mOff   = mi - mStart;
            const mLeft  = noteAreaStartX + mOff * MEAS_W;
            const mRight = mLeft + MEAS_W;
            const tStart = mi * chordDurSec;
            const tEnd   = (mi + 1) * chordDurSec;
            const beatDur = chordDurSec / 4;

            // Measure highlight background
            const mhId = `sh-mh-${mi}`;
            svgParts.push(`<rect id="${mhId}" class="sh-mh" x="${mLeft}" y="${trtY - 3}" width="${MEAS_W}" height="${basY - trtY + 6}" rx="3"/>`);
            state.sheetMeasureData.push({ startSec: tStart, endSec: tEnd, svgRectId: mhId });

            // Chord name label
            svgParts.push(`<text x="${mLeft + MEAS_W / 2}" y="${rowY + 7}" text-anchor="middle" font-family="'Poppins',sans-serif" font-size="10" font-weight="600" fill="#e94560">${chords[mi]}</text>`);

            // Closing barlines
            if (mi === numMeasures - 1) {
                svgParts.push(`<line x1="${mRight - 3}" y1="${trtY}" x2="${mRight - 3}" y2="${basY}" stroke="#3d4d63" stroke-width="3.5"/>`);
                svgParts.push(`<line x1="${mRight - 8}" y1="${trtY}" x2="${mRight - 8}" y2="${basY}" stroke="#3d4d63" stroke-width="1.5"/>`);
            } else {
                svgParts.push(`<line x1="${mRight}" y1="${trtY}" x2="${mRight}" y2="${trbY}" stroke="#3d4d63" stroke-width="1.5"/>`);
                svgParts.push(`<line x1="${mRight}" y1="${batY}" x2="${mRight}" y2="${basY}" stroke="#3d4d63" stroke-width="1.5"/>`);
            }

            const mNotes = notes.filter(n => n.start >= tStart - 0.02 && n.start < tEnd - 0.01);

            if (!mNotes.length) {
                renderRest(svgParts, mLeft + MEAS_W / 2, trbY - 2 * STAFF_LINE_SPACING, 4 * beatDur, beatDur);
                renderRest(svgParts, mLeft + MEAS_W / 2, basY - 2 * STAFF_LINE_SPACING, 4 * beatDur, beatDur);
                continue;
            }

            // Sort + group simultaneous notes
            const sorted = [...mNotes].sort((a, b) => a.start - b.start);
            const groups = [];
            sorted.forEach(n => {
                const last = groups[groups.length - 1];
                if (last && Math.abs(n.start - last[0].start) <= 0.04) {
                    last.push(n);
                } else {
                    groups.push([n]);
                }
            });

            const noteAreaW = MEAS_W - NOTE_PAD_L - NOTE_PAD_R;

            // Fill gaps between notes with rests
            const items = [];
            let currT = tStart;
            groups.forEach(grp => {
                const start = grp[0].start;
                if (start > currT + 0.02) {
                    items.push({ isRest: true, start: currT, duration: start - currT });
                }
                items.push({ isRest: false, grp });
                currT = start + grp[0].duration;
            });
            if (currT < tEnd - 0.02) {
                items.push({ isRest: true, start: currT, duration: tEnd - currT });
            }

            items.forEach((item, ii) => {
                const tOff   = (item.isRest ? item.start : item.grp[0].start) - tStart;
                const groupX = mLeft + NOTE_PAD_L + (tOff / chordDurSec) * noteAreaW;

                if (item.isRest) {
                    renderRest(svgParts, groupX, trbY - 2 * STAFF_LINE_SPACING, item.duration, beatDur);
                    renderRest(svgParts, groupX, basY - 2 * STAFF_LINE_SPACING, item.duration, beatDur);
                    return;
                }

                const grp     = item.grp;
                const durSec  = grp[0].duration;
                const isWhole   = durSec >= 3.5 * beatDur;
                const isHalf    = !isWhole && durSec >= 1.5 * beatDur;
                const isOpen    = isWhole || isHalf;
                const isTriplet = !isWhole && !isHalf && Math.abs(durSec - (beatDur / 3)) < (beatDur * 0.03);
                const isEighth  = !isWhole && !isHalf && !isTriplet && durSec < 0.75 * beatDur;

                const noteData = grp.map(n => _midiToStaffStep(n.note));
                const ngId     = `sh-ng-${mi}-${ii}`;
                svgParts.push(`<g id="${ngId}" class="sh-note-group">`);

                // Triplet "3" marker
                if (isTriplet) {
                    const steps    = noteData.map(nd => nd.step);
                    const maxStep  = Math.max(...steps);
                    const minStep  = Math.min(...steps);
                    const staffY   = noteData[0].clef === 'treble' ? trbY : basY;
                    const markerY  = maxStep >= 4
                        ? staffY - maxStep * HALF_STEP_PX - STEM_H - 12
                        : staffY - minStep * HALF_STEP_PX + STEM_H + 12;
                    svgParts.push(`<text x="${groupX}" y="${markerY}" text-anchor="middle" font-family="serif" font-size="10" font-style="italic" fill="#7a8fa8">3</text>`);
                }

                noteData.forEach((nd, ni) => {
                    const staffBottom = nd.clef === 'treble' ? trbY : basY;
                    const noteY       = staffBottom - nd.step * HALF_STEP_PX;
                    const nhClass     = isOpen ? 'sh-notehead sh-notehead-open' : 'sh-notehead';
                    const stemUp      = nd.step < 4;

                    // Ledger lines below staff
                    if (nd.step <= -2) {
                        for (let i = 1; i <= Math.floor(-nd.step / 2); i++) {
                            const ly = staffBottom - (-i * 2) * HALF_STEP_PX;
                            svgParts.push(`<line x1="${groupX - NOTE_HEAD_W - 4}" y1="${ly}" x2="${groupX + NOTE_HEAD_W + 4}" y2="${ly}" class="sh-ledger"/>`);
                        }
                    }
                    // Ledger lines above staff
                    if (nd.step >= 10) {
                        for (let i = 1; i <= Math.floor((nd.step - 8) / 2); i++) {
                            const ly = staffBottom - (8 + i * 2) * HALF_STEP_PX;
                            svgParts.push(`<line x1="${groupX - NOTE_HEAD_W - 4}" y1="${ly}" x2="${groupX + NOTE_HEAD_W + 4}" y2="${ly}" class="sh-ledger"/>`);
                        }
                    }

                    // Stem
                    if (!isWhole) {
                        const stemX  = stemUp ? groupX + NOTE_HEAD_W - 1 : groupX - NOTE_HEAD_W + 1;
                        const stemY1 = stemUp ? noteY - NOTE_HEAD_H + 1  : noteY + NOTE_HEAD_H - 1;
                        const stemY2 = stemUp ? stemY1 - STEM_H          : stemY1 + STEM_H;
                        svgParts.push(`<line x1="${stemX}" y1="${stemY1}" x2="${stemX}" y2="${stemY2}" class="sh-stem"/>`);

                        // Eighth / triplet flag
                        if (isEighth || isTriplet) {
                            const d = stemUp ? 1 : -1;
                            svgParts.push(`<path d="M${stemX},${stemY2} Q${stemX + d * 12},${stemY2 + d * 6} ${stemX + d * 8},${stemY2 + d * 12}" fill="none" class="sh-stem" stroke-width="1.2"/>`);
                        }
                    }

                    // Note head
                    svgParts.push(`<ellipse cx="${groupX}" cy="${noteY}" rx="${NOTE_HEAD_W}" ry="${NOTE_HEAD_H}" class="${nhClass}"/>`);
                    // Accidental
                    if (_SM_SHARP[grp[ni].note % 12]) {
                        svgParts.push(`<text x="${groupX - NOTE_HEAD_W - 5}" y="${noteY + 4}" font-family="serif" font-size="10" class="sh-accidental">#</text>`);
                    }
                });

                svgParts.push('</g>');
                state.sheetNoteData.push({
                    startSec: grp[0].start,
                    endSec:   grp[0].start + grp[0].duration,
                    svgId:    ngId,
                });
            });
        }
    }

    svgParts.push('</svg>');
    container.innerHTML = svgParts.join('\n');
}

// ── ResizeObserver for responsive sheet re-renders ────────────────────────
export function initSheetResizeObserver() {
    let _observer = null;
    let _lastW    = 0;

    const section = document.getElementById('sheetMusicSection');
    if (!section) return;

    _observer = new ResizeObserver((entries) => {
        if (!state.lastSheetNotes.length) return;
        const w = Math.floor(entries[0].contentRect.width);
        if (Math.abs(w - _lastW) > 4) {
            _lastW = w;
            renderSheetMusic(state.lastSheetNotes, state.lastSheetChords, state.lastSheetDur);
        }
    });
    _observer.observe(section);

    // Disconnect on page unload to prevent memory leaks
    window.addEventListener('pagehide', () => _observer.disconnect(), { once: true });
}

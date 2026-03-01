// ── Strumming / picking pattern logic ───────────────────────────────
// Pure function: given elapsed time within a chord slot and the fret array,
// returns the indices of strings currently being "hit" for visual highlighting.

export function getHitStrings(chordElapsed, chordDurSec, pattern, frets) {
    if (!frets) return [];
    const nonMuted = [];
    for (let i = 0; i < frets.length; i++) {
        if (frets[i] !== 'x') nonMuted.push(i);
    }
    if (!nonMuted.length) return [];

    const beatDur   = chordDurSec / 4;
    const beatIdx   = Math.min(Math.floor(chordElapsed / beatDur), 3);
    const eighthDur = beatDur / 2;
    const eighthIdx = Math.floor(chordElapsed / eighthDur);

    switch (pattern) {
        case 'whole':
            return nonMuted;

        case 'half': {
            const halfDur     = chordDurSec / 2;
            const halfElapsed = chordElapsed % halfDur;
            const lit = [];
            for (let si = 0; si < nonMuted.length; si++) {
                if (halfElapsed >= si * 0.03 && halfElapsed < halfDur - 0.05) lit.push(nonMuted[si]);
            }
            return lit;
        }

        case 'quarter': {
            const beatElapsed = chordElapsed - beatIdx * beatDur;
            const lit = [];
            for (let si = 0; si < nonMuted.length; si++) {
                if (beatElapsed >= si * 0.03 && beatElapsed < beatDur - 0.05) lit.push(nonMuted[si]);
            }
            return lit;
        }

        case 'arpeggio-up': {
            const noteCount = nonMuted.length;
            const noteDur   = chordDurSec / noteCount;
            const noteIdx   = Math.min(Math.floor(chordElapsed / noteDur), noteCount - 1);
            return [nonMuted[noteIdx]];
        }

        case 'arpeggio-down': {
            const reversed  = [...nonMuted].reverse();
            const noteCount = reversed.length;
            const noteDur   = chordDurSec / noteCount;
            const noteIdx   = Math.min(Math.floor(chordElapsed / noteDur), noteCount - 1);
            return [reversed[noteIdx]];
        }

        case 'boom-chick': {
            const bass  = nonMuted[0];
            const upper = nonMuted.slice(1);
            if (beatIdx === 0) return [bass];
            const beatElapsed = chordElapsed - beatIdx * beatDur;
            const lit = [];
            for (let si = 0; si < upper.length; si++) {
                if (beatElapsed >= si * 0.03 && beatElapsed < beatDur - 0.05) lit.push(upper[si]);
            }
            return lit.length ? lit : upper;
        }

        case 'pop-strum': {
            const strumTypes  = ['down', 'down', 'up', null, 'up', 'down', 'up', null];
            const totalEighths = Math.floor(chordDurSec / eighthDur);
            const curEighth   = Math.min(eighthIdx, totalEighths - 1);
            const dir = strumTypes[curEighth % strumTypes.length];
            if (!dir) return [];
            const eighthElapsed = chordElapsed - curEighth * eighthDur;
            const ordered = dir === 'up' ? [...nonMuted].reverse() : [...nonMuted];
            const lit = [];
            for (let si = 0; si < ordered.length; si++) {
                if (eighthElapsed >= si * 0.025 && eighthElapsed < eighthDur - 0.03) lit.push(ordered[si]);
            }
            return lit.length ? lit : ordered;
        }

        case 'travis-picking': {
            if (eighthIdx % 2 === 0) {
                if ((Math.floor(eighthIdx / 2)) % 2 === 0) return [nonMuted[0]];
                return nonMuted.length > 1 ? [nonMuted[1]] : [nonMuted[0]];
            }
            return [nonMuted[nonMuted.length - 1]];
        }

        case 'alberti-bass': {
            switch (eighthIdx % 4) {
                case 0: return [nonMuted[0]];
                case 1:
                case 3:
                    if (nonMuted.length > 2) return [nonMuted[2]];
                    if (nonMuted.length > 1) return [nonMuted[1]];
                    return [nonMuted[0]];
                case 2:
                    if (nonMuted.length > 1) return [nonMuted[1]];
                    return [nonMuted[0]];
            }
            return [nonMuted[0]];
        }

        case 'triplet-arpeggio': {
            const tripletDur = beatDur / 3;
            const tripletIdx = Math.floor(chordElapsed / tripletDur);
            return [nonMuted[tripletIdx % nonMuted.length]];
        }

        case 'pop-stabs': {
            const stabPattern   = [true, false, true, true, false, true, false, false];
            if (stabPattern[eighthIdx % stabPattern.length]) {
                const eighthElapsed = chordElapsed - eighthIdx * eighthDur;
                const lit = [];
                for (let si = 0; si < nonMuted.length; si++) {
                    if (eighthElapsed >= si * 0.025 && eighthElapsed < eighthDur - 0.03) lit.push(nonMuted[si]);
                }
                return lit.length ? lit : nonMuted;
            }
            return [];
        }

        case 'bossa-nova': {
            const chordPattern = [true, false, true, false, false, true, false, true];
            const lit = [];
            if (eighthIdx % 4 === 0) lit.push(nonMuted[0]);
            if (chordPattern[eighthIdx % 8]) {
                for (let si = 1; si < nonMuted.length; si++) lit.push(nonMuted[si]);
                if (nonMuted.length === 1 && !lit.length) lit.push(nonMuted[0]);
            }
            return lit;
        }

        case 'reggae-skank': {
            if (beatIdx % 2 === 1) {
                const beatElapsed = chordElapsed - beatIdx * beatDur;
                if (beatElapsed < beatDur / 4) return nonMuted;
            }
            return [];
        }

        case 'funk-16th': {
            const sixteenthDur = beatDur / 4;
            const sixteenthIdx = Math.floor(chordElapsed / sixteenthDur);
            const funkPattern  = [true, false, false, true, false, false, true, false];
            if (funkPattern[sixteenthIdx % 8]) return nonMuted;
            return [];
        }

        case 'jazz-swing': {
            const jazzPattern = [true, false, false, true, false, false, false, false];
            if (jazzPattern[eighthIdx % 8]) return nonMuted;
            return [];
        }

        case 'rock-8th': {
            const eighthElapsed = chordElapsed - eighthIdx * eighthDur;
            const dir     = (eighthIdx % 2 === 0) ? 'down' : 'up';
            const ordered = dir === 'up' ? [...nonMuted].reverse() : [...nonMuted];
            const lit = [];
            for (let si = 0; si < ordered.length; si++) {
                if (eighthElapsed >= si * 0.025 && eighthElapsed < eighthDur - 0.03) lit.push(ordered[si]);
            }
            return lit.length ? lit : ordered;
        }

        case 'let-it-be': {
            const beatElapsed = chordElapsed - beatIdx * beatDur;
            const lit = [];
            if (beatIdx % 2 === 0) lit.push(nonMuted[0]);
            for (let si = 0; si < nonMuted.length; si++) {
                if (beatElapsed >= si * 0.03 && beatElapsed < beatDur - 0.05) lit.push(nonMuted[si]);
            }
            return lit;
        }

        case 'stand-by-me': {
            const pat = [1, 0, 1, 0, 2, 0, 2, 0];
            const p   = pat[eighthIdx % pat.length];
            if (p === 1) return [nonMuted[0]];
            if (p === 2) return nonMuted;
            return [];
        }

        case 'creep-arpeggio':
            return [nonMuted[eighthIdx % nonMuted.length]];

        case 'twist-and-shout': {
            const strumPattern  = ['down', null, 'down', 'up', null, 'down', 'up', 'down'];
            const dir = strumPattern[eighthIdx % 8];
            if (!dir) return [];
            const eighthElapsed = chordElapsed - eighthIdx * eighthDur;
            const ordered = dir === 'up' ? [...nonMuted].reverse() : [...nonMuted];
            const lit = [];
            for (let si = 0; si < ordered.length; si++) {
                if (eighthElapsed >= si * 0.02 && eighthElapsed < eighthDur - 0.03) lit.push(ordered[si]);
            }
            return lit.length ? lit : ordered;
        }

        case 'blues-shuffle': {
            const longDur     = (beatDur * 2) / 3;
            const beatElapsed = chordElapsed % beatDur;
            if (beatElapsed < longDur - 0.05) return nonMuted;
            if (beatElapsed >= longDur && beatElapsed < beatDur - 0.03) return nonMuted;
            return [];
        }

        case 'sweet-home-alabama': {
            const pat = [0, 0, 1, 0, 1, 1, 1, 1];
            if (pat[eighthIdx % pat.length] === 0) return [nonMuted[0]];
            return nonMuted.slice(1).length ? nonMuted.slice(1) : [nonMuted[0]];
        }

        case 'stairway-arpeggio': {
            const idxs = [0, 1, 2, nonMuted.length - 1, nonMuted.length - 2, 1, 2, 0];
            const idx  = idxs[eighthIdx % 8];
            return [nonMuted[idx < nonMuted.length ? idx : nonMuted.length - 1]];
        }

        case 'hotel-california': {
            const idxs = [0, 2, 1, 3];
            const idx  = idxs[eighthIdx % 4];
            return [nonMuted[idx < nonMuted.length ? idx : nonMuted.length - 1]];
        }

        case 'wonderwall-strum': {
            const pat = [true, false, true, false, true, true, true, false, true, false, true, true, true, true, true, true];
            const sixteenthDur = beatDur / 4;
            const sixteenthIdx = Math.floor(chordElapsed / sixteenthDur);
            if (!pat[sixteenthIdx % 16]) return [];
            return nonMuted;
        }

        case 'blackbird-pick': {
            if (eighthIdx % 2 === 0) return [nonMuted[0], nonMuted[nonMuted.length - 1]];
            return [nonMuted[1 % nonMuted.length]];
        }

        case 'palm-mute-8th': {
            const eighthElapsed = chordElapsed - eighthIdx * eighthDur;
            if (eighthElapsed < eighthDur / 2 - 0.02) return nonMuted;
            return [];
        }

        case 'off-beat-8th':
            if (eighthIdx % 2 === 1) return nonMuted;
            return [];

        case 'country-alt-bass': {
            if (beatIdx === 0) return [nonMuted[0]];
            if (beatIdx === 2) return nonMuted.length > 2 ? [nonMuted[2]] : [nonMuted[0]];
            return nonMuted;
        }

        case 'pima-arpeggio': {
            const pimaIdxs = [0, 1, 2, nonMuted.length - 1, 2, 1, 0, 1];
            const idx = pimaIdxs[eighthIdx % 8];
            return [nonMuted[idx < nonMuted.length ? idx : nonMuted.length - 1]];
        }

        case 'four-on-the-floor':
            return nonMuted;

        default:
            return nonMuted;
    }
}

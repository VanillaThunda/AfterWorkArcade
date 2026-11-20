"use strict";

/**
 * Mäxchen (auch „Meiern“) – Server-Teil.
 *
 * Bluff-Würfelspiel mit 2 Würfeln unter einem Becher:
 *  - Wert eines Wurfs: höhere Augenzahl als Zehner (3 und 5 → 53).
 *    Rangfolge: 31 < 32 < 41 < … < 65 < Pasch 1 < … < Pasch 6 < Mäxchen (21).
 *  - Wer am Zug ist, würfelt (nur er sieht den Wurf) und sagt einen Wert an,
 *    der höher sein muss als die vorige Ansage – Lügen ist erlaubt.
 *  - Der Nächste glaubt (übernimmt den Becher und würfelt selbst) oder
 *    zweifelt an (Becher wird für alle aufgedeckt):
 *      echter Wurf ≥ Ansage → Zweifler verliert 1 Leben, sonst der Ansager.
 *  - Ansage Mäxchen: aufdecken (echt → Zweifler −2, gelogen → Ansager −1)
 *    oder hinnehmen (−1, ohne Aufdecken).
 *  - Wer ein Leben verliert, beginnt die nächste Runde (Ansagen starten neu).
 *    Mit 0 Leben scheidet man aus; wer zuletzt übrig ist, gewinnt.
 *
 * Phasen:  setup → playing → finished → (Neue Partie) setup
 * Runden-Stufen (round.stage): roll → announce → decide → (roll … | reveal)
 *
 * Nutzt tick() (Zugtimer, Bots, Pause nach dem Aufdecken) und viewFor()
 * (den Wurf unter dem Becher sieht nur, wer ihn gewürfelt hat).
 */

const crypto = require("crypto");
const { pickBotNames } = require("../../server/bot-names");

// ===========================================================================
// Einstellungen
// ===========================================================================

const MAX_PARTICIPANTS = 10;
const MAX_BOTS = 5;
const DEFAULT_BOTS = 2;
const MIN_LIVES = 1;
const MAX_LIVES = 5;
const DEFAULT_LIVES = 3;
const TURN_MS = 30_000;      // Zugtimer für Menschen (je Schritt)
const BOT_STEP_MS = 900;     // Pause vor einer Bot-Aktion
const REVEAL_MS = 6_000;     // Anzeige nach dem Aufdecken, danach nächste Runde
const LOG_SIZE = 8;
const MAEXCHEN = 21;

/** Alle Werte in aufsteigender Rangfolge (Index = Rang). */
const VALUES = Object.freeze([31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 21]);

// ===========================================================================
// Zufall (austauschbar für Tests)
// ===========================================================================

let randomDie = () => crypto.randomInt(1, 7);
let randomChance = () => Math.random();

/** Tests: Würfel (und optional Bot-Zufall) vorgeben; ohne Argument zurücksetzen. */
function setRandom(dieFn, chanceFn) {
    randomDie = dieFn ?? (() => crypto.randomInt(1, 7));
    randomChance = chanceFn ?? (() => Math.random());
}

// ===========================================================================
// Wertung
// ===========================================================================

/** Wert eines Wurfs aus zwei Würfeln, z. B. [3, 5] → 53, [1, 2] → 21, [4, 4] → 44. */
function valueOf(dice) {
    const high = Math.max(dice[0], dice[1]);
    const low = Math.min(dice[0], dice[1]);
    if (high === 2 && low === 1) return MAEXCHEN;
    if (high === low) return high * 11;
    return high * 10 + low;
}

/** Rang 0–20 eines Werts, -1 für ungültige Werte. */
function rankOf(value) {
    return VALUES.indexOf(value);
}

function labelOf(value) {
    if (value === MAEXCHEN) return "Mäxchen";
    if (value % 11 === 0) return `${value / 11}er-Pasch`;
    return String(value);
}

/** Wahrscheinlichkeit, dass ein ehrlicher Wurf mindestens den Rang r erreicht. */
const PROB_AT_LEAST = (() => {
    const counts = new Array(VALUES.length).fill(0);
    for (let a = 1; a <= 6; a++) {
        for (let b = 1; b <= 6; b++) counts[rankOf(valueOf([a, b]))]++;
    }
    const result = new Array(VALUES.length).fill(0);
    let sum = 0;
    for (let r = VALUES.length - 1; r >= 0; r--) {
        sum += counts[r];
        result[r] = sum / 36;
    }
    return result;
})();

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function getParticipant(state, id) {
    return state.participants.find(p => p.id === id) ?? null;
}

function nameOf(state, id) {
    return getParticipant(state, id)?.name ?? "?";
}

function activeParticipants(state) {
    return state.participants.filter(p => !p.out);
}

function currentId(state) {
    const round = state.round;
    return round ? round.order[round.index] : null;
}

/** Erster aktiver Teilnehmer ab `id` (einschließlich) in Sitzreihenfolge. */
function nextActiveFrom(state, id) {
    const list = state.participants;
    const start = Math.max(0, list.findIndex(p => p.id === id));
    for (let k = 0; k < list.length; k++) {
        const candidate = list[(start + k) % list.length];
        if (!candidate.out) return candidate.id;
    }
    return null;
}

/** Kleinster erlaubter Rang für die nächste Ansage. */
function minRank(round) {
    return round.announcement ? rankOf(round.announcement.value) + 1 : 0;
}

// ===========================================================================
// Ablauf
// ===========================================================================

function startRound(state, starterId, now) {
    const active = activeParticipants(state);
    const startIndex = Math.max(0, active.findIndex(p => p.id === starterId));
    const order = [...active.slice(startIndex), ...active.slice(0, startIndex)].map(p => p.id);

    state.roundNumber += 1;
    state.round = {
        number: state.roundNumber,
        order,
        index: 0,
        stage: "roll",
        dice: null,
        holderId: null,
        announcement: null,
        throws: 0,
        turnEndsAt: null,
        botNextAt: null
    };
    state.reveal = null;
    state.nextRoundAt = null;
    beginStep(state, now);
}

/** Startet Zugtimer bzw. Bot-Pause für den aktuellen Schritt. */
function beginStep(state, now) {
    const round = state.round;
    const participant = getParticipant(state, currentId(state));
    round.turnEndsAt = participant.bot ? null : now + TURN_MS;
    round.botNextAt = participant.bot ? now + BOT_STEP_MS : null;
}

function doRoll(state, id, now) {
    const round = state.round;
    round.dice = [randomDie(), randomDie()];
    round.holderId = id;
    round.throws += 1;
    round.stage = "announce";
    beginStep(state, now);
}

function doAnnounce(state, id, value, now) {
    const round = state.round;
    const rank = rankOf(value);
    if (rank === -1) throw new Error("Diesen Wert gibt es nicht.");
    if (rank < minRank(round)) {
        throw new Error(`Du musst mehr als ${labelOf(round.announcement.value)} ansagen.`);
    }
    round.announcement = { value, by: id };
    addLog(state, `${nameOf(state, id)} sagt ${labelOf(value)} an.`);
    round.index = (round.index + 1) % round.order.length;
    round.stage = "decide";
    beginStep(state, now);
}

function doBelieve(state, id, now) {
    const round = state.round;
    if (round.announcement.value === MAEXCHEN) {
        throw new Error("Mäxchen lässt sich nicht überbieten – aufdecken oder hinnehmen.");
    }
    addLog(state, `${nameOf(state, id)} glaubt und würfelt weiter.`);
    round.stage = "roll";
    beginStep(state, now);
}

function doDoubt(state, id, now) {
    const round = state.round;
    const { value: announced, by: announcerId } = round.announcement;
    const actual = valueOf(round.dice);
    const truthful = rankOf(actual) >= rankOf(announced);

    let loserId;
    let lives;
    if (announced === MAEXCHEN) {
        loserId = actual === MAEXCHEN ? id : announcerId;
        lives = actual === MAEXCHEN ? 2 : 1;
    } else {
        loserId = truthful ? id : announcerId;
        lives = 1;
    }

    const headline = truthful ? "Stimmt!" : "Gelogen!";
    const text = `${nameOf(state, announcerId)} hatte ${labelOf(actual)} (angesagt: ${labelOf(announced)}).`;
    addLog(state, `${nameOf(state, id)} deckt auf: ${labelOf(actual)} statt ${labelOf(announced)} – ${headline}`);
    applyLoss(state, { loserId, lives, doubterId: id, dice: [...round.dice], truthful, text }, now);
}

function doAccept(state, id, now) {
    const round = state.round;
    if (round.announcement.value !== MAEXCHEN) {
        throw new Error("Hinnehmen geht nur bei einem angesagten Mäxchen.");
    }
    addLog(state, `${nameOf(state, id)} nimmt das Mäxchen hin.`);
    applyLoss(state, {
        loserId: id,
        lives: 1,
        doubterId: null,
        dice: null, // wird nicht aufgedeckt
        truthful: null,
        text: `${nameOf(state, id)} nimmt das Mäxchen hin, ohne aufzudecken.`
    }, now);
}

function applyLoss(state, { loserId, lives, doubterId, dice, truthful, text }, now) {
    const round = state.round;
    const loser = getParticipant(state, loserId);
    loser.lives = Math.max(0, loser.lives - lives);

    let outcome = `${loser.name} verliert ${lives} Leben.`;
    if (loser.lives === 0) {
        loser.out = true;
        state.eliminated.push(loserId);
        outcome = `${loser.name} verliert ${lives} Leben und scheidet aus.`;
    }
    addLog(state, outcome);

    state.reveal = {
        dice,
        announcement: round.announcement,
        doubterId,
        loserId,
        livesLost: lives,
        truthful,
        text,
        outcome
    };
    round.stage = "reveal";
    round.turnEndsAt = null;
    round.botNextAt = null;
    state.nextRoundAt = now + REVEAL_MS;
}

function continueAfterReveal(state, now) {
    const loserId = state.reveal?.loserId ?? currentId(state);
    if (!checkMatchEnd(state)) {
        startRound(state, nextActiveFrom(state, loserId), now);
    }
}

/** Beendet die Partie, wenn nur noch einer (oder kein Mensch mehr) übrig ist. */
function checkMatchEnd(state) {
    const active = activeParticipants(state);
    if (active.length <= 1) {
        finishMatch(state, active[0]?.id ?? null);
        return true;
    }
    if (!active.some(p => !p.bot)) {
        const best = [...active].sort((a, b) => b.lives - a.lives)[0];
        finishMatch(state, best.id, "Kein Mensch mehr im Spiel.");
        return true;
    }
    return false;
}

function finishMatch(state, winnerId, note) {
    const rest = activeParticipants(state)
        .filter(p => p.id !== winnerId)
        .sort((a, b) => b.lives - a.lives)
        .map(p => p.id);
    const placements = [winnerId, ...rest, ...[...state.eliminated].reverse()].filter(Boolean);

    state.phase = "finished";
    state.result = { winnerId, placements };
    if (state.round) {
        state.round.turnEndsAt = null;
        state.round.botNextAt = null;
    }
    state.nextRoundAt = null;
    addLog(state, winnerId ? `${nameOf(state, winnerId)} gewinnt!` : "Partie beendet.");
    if (note) addLog(state, note);
}

function startMatch(state, now) {
    const humans = state.members.map(m => ({ id: m.id, name: m.name, bot: false }));
    const botNames = pickBotNames(state.settings.bots, humans.map(h => h.name));
    const bots = botNames.map((name, i) => ({ id: `bot-${i + 1}`, name, bot: true }));
    const all = [...humans, ...bots].slice(0, MAX_PARTICIPANTS);
    if (all.length < 2) throw new Error("Es werden mindestens 2 Teilnehmer gebraucht – füge Bots hinzu.");

    state.participants = all.map(p => ({ ...p, lives: state.settings.lives, out: false, left: false }));
    state.phase = "playing";
    state.matchNumber += 1;
    state.roundNumber = 0;
    state.eliminated = [];
    state.result = null;
    state.log = [];
    addLog(state, `Partie ${state.matchNumber}: ${all.length} Spieler, je ${state.settings.lives} Leben.`);

    const starter = all[crypto.randomInt(0, all.length)].id;
    startRound(state, starter, now);
}

// ===========================================================================
// Automatik: Zeit abgelaufen und Bots
// ===========================================================================

/** Ansage, wenn die Zeit abläuft: Wahrheit, falls erlaubt, sonst der kleinste erlaubte Wert. */
function autoAnnounceValue(round) {
    const actual = valueOf(round.dice);
    const min = minRank(round);
    return rankOf(actual) >= min ? actual : VALUES[Math.min(min, VALUES.length - 1)];
}

function autoStep(state, id, now) {
    const round = state.round;
    addLog(state, `${nameOf(state, id)}: Zeit abgelaufen.`);
    if (round.stage === "roll") {
        doRoll(state, id, now);
    } else if (round.stage === "announce") {
        doAnnounce(state, id, autoAnnounceValue(round), now);
    } else if (round.stage === "decide") {
        if (round.announcement.value === MAEXCHEN) doAccept(state, id, now);
        else doBelieve(state, id, now);
    }
}

function botAnnounceValue(round) {
    const actual = valueOf(round.dice);
    const min = minRank(round);
    if (rankOf(actual) >= min && randomChance() < 0.9) return actual;
    // Lügen: knapp über der vorigen Ansage, manchmal etwas mehr
    const extra = randomChance() < 0.3 ? 1 + Math.floor(randomChance() * 2) : 0;
    return VALUES[Math.min(min + extra, VALUES.length - 1)];
}

function botStep(state, id, now) {
    const round = state.round;
    if (round.stage === "roll") {
        doRoll(state, id, now);
    } else if (round.stage === "announce") {
        doAnnounce(state, id, botAnnounceValue(round), now);
    } else if (round.stage === "decide") {
        const announced = round.announcement.value;
        if (announced === MAEXCHEN) {
            if (randomChance() < 0.75) doDoubt(state, id, now);
            else doAccept(state, id, now);
            return;
        }
        // Je unwahrscheinlicher die Ansage, desto eher wird gezweifelt.
        const plausible = PROB_AT_LEAST[rankOf(announced)];
        if (randomChance() < (1 - plausible) * 0.85) doDoubt(state, id, now);
        else doBelieve(state, id, now);
    }
}

// ===========================================================================
// Aktionen
// ===========================================================================

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) {
        throw new Error("Das darf nur der Host der Lobby.");
    }
}

function requireStep(state, player, stage) {
    if (state.phase !== "playing" || !state.round) throw new Error("Es läuft gerade keine Partie.");
    if (state.round.stage === "reveal") throw new Error("Die Runde wird gerade aufgedeckt.");
    if (currentId(state) !== player.id) throw new Error("Du bist nicht an der Reihe.");
    if (state.round.stage !== stage) {
        const hints = { roll: "Erst würfeln.", announce: "Erst einen Wert ansagen.", decide: "Erst glauben oder anzweifeln." };
        throw new Error(hints[state.round.stage] ?? "Das geht gerade nicht.");
    }
}

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor der Partie möglich.");
        if (action.bots !== undefined) {
            const bots = Number(action.bots);
            if (!Number.isInteger(bots) || bots < 0 || bots > MAX_BOTS) {
                throw new Error(`Es sind 0 bis ${MAX_BOTS} Bots möglich.`);
            }
            state.settings.bots = bots;
        }
        if (action.lives !== undefined) {
            const lives = Number(action.lives);
            if (!Number.isInteger(lives) || lives < MIN_LIVES || lives > MAX_LIVES) {
                throw new Error(`Es sind ${MIN_LIVES} bis ${MAX_LIVES} Leben möglich.`);
            }
            state.settings.lives = lives;
        }
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Die Partie läuft bereits.");
        startMatch(state, context.now ?? Date.now());
    },

    roll(state, action, player, context) {
        requireStep(state, player, "roll");
        doRoll(state, player.id, context?.now ?? Date.now());
    },

    announce(state, action, player, context) {
        requireStep(state, player, "announce");
        doAnnounce(state, player.id, Number(action.value), context?.now ?? Date.now());
    },

    believe(state, action, player, context) {
        requireStep(state, player, "decide");
        doBelieve(state, player.id, context?.now ?? Date.now());
    },

    doubt(state, action, player, context) {
        requireStep(state, player, "decide");
        doDoubt(state, player.id, context?.now ?? Date.now());
    },

    accept(state, action, player, context) {
        requireStep(state, player, "decide");
        doAccept(state, player.id, context?.now ?? Date.now());
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Die Partie läuft noch.");
        state.phase = "setup";
        state.participants = [];
        state.round = null;
        state.reveal = null;
        state.result = null;
        state.eliminated = [];
        state.log = [];
    }
};

// ===========================================================================
// Sicht eines Spielers (viewFor)
// ===========================================================================

/**
 * Den Wurf unter dem Becher sieht nur, wer ihn gewürfelt hat – alle anderen
 * bekommen dice: null. Aufgedeckte Würfe stehen in state.reveal (öffentlich).
 */
function viewFor(state, userId) {
    const now = Date.now();
    const round = state.round;
    return {
        ...state,
        nextRoundAt: undefined,
        revealRemainingMs: state.nextRoundAt ? Math.max(0, state.nextRoundAt - now) : null,
        round: round && {
            ...round,
            dice: round.stage !== "reveal" && round.holderId === userId ? round.dice : null,
            turnRemainingMs: round.turnEndsAt ? Math.max(0, round.turnEndsAt - now) : null,
            turnEndsAt: undefined,
            botNextAt: undefined
        }
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "maexchen",
        name: "Mäxchen",
        description: "Das Bluff-Würfelspiel: Würfle verdeckt, sag einen höheren Wert an als dein Vorgänger – und lüg, wenn es sein muss. Glauben oder aufdecken? Wer erwischt wird oder falsch zweifelt, verliert ein Leben.",
        minPlayers: 1,
        maxPlayers: MAX_PARTICIPANTS,
        tickMs: 250
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            roundNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            participants: [],
            settings: { bots: DEFAULT_BOTS, maxBots: MAX_BOTS, lives: DEFAULT_LIVES, minLives: MIN_LIVES, maxLives: MAX_LIVES },
            round: null,
            reveal: null,
            result: null,
            eliminated: [],
            nextRoundAt: null,
            turnMs: TURN_MS,
            revealMs: REVEAL_MS,
            values: VALUES,
            log: []
        };
    },

    handleAction(state, action, player, context) {
        const handler = Object.hasOwn(actions, action.type) ? actions[action.type] : null;
        if (!handler) throw new Error("Unbekannte Aktion.");
        const next = structuredClone(state);
        handler(next, action, player, context);
        return next;
    },

    tick(state, { now }) {
        if (state.phase !== "playing" || !state.round) return undefined;
        const round = state.round;

        if (round.stage === "reveal") {
            if (state.nextRoundAt && now >= state.nextRoundAt) {
                const next = structuredClone(state);
                continueAfterReveal(next, now);
                return next;
            }
            return undefined;
        }

        const id = currentId(state);
        const participant = getParticipant(state, id);
        if (participant.bot) {
            if (round.botNextAt && now >= round.botNextAt) {
                const next = structuredClone(state);
                botStep(next, id, now);
                return next;
            }
            return undefined;
        }

        if (round.turnEndsAt && now >= round.turnEndsAt) {
            const next = structuredClone(state);
            autoStep(next, id, now);
            return next;
        }
        return undefined;
    },

    viewFor,

    onPlayerJoin(state, player) {
        const next = structuredClone(state);
        if (!next.members.some(m => m.id === player.id)) {
            next.members.push({ id: player.id, name: player.name });
        }
        const existing = next.participants.find(p => p.id === player.id);
        if (existing) existing.name = player.name;
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);

        const participant = next.participants.find(p => p.id === player.id);
        if (!participant || participant.out || next.phase !== "playing") return next;

        participant.out = true;
        participant.left = true;
        next.eliminated.push(participant.id);
        addLog(next, `${participant.name} hat das Spiel verlassen.`);

        if (checkMatchEnd(next)) return next;

        // Laufende Runde ohne Lebensverlust neu beginnen (der Becher ist ja weg).
        if (next.round && next.round.stage !== "reveal") {
            const now = Date.now();
            addLog(next, "Die Runde beginnt neu.");
            startRound(next, nextActiveFrom(next, currentId(next)), now);
        }
        return next;
    },

    /** Nur für Tests. */
    _internals: {
        VALUES, MAEXCHEN, TURN_MS, BOT_STEP_MS, REVEAL_MS, PROB_AT_LEAST,
        valueOf, rankOf, labelOf, setRandom, currentId, autoAnnounceValue
    }
};

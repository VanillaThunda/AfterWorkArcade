"use strict";

/**
 * Stadt-Land-Fluss – Server-Teil.
 *
 * Partyspiel für 2–8 Spieler (ohne Bots). Pro Runde wird ein Buchstabe gezogen,
 * jeder schreibt zu jeder Kategorie ein Wort mit diesem Anfangsbuchstaben. Wer
 * alle Felder voll hat, darf „Stopp!“ rufen; danach bleiben allen noch
 * GRACE_MS. In der Auswertung liegen alle Antworten offen, jeder kann fremde
 * Antworten anzweifeln – zweifelt mehr als die Hälfte der anderen, zählt die
 * Antwort nicht. Punkte: 20 einzige gültige, 10 einmalig, 5 doppelt.
 *
 * Phasen:  setup → countdown → writing → grace → review → countdown … → finished
 *
 * Kategorien werden über ihren Index in settings.categories angesprochen
 * (eigene Kategorien des Hosts können beliebig heißen).
 *
 * Regeln: rules.js, Daten und Grenzen: data.js.
 */

const crypto = require("crypto");
const data = require("./data");
const rules = require("./rules");

const { LIMITS } = data;
const COUNTDOWN_MS = 3000;
const GRACE_MS = 3000;
const REVIEW_MS = 120_000;
const TICK_MS = 250;
const LOG_SIZE = 8;
const COLORS = ["#e63946", "#1d9bf0", "#2ec27e", "#ffb300", "#a259ff", "#ff8c1a", "#ff5fa2", "#00b8a9"];

let randomIndex = n => crypto.randomInt(0, n);

/** Nur für Tests: Buchstabenwahl vorgeben (fn(n) → Index); ohne Argument zurück auf Zufall. */
function setRandom(fn) {
    randomIndex = fn ?? (n => crypto.randomInt(0, n));
}

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) throw new Error("Das darf nur der Host der Lobby.");
}

const activePlayers = state => state.players.filter(p => !p.left);
/** Spieler, die in der laufenden Runde mitspielen (und noch da sind). */
const participants = state => state.players.filter(p => !p.left && state.round?.participants.includes(p.id));

function requireParticipant(state, player) {
    const p = participants(state).find(x => x.id === player.id);
    if (!p) throw new Error("Du spielst diese Runde nicht mit – ab der nächsten Runde bist du dabei.");
    return p;
}

function categoryIndex(state, value) {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= state.settings.categories.length) throw new Error("Unbekannte Kategorie.");
    return index;
}

const cleanText = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function answersOf(state, id) {
    return state.round.answers[id] ?? (state.round.answers[id] = state.settings.categories.map(() => ""));
}

const isComplete = (state, id) => answersOf(state, id).every(a => a.trim() !== "");
const doubtKey = (playerId, index) => `${playerId}|${index}`;

// ===========================================================================
// Auswertung einer Runde
// ===========================================================================

/**
 * Bewertung aller Antworten der laufenden Runde:
 * { categories: [{ entries: [{ id, text, auto, doubts:[ids], rejected, valid, points }] }], totals: { id: punkte } }
 */
function evaluate(state) {
    const round = state.round;
    const active = participants(state);
    const activeIds = new Set(active.map(p => p.id));
    const totals = Object.fromEntries(active.map(p => [p.id, 0]));
    const categories = state.settings.categories.map((_, index) => {
        const entries = active.map(p => {
            const text = answersOf(state, p.id)[index];
            const auto = rules.autoInvalid(text, round.letter);
            const doubts = (round.doubts[doubtKey(p.id, index)] ?? []).filter(id => activeIds.has(id) && id !== p.id);
            const rejected = !auto && rules.isRejected(doubts.length, active.length - 1);
            return { id: p.id, text, auto, doubts, rejected, valid: !auto && !rejected };
        });
        const points = rules.scoreCategory(entries);
        const normal = entries.filter(e => e.valid).map(e => rules.normalize(e.text));
        for (const e of entries) {
            e.points = points[e.id];
            e.duplicate = e.valid && normal.filter(n => n === rules.normalize(e.text)).length > 1;
            totals[e.id] += e.points;
        }
        return { entries };
    });
    return { categories, totals };
}

// ===========================================================================
// Ablauf
// ===========================================================================

function drawLetter(state) {
    let pool = data.LETTERS.filter(l => !state.usedLetters.includes(l));
    if (pool.length === 0) {
        state.usedLetters = [];
        pool = [...data.LETTERS];
    }
    const letter = pool[randomIndex(pool.length)];
    state.usedLetters.push(letter);
    return letter;
}

/** Neue Runde: Teilnehmer festlegen (inkl. Neuzugänge), Buchstabe ziehen, Countdown. */
function startRound(state, now) {
    for (const m of state.members) {
        if (!state.players.some(p => p.id === m.id) && state.players.length < LIMITS.maxPlayers) {
            state.players.push(makePlayer(m, state.players.length, state.round?.number ?? 0));
            addLog(state, `${m.name} spielt ab jetzt mit.`);
        }
    }
    const number = (state.round?.number ?? 0) + 1;
    state.round = {
        number,
        letter: drawLetter(state),
        participants: activePlayers(state).map(p => p.id),
        answers: {},
        doubts: {},
        ready: [],
        stoppedBy: null,
        endsAt: now + COUNTDOWN_MS,
        scored: false
    };
    for (const id of state.round.participants) answersOf(state, id);
    state.phase = "countdown";
}

function makePlayer(member, index, joinedAfterRound) {
    return {
        id: member.id, name: member.name, color: COLORS[index % COLORS.length],
        left: false, score: 0, roundScores: [], joinedAfterRound
    };
}

function startMatch(state, now) {
    state.players = state.members.slice(0, LIMITS.maxPlayers).map((m, i) => makePlayer(m, i, 0));
    state.usedLetters = [];
    state.round = null;
    state.result = null;
    state.log = [];
    state.matchNumber += 1;
    addLog(state, `Partie ${state.matchNumber}: ${state.settings.rounds} Runden, ${state.settings.categories.length} Kategorien.`);
    startRound(state, now);
}

function beginReview(state, now) {
    state.phase = "review";
    state.round.endsAt = now + REVIEW_MS;
    state.round.ready = [];
}

/** Auswertung abschließen: Punkte gutschreiben, nächste Runde oder Ende. */
function finishReview(state, now) {
    const { totals } = evaluate(state);
    for (const p of participants(state)) {
        p.score += totals[p.id];
        p.roundScores.push({ round: state.round.number, letter: state.round.letter, points: totals[p.id] });
    }
    state.round.scored = true;
    const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) addLog(state, `Runde ${state.round.number} (${state.round.letter}): Bestes Ergebnis ${state.players.find(p => p.id === best[0]).name} mit ${best[1]} Punkten.`);
    else addLog(state, `Runde ${state.round.number} (${state.round.letter}): keine Punkte.`);
    if (state.round.number >= state.settings.rounds) finishMatch(state, "finished");
    else startRound(state, now);
}

function checkAbort(state) {
    if (state.phase === "setup" || state.phase === "finished") return;
    if (activePlayers(state).length === 0) finishMatch(state, "aborted");
}

function finishMatch(state, outcome) {
    const ranked = activePlayers(state).sort((a, b) => b.score - a.score);
    state.phase = "finished";
    if (state.round) state.round.endsAt = null;
    const placements = ranked.map(p => p.id);
    state.result = { outcome, winnerId: placements[0] ?? null, placements };
    if (outcome === "finished" && ranked[0]) addLog(state, `${ranked[0].name} gewinnt mit ${ranked[0].score} Punkten!`);
    else if (outcome === "aborted") addLog(state, "Spiel beendet.");
}

/** Alle (noch aktiven) Teilnehmer bereit → Auswertung beenden. */
function checkAllReady(state, now) {
    if (state.phase !== "review") return;
    const active = participants(state);
    if (active.length > 0 && active.every(p => state.round.ready.includes(p.id))) finishReview(state, now);
}

// ===========================================================================
// Aktionen
// ===========================================================================

function parseCategories(list) {
    if (!Array.isArray(list)) throw new Error("Ungültige Kategorien.");
    const result = [];
    const seen = new Set();
    for (const raw of list) {
        const name = cleanText(raw, LIMITS.categoryLength);
        const key = rules.normalize(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(name);
    }
    if (result.length < LIMITS.minCategories || result.length > LIMITS.maxCategories) {
        throw new Error(`Es sind ${LIMITS.minCategories} bis ${LIMITS.maxCategories} Kategorien möglich.`);
    }
    return result;
}

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor dem Start möglich.");
        if (action.categories !== undefined) state.settings.categories = parseCategories(action.categories);
        if (action.rounds !== undefined) {
            const rounds = Number(action.rounds);
            if (!data.ROUND_OPTIONS.includes(rounds)) throw new Error("Ungültige Rundenzahl.");
            state.settings.rounds = rounds;
        }
        if (action.roundSeconds !== undefined) {
            const seconds = Number(action.roundSeconds);
            if (!data.SECONDS_OPTIONS.includes(seconds)) throw new Error("Ungültige Zeit pro Runde.");
            state.settings.roundSeconds = seconds;
        }
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Das Spiel läuft bereits.");
        if (state.members.length < LIMITS.minPlayers) throw new Error(`Stadt-Land-Fluss braucht mindestens ${LIMITS.minPlayers} Spieler.`);
        startMatch(state, context.now ?? Date.now());
    },

    answer(state, action, player) {
        if (state.phase !== "writing" && state.phase !== "grace") throw new Error("Gerade kann nichts eingetragen werden.");
        requireParticipant(state, player);
        const index = categoryIndex(state, action.category);
        const text = String(action.text ?? "").replace(/\s+/g, " ").slice(0, LIMITS.answerLength);
        const answers = answersOf(state, player.id);
        if (answers[index] === text) return false;
        answers[index] = text;
    },

    stop(state, action, player, context) {
        if (state.phase !== "writing") throw new Error("Gerade kann niemand Stopp rufen.");
        const p = requireParticipant(state, player);
        if (!isComplete(state, p.id)) throw new Error("Erst alle Felder ausfüllen, dann Stopp rufen.");
        state.phase = "grace";
        state.round.stoppedBy = p.id;
        state.round.endsAt = (context.now ?? Date.now()) + GRACE_MS;
        addLog(state, `${p.name} ruft Stopp!`);
    },

    doubt(state, action, player, context) {
        if (state.phase !== "review") throw new Error("Anzweifeln geht nur in der Auswertung.");
        requireParticipant(state, player);
        const index = categoryIndex(state, action.category);
        const target = participants(state).find(p => p.id === action.playerId);
        if (!target) throw new Error("Unbekannter Spieler.");
        if (target.id === player.id) throw new Error("Eigene Antworten kannst du nicht anzweifeln.");
        if (rules.autoInvalid(answersOf(state, target.id)[index], state.round.letter)) throw new Error("Diese Antwort zählt ohnehin nicht.");
        const key = doubtKey(target.id, index);
        const list = state.round.doubts[key] ?? [];
        state.round.doubts[key] = list.includes(player.id) ? list.filter(id => id !== player.id) : [...list, player.id];
        // Wer noch zweifelt, ist nicht mehr „fertig“ – damit niemand überrumpelt wird
        state.round.ready = [];
        void context;
    },

    ready(state, action, player, context) {
        if (state.phase !== "review") throw new Error("Gerade gibt es nichts zu bestätigen.");
        const p = requireParticipant(state, player);
        const ready = state.round.ready;
        state.round.ready = ready.includes(p.id) ? ready.filter(id => id !== p.id) : [...ready, p.id];
        checkAllReady(state, context.now ?? Date.now());
    },

    "end-review"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "review") throw new Error("Gerade läuft keine Auswertung.");
        finishReview(state, context.now ?? Date.now());
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Das Spiel läuft noch.");
        Object.assign(state, { phase: "setup", players: [], round: null, result: null, log: [] });
    }
};

// ===========================================================================
// Sicht: fremde Antworten bleiben beim Schreiben verdeckt
// ===========================================================================

function viewFor(state, userId) {
    const now = Date.now();
    const { round, ...rest } = state;
    if (!round) return { ...rest, round: null };
    const open = state.phase === "review" || state.phase === "finished";
    const view = {
        number: round.number,
        letter: state.phase === "countdown" ? null : round.letter,
        participants: round.participants,
        stoppedBy: round.stoppedBy,
        ready: round.ready,
        remainingMs: round.endsAt ? Math.max(0, round.endsAt - now) : null,
        progress: Object.fromEntries(round.participants.map(id => [id, (round.answers[id] ?? []).filter(a => a.trim()).length])),
        mine: round.answers[userId] ?? null,
        answers: open ? round.answers : null,
        doubts: open ? round.doubts : null,
        evaluation: open && !round.scored ? evaluate(state) : null
    };
    return { ...rest, usedLetters: undefined, round: view };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "stadtlandfluss",
        name: "Stadt-Land-Fluss",
        description: "Ein Buchstabe, viele Kategorien: Wer zuerst alles ausgefüllt hat, ruft Stopp. Danach wird gemeinsam angezweifelt – die Mehrheit entscheidet.",
        minPlayers: LIMITS.minPlayers,
        maxPlayers: LIMITS.maxPlayers,
        tickMs: TICK_MS
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            settings: { categories: [...data.DEFAULT_CATEGORIES], rounds: data.DEFAULT_ROUNDS, roundSeconds: data.DEFAULT_SECONDS },
            catalog: {
                presets: [...data.PRESET_CATEGORIES],
                roundOptions: [...data.ROUND_OPTIONS],
                secondsOptions: [...data.SECONDS_OPTIONS],
                limits: { ...LIMITS },
                points: { ...data.POINTS },
                graceMs: GRACE_MS,
                reviewMs: REVIEW_MS,
                countdownMs: COUNTDOWN_MS
            },
            players: [],
            usedLetters: [],
            round: null,
            result: null,
            log: []
        };
    },

    handleAction(state, action, player, context = {}) {
        const handler = Object.hasOwn(actions, action.type) ? actions[action.type] : null;
        if (!handler) throw new Error("Unbekannte Aktion.");
        const next = structuredClone(state);
        const result = handler(next, action, player, context);
        return result === false ? undefined : next;
    },

    tick(state, { now } = {}) {
        const time = now ?? Date.now();
        if (!state.round?.endsAt || time < state.round.endsAt) return undefined;
        if (!["countdown", "writing", "grace", "review"].includes(state.phase)) return undefined;
        const next = structuredClone(state);
        if (next.phase === "countdown") {
            next.phase = "writing";
            next.round.endsAt = time + next.settings.roundSeconds * 1000;
        } else if (next.phase === "writing") {
            addLog(next, "Die Zeit ist um!");
            beginReview(next, time);
        } else if (next.phase === "grace") {
            beginReview(next, time);
        } else {
            finishReview(next, time);
        }
        return next;
    },

    viewFor,

    onPlayerJoin(state, player) {
        const next = structuredClone(state);
        if (!next.members.some(m => m.id === player.id)) next.members.push({ id: player.id, name: player.name });
        const known = next.players.find(p => p.id === player.id);
        if (known?.left && next.phase !== "setup" && next.phase !== "finished") {
            known.left = false;  // zurück (z. B. nach Verbindungsabbruch): Punkte und Antworten bleiben
            addLog(next, `${known.name} ist wieder da.`);
        }
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);
        const p = next.players.find(x => x.id === player.id);
        if (!p || p.left || next.phase === "setup" || next.phase === "finished") return next;
        p.left = true;
        addLog(next, `${p.name} hat das Spiel verlassen.`);
        checkAbort(next);
        checkAllReady(next, Date.now());
        return next;
    },

    /** Nur für Tests. */
    _internals: { COUNTDOWN_MS, GRACE_MS, REVIEW_MS, data, rules, evaluate, setRandom }
};

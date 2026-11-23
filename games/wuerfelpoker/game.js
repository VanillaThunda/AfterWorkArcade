"use strict";

/**
 * Fünf-Würfel-Poker – Server-Teil.
 *
 * Würfelspiel im Yacht-Genre (eigene Umsetzung): 5 Würfel, bis zu 3 Würfe pro
 * Zug, 13 Felder auf dem Punktzettel. Alle spielen GLEICHZEITIG – jeder auf
 * seinem eigenen Zettel, für alle live sichtbar. Wer alle Felder voll hat,
 * wartet; sind alle fertig, gewinnt die höchste Gesamtpunktzahl.
 *
 * Phasen:  setup → playing → finished
 *
 * Zug eines Teilnehmers: turn = { dice[5], held[5], rolls }. „roll“ würfelt die
 * nicht gehaltenen Würfel neu (beim ersten Wurf alle), „score“ trägt ein Feld
 * ein und beginnt den nächsten Zug. Pro Feld hat ein Mensch TURN_MS Zeit, danach
 * spielt die Bot-Logik („mittel“) den Zug für ihn zu Ende.
 *
 * Punkte und Felder: scoring.js, Bot-Entscheidungen: bots.js.
 */

const crypto = require("crypto");
const { pickBotNames } = require("../../server/bot-names");
const scoring = require("./scoring");
const bots = require("./bots");

const { CATEGORIES, UPPER, LABELS } = scoring;

const MAX_PARTICIPANTS = 8;
const MAX_BOTS = 7;
const DEFAULT_BOTS = 1;
const DEFAULT_BOT_LEVEL = "mittel";
const MAX_ROLLS = 3;
const TURN_MS = 90_000;        // Zeit pro Feld für Menschen
const BOT_STEP_MS = 800;       // Pause zwischen zwei Bot-Schritten
const BOT_JITTER_MS = 400;
const TICK_MS = 200;
const LOG_SIZE = 8;
const COLORS = ["#e63946", "#1d9bf0", "#2ec27e", "#ffb300", "#a259ff", "#ff8c1a", "#ff5fa2", "#00b8a9"];

let randomDie = () => crypto.randomInt(1, 7);
let randomUnit = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

/** Nur für Tests: Würfel (und Bot-Takt-Zufall) vorgeben; ohne Argument zurück auf Zufall. */
function setRandom(fn) {
    randomDie = fn ?? (() => crypto.randomInt(1, 7));
}

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

const emptyTurn = () => ({ dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false], rolls: 0 });
const isDone = p => scoring.filledCount(p.sheet) === CATEGORIES.length;
const activePlayers = state => state.players.filter(p => !p.left);

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) throw new Error("Das darf nur der Host der Lobby.");
}

function requirePlayer(state, player) {
    if (state.phase !== "playing") throw new Error("Gerade läuft keine Partie.");
    const p = state.players.find(x => x.id === player.id && !x.left && !x.bot);
    if (!p) throw new Error("Du schaust bei dieser Partie nur zu.");
    if (isDone(p)) throw new Error("Dein Zettel ist schon voll.");
    return p;
}

function parseHeld(held) {
    if (!Array.isArray(held) || held.length !== 5) throw new Error("Ungültige Auswahl der Würfel.");
    return held.map(Boolean);
}

function botDelay() {
    return BOT_STEP_MS + Math.floor(randomUnit() * BOT_JITTER_MS);
}

// ===========================================================================
// Ablauf
// ===========================================================================

function startMatch(state, now) {
    const humans = state.members.slice(0, MAX_PARTICIPANTS);
    const botCount = Math.min(state.settings.bots, MAX_PARTICIPANTS - humans.length);
    const names = pickBotNames(botCount, humans.map(h => h.name));
    if (botCount > 0 && state.settings.botLevel === "schwer") bots.warmUp();
    const make = (id, name, bot) => ({
        id, name, bot, level: bot ? state.settings.botLevel : null, left: false,
        sheet: scoring.emptySheet(), extra: 0, turn: emptyTurn(), rollNo: 0,
        turnEndsAt: bot ? null : now + TURN_MS, nextBotAt: bot ? now + botDelay() : null
    });
    state.players = [
        ...humans.map(m => make(m.id, m.name, false)),
        ...Array.from({ length: botCount }, (_, i) => make(`bot-${i + 1}`, names[i], true))
    ].map((p, i) => ({ ...p, color: COLORS[i % COLORS.length] }));
    state.phase = "playing";
    state.result = null;
    state.log = [];
    state.matchNumber += 1;
    addLog(state, `Partie ${state.matchNumber}: Alle würfeln gleichzeitig – viel Glück!`);
}

function doRoll(state, p, held, now) {
    if (p.turn.rolls >= MAX_ROLLS) throw new Error(`Mehr als ${MAX_ROLLS} Würfe gehen nicht – trag ein Feld ein.`);
    const first = p.turn.rolls === 0;
    if (!first && held.every(Boolean)) throw new Error("Alle Würfel sind gehalten – trag ein Feld ein.");
    p.turn.dice = p.turn.dice.map((value, i) => (!first && held[i] ? value : randomDie()));
    p.turn.held = first ? [false, false, false, false, false] : held;
    p.turn.rolls += 1;
    p.rollNo += 1;
    if (p.bot) p.nextBotAt = now + botDelay();
}

function doScore(state, p, category, now) {
    if (!CATEGORIES.includes(category)) throw new Error("Unbekanntes Feld.");
    if (p.turn.rolls === 0) throw new Error("Erst würfeln, dann eintragen.");
    if (p.sheet[category] !== null) throw new Error("Dieses Feld ist schon belegt.");
    const dice = p.turn.dice;
    if (scoring.isFiver(dice) && p.sheet.fiver === scoring.FIXED.fiver) {
        p.extra += scoring.EXTRA_FIVER;
        addLog(state, `${p.name}: noch ein Fünferpasch! +${scoring.EXTRA_FIVER} Bonus.`);
    } else if (category === "fiver" && scoring.isFiver(dice)) {
        addLog(state, `${p.name} hat einen Fünferpasch!`);
    }
    p.sheet[category] = scoring.scoreFor(category, dice);
    p.turn = emptyTurn();
    if (isDone(p)) {
        p.turnEndsAt = null;
        p.nextBotAt = null;
        addLog(state, `${p.name} ist fertig: ${scoring.totals(p.sheet, p.extra).total} Punkte.`);
    } else {
        p.turnEndsAt = p.bot ? null : now + TURN_MS;
        if (p.bot) p.nextBotAt = now + botDelay();
    }
    checkEnd(state);
}

/** Ein Schritt nach Bot-Logik (für Bots und abgelaufene Zeit). */
function autoStep(state, p, level, now) {
    const decision = bots.decide(p.sheet, p.turn, level, MAX_ROLLS);
    if (decision.type === "roll") doRoll(state, p, decision.held, now);
    else doScore(state, p, decision.category, now);
}

function checkEnd(state) {
    if (state.phase !== "playing") return;
    const active = activePlayers(state);
    if (!active.some(p => !p.bot)) {
        finishMatch(state, "aborted");
        return;
    }
    if (active.every(isDone)) finishMatch(state, "finished");
}

function finishMatch(state, outcome) {
    const ranked = activePlayers(state)
        .map(p => ({ p, t: scoring.totals(p.sheet, p.extra) }))
        .sort((a, b) => (b.t.total - a.t.total) || (b.t.upper + b.t.bonus - a.t.upper - a.t.bonus));
    state.phase = "finished";
    for (const p of state.players) {
        p.turnEndsAt = null;
        p.nextBotAt = null;
    }
    const placements = ranked.map(r => r.p.id);
    state.result = { outcome, winnerId: placements[0] ?? null, placements };
    if (outcome === "finished" && ranked[0]) addLog(state, `${ranked[0].p.name} gewinnt mit ${ranked[0].t.total} Punkten!`);
    else if (outcome === "aborted") addLog(state, "Spiel beendet.");
}

// ===========================================================================
// Aktionen
// ===========================================================================

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor dem Start möglich.");
        if (action.bots !== undefined) {
            const count = Number(action.bots);
            if (!Number.isInteger(count) || count < 0 || count > MAX_BOTS) throw new Error(`Es sind 0 bis ${MAX_BOTS} Bots möglich.`);
            state.settings.bots = count;
        }
        if (action.botLevel !== undefined) {
            if (!Object.hasOwn(bots.LEVELS, action.botLevel)) throw new Error("Unbekannte Bot-Stärke.");
            state.settings.botLevel = action.botLevel;
        }
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Das Spiel läuft bereits.");
        startMatch(state, context.now ?? Date.now());
    },

    roll(state, action, player, context) {
        const p = requirePlayer(state, player);
        doRoll(state, p, parseHeld(action.held ?? [false, false, false, false, false]), context.now ?? Date.now());
    },

    hold(state, action, player) {
        const p = requirePlayer(state, player);
        if (p.turn.rolls === 0) throw new Error("Erst würfeln, dann halten.");
        const held = parseHeld(action.held);
        if (held.every((h, i) => h === p.turn.held[i])) return false;
        p.turn.held = held;
    },

    score(state, action, player, context) {
        const p = requirePlayer(state, player);
        doScore(state, p, action.category, context.now ?? Date.now());
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Das Spiel läuft noch.");
        Object.assign(state, { phase: "setup", players: [], result: null, log: [] });
    }
};

// ===========================================================================
// Sicht (nur Restzeiten umrechnen – es gibt keine geheimen Infos)
// ===========================================================================

function viewFor(state) {
    const now = Date.now();
    return {
        ...state,
        players: state.players.map(({ nextBotAt, turnEndsAt, ...p }) => ({
            ...p,
            totals: scoring.totals(p.sheet, p.extra),
            done: isDone(p),
            turnRemainingMs: turnEndsAt ? Math.max(0, turnEndsAt - now) : null
        }))
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "wuerfelpoker",
        name: "Fünf-Würfel-Poker",
        description: "Fünf Würfel, drei Würfe, dreizehn Felder: Pasch, Full House, Straßen und Fünferpasch. Alle würfeln gleichzeitig auf ihrem eigenen Zettel – auch gegen Bots.",
        minPlayers: 1,
        maxPlayers: MAX_PARTICIPANTS,
        tickMs: TICK_MS
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            settings: { bots: DEFAULT_BOTS, maxBots: MAX_BOTS, botLevel: DEFAULT_BOT_LEVEL },
            catalog: {
                categories: CATEGORIES.map(id => ({ id, label: LABELS[id], upper: UPPER.includes(id) })),
                levels: Object.fromEntries(Object.entries(bots.LEVELS).map(([id, l]) => [id, l.name])),
                upperBonusAt: scoring.UPPER_BONUS_AT, upperBonus: scoring.UPPER_BONUS, extraFiver: scoring.EXTRA_FIVER,
                maxRolls: MAX_ROLLS, turnMs: TURN_MS, maxParticipants: MAX_PARTICIPANTS
            },
            players: [],
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
        if (state.phase !== "playing") return undefined;
        const time = now ?? Date.now();
        const due = state.players.filter(p => !p.left && !isDone(p) &&
            ((p.bot && p.nextBotAt !== null && time >= p.nextBotAt) || (!p.bot && p.turnEndsAt !== null && time >= p.turnEndsAt)));
        if (due.length === 0) return undefined;
        const next = structuredClone(state);
        for (const { id } of due) {
            const p = next.players.find(x => x.id === id);
            if (next.phase !== "playing") break;
            if (p.bot) {
                autoStep(next, p, p.level, time);
            } else {
                // Zeit abgelaufen: Zug nach Bot-Logik zu Ende spielen
                let guard = 0;
                const filled = scoring.filledCount(p.sheet);
                while (scoring.filledCount(p.sheet) === filled && guard++ < 5) autoStep(next, p, DEFAULT_BOT_LEVEL, time);
                addLog(next, `${p.name}: Zeit abgelaufen – automatisch eingetragen.`);
            }
        }
        return next;
    },

    viewFor,

    onPlayerJoin(state, player) {
        const next = structuredClone(state);
        if (!next.members.some(m => m.id === player.id)) next.members.push({ id: player.id, name: player.name });
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);
        const p = next.players.find(x => x.id === player.id);
        if (!p || p.left || next.phase !== "playing") return next;
        p.left = true;
        p.turnEndsAt = null;
        addLog(next, `${p.name} hat das Spiel verlassen.`);
        checkEnd(next);
        return next;
    },

    /** Nur für Tests. */
    _internals: {
        MAX_PARTICIPANTS, MAX_BOTS, MAX_ROLLS, TURN_MS, BOT_STEP_MS, BOT_JITTER_MS, scoring, bots, setRandom
    }
};

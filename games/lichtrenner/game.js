"use strict";

/**
 * Lichtrenner – Server-Teil.
 *
 * Echtzeitspiel im Lichtspur-Genre: Alle fahren gleichzeitig über ein Raster
 * und ziehen eine Spur hinter sich her. Wer gegen die Wand, eine Spur oder
 * gleichzeitig mit jemandem auf dasselbe Feld fährt, scheidet aus. Der Letzte
 * gewinnt die Runde; wer zuerst die eingestellte Zahl Siege hat, die Partie.
 *
 * Phasen:  setup → countdown → running → roundOver → countdown … → finished
 *
 * Bewegung: tick() alle meta.tickMs (100 ms) – jeder fährt 1 Feld. Eingaben
 * (turn) werden pro Spieler in einer kurzen Warteschlange (max. 2) gesammelt
 * und je Tick eine übernommen, damit schnelle Doppelkurven nicht verloren gehen.
 *
 * Die Arena ist ein Text mit einem Zeichen pro Feld ("." frei, "A"–"H" Spur
 * von Spieler 0–7) – kompakt genug, um ihn bei jedem Tick zu verschicken.
 */

const { pickBotNames } = require("../../server/bot-names");

// ===========================================================================
// Einstellungen
// ===========================================================================

const WIDTH = 64;
const HEIGHT = 40;
const EMPTY = ".";
const OWNER_CHARS = "ABCDEFGH";
const MAX_PARTICIPANTS = OWNER_CHARS.length; // 8
const MAX_BOTS = 7;
const DEFAULT_BOTS = 3;
const MIN_WINS = 1;
const MAX_WINS = 5;
const DEFAULT_WINS = 3;
const TICK_MS = 100;
const COUNTDOWN_MS = 3_000;
const ROUND_PAUSE_MS = 3_000;
const ROUND_MAX_TICKS = 1_200;   // 120 s – danach Unentschieden
const QUEUE_SIZE = 2;
const BOT_LOOKAHEAD = 300;       // max. Felder, die ein Bot pro Richtung „ertastet“
const LOG_SIZE = 8;

const COLORS = ["#ff2e63", "#08d9d6", "#f9ed69", "#a3ff12", "#ff9a3c", "#b967ff", "#4d8bff", "#ffffff"];

const DIRS = Object.freeze({
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
});
const OPPOSITE = Object.freeze({ up: "down", down: "up", left: "right", right: "left" });
const TURN_LEFT = Object.freeze({ up: "left", left: "down", down: "right", right: "up" });
const TURN_RIGHT = Object.freeze({ up: "right", right: "down", down: "left", left: "up" });

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

/** Kleiner Zufallsgenerator (mulberry32) mit Zustand als Zahl (wie Revierkampf). */
function createRng(seed) {
    let value = seed >>> 0;
    return {
        next() {
            value = (value + 0x6d2b79f5) >>> 0;
            let t = value;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
        get state() {
            return value;
        }
    };
}

const indexOf = (x, y) => y * WIDTH + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function activePlayers(state) {
    return state.players.filter(p => !p.left);
}

/**
 * Startpunkte gleichmäßig auf einer Ellipse, Blickrichtung zur Mitte.
 * @returns {Array<{x: number, y: number, dir: string}>}
 */
function startPositions(count, offset) {
    const cx = (WIDTH - 1) / 2;
    const cy = (HEIGHT - 1) / 2;
    const rx = WIDTH * 0.38;
    const ry = HEIGHT * 0.36;
    return Array.from({ length: count }, (_, i) => {
        const angle = offset + (2 * Math.PI * i) / count;
        const x = Math.round(cx + rx * Math.cos(angle));
        const y = Math.round(cy + ry * Math.sin(angle));
        const dx = cx - x;
        const dy = cy - y;
        const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
        return { x, y, dir };
    });
}

// ===========================================================================
// Ablauf
// ===========================================================================

function startRound(state, now) {
    const rng = createRng(state.rng);
    const players = activePlayers(state);
    const positions = startPositions(players.length, rng.next() * Math.PI * 2);
    const cells = new Array(WIDTH * HEIGHT).fill(EMPTY);

    // Startplätze zufällig verteilen, damit nicht immer dieselben nebeneinander stehen
    const order = players.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }

    players.forEach((player, k) => {
        const start = positions[order[k]];
        Object.assign(player, { x: start.x, y: start.y, dir: start.dir, queue: [], alive: true, crashedAt: null });
        cells[indexOf(start.x, start.y)] = OWNER_CHARS[state.players.indexOf(player)];
    });

    state.rng = rng.state;
    state.grid = cells.join("");
    state.round += 1;
    state.roundTicks = 0;
    state.roundWinner = null;
    state.phase = "countdown";
    state.phaseEndsAt = now + COUNTDOWN_MS;
    addLog(state, `Runde ${state.round} – macht euch bereit!`);
}

function startMatch(state, now) {
    const humans = state.members.slice(0, MAX_PARTICIPANTS);
    const botCount = Math.min(state.settings.bots, MAX_PARTICIPANTS - humans.length);
    if (humans.length + botCount < 2) {
        throw new Error("Es werden mindestens 2 Teilnehmer gebraucht – füge Bots hinzu.");
    }
    const botNames = pickBotNames(botCount, humans.map(h => h.name));
    const participants = [
        ...humans.map(m => ({ id: m.id, name: m.name, bot: false })),
        ...botNames.map((name, i) => ({ id: `bot-${i + 1}`, name, bot: true }))
    ];
    state.players = participants.map((p, i) => ({
        ...p,
        color: COLORS[i],
        x: 0, y: 0, dir: "right", queue: [],
        alive: false, left: false, crashedAt: null,
        wins: 0, survivedTicks: 0
    }));
    state.matchNumber += 1;
    state.round = 0;
    state.result = null;
    state.log = [];
    startRound(state, now);
}

/** Ein Bewegungsschritt für alle – gleichzeitig. */
function step(state, now) {
    const cells = state.grid.split("");
    const rng = createRng(state.rng);
    const alive = state.players.filter(p => p.alive);

    for (const player of alive) {
        if (player.bot) player.dir = botDirection(state, cells, player, rng);
        while (player.queue.length > 0) {
            const next = player.queue.shift();
            if (next !== OPPOSITE[player.dir]) {
                player.dir = next;
                break;
            }
        }
    }

    // Zielfelder berechnen; doppelt angesteuerte Felder zählen
    const targets = alive.map(player => {
        const [dx, dy] = DIRS[player.dir];
        return { player, x: player.x + dx, y: player.y + dy };
    });
    const counts = new Map();
    for (const t of targets) {
        if (inside(t.x, t.y)) counts.set(indexOf(t.x, t.y), (counts.get(indexOf(t.x, t.y)) ?? 0) + 1);
    }

    const crashed = [];
    for (const t of targets) {
        const blocked = !inside(t.x, t.y) || cells[indexOf(t.x, t.y)] !== EMPTY || counts.get(indexOf(t.x, t.y)) > 1;
        if (blocked) crashed.push(t);
    }
    for (const t of targets) {
        if (crashed.includes(t)) continue;
        t.player.x = t.x;
        t.player.y = t.y;
        t.player.survivedTicks += 1;
        cells[indexOf(t.x, t.y)] = OWNER_CHARS[state.players.indexOf(t.player)];
    }
    for (const t of crashed) {
        t.player.alive = false;
        t.player.queue = [];
        t.player.crashedAt = inside(t.x, t.y) ? { x: t.x, y: t.y } : { x: t.player.x, y: t.player.y };
    }
    if (crashed.length === 1) addLog(state, `${crashed[0].player.name} crasht.`);
    else if (crashed.length > 1) addLog(state, `${crashed.map(t => t.player.name).join(" und ")} crashen.`);

    state.grid = cells.join("");
    state.rng = rng.state;
    state.roundTicks += 1;
    checkRoundEnd(state, now);
}

function checkRoundEnd(state, now) {
    if (state.phase !== "running" && state.phase !== "countdown") return;
    const alive = state.players.filter(p => p.alive);
    if (alive.length <= 1) {
        endRound(state, alive[0] ?? null, now);
    } else if (state.roundTicks >= ROUND_MAX_TICKS) {
        addLog(state, "Zeit abgelaufen – Unentschieden.");
        endRound(state, null, now);
    }
}

function endRound(state, winner, now) {
    state.roundWinner = winner ? winner.id : null;
    if (winner) {
        winner.wins += 1;
        addLog(state, `Runde ${state.round}: ${winner.name} gewinnt.`);
    } else {
        addLog(state, `Runde ${state.round}: Unentschieden.`);
    }

    if (winner && winner.wins >= state.settings.wins) {
        finishMatch(state, winner.id);
        return;
    }
    state.phase = "roundOver";
    state.phaseEndsAt = now + ROUND_PAUSE_MS;
}

function finishMatch(state, winnerId) {
    const placements = [...state.players]
        .sort((a, b) => (b.wins - a.wins) || (b.survivedTicks - a.survivedTicks))
        .map(p => p.id);
    if (winnerId) {
        placements.splice(placements.indexOf(winnerId), 1);
        placements.unshift(winnerId);
    }
    state.phase = "finished";
    state.phaseEndsAt = null;
    state.result = { winnerId, placements };
    const winner = state.players.find(p => p.id === winnerId);
    addLog(state, winner ? `${winner.name} gewinnt die Partie!` : "Partie beendet.");
}

// ===========================================================================
// Bots
// ===========================================================================

/** Wie viele freie Felder sind von (x, y) aus erreichbar (begrenzt)? */
function reachableArea(cells, x, y, limit) {
    const seen = new Set([indexOf(x, y)]);
    const queue = [[x, y]];
    while (queue.length > 0 && seen.size < limit) {
        const [cx, cy] = queue.shift();
        for (const [dx, dy] of Object.values(DIRS)) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!inside(nx, ny)) continue;
            const index = indexOf(nx, ny);
            if (seen.has(index) || cells[index] !== EMPTY) continue;
            seen.add(index);
            queue.push([nx, ny]);
        }
    }
    return seen.size;
}

function botDirection(state, cells, bot, rng) {
    const others = state.players.filter(p => p.alive && p !== bot);
    let best = bot.dir;
    let bestScore = -Infinity;

    for (const dir of [bot.dir, TURN_LEFT[bot.dir], TURN_RIGHT[bot.dir]]) {
        const [dx, dy] = DIRS[dir];
        const x = bot.x + dx;
        const y = bot.y + dy;
        let score;
        if (!inside(x, y) || cells[indexOf(x, y)] !== EMPTY) {
            score = -1000;
        } else {
            score = reachableArea(cells, x, y, BOT_LOOKAHEAD);
            // Felder, die ein anderer Kopf im selben Moment erreichen könnte, sind riskant
            if (others.some(o => Math.abs(o.x - x) + Math.abs(o.y - y) === 1)) score -= 60;
            if (dir === bot.dir) score += 4;
            score += rng.next() * 6; // etwas Unberechenbarkeit
        }
        if (score > bestScore) {
            bestScore = score;
            best = dir;
        }
    }
    return best;
}

// ===========================================================================
// Aktionen
// ===========================================================================

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) {
        throw new Error("Das darf nur der Host der Lobby.");
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
        if (action.wins !== undefined) {
            const wins = Number(action.wins);
            if (!Number.isInteger(wins) || wins < MIN_WINS || wins > MAX_WINS) {
                throw new Error(`Es sind ${MIN_WINS} bis ${MAX_WINS} Siege möglich.`);
            }
            state.settings.wins = wins;
        }
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Die Partie läuft bereits.");
        startMatch(state, context.now ?? Date.now());
    },

    turn(state, action, player) {
        if (!Object.hasOwn(DIRS, action.dir)) throw new Error("Unbekannte Richtung.");
        if (state.phase !== "running" && state.phase !== "countdown") return false;
        const me = state.players.find(p => p.id === player.id);
        if (!me || !me.alive) return false;

        const last = me.queue.at(-1) ?? me.dir;
        if (action.dir === last || action.dir === OPPOSITE[last]) return false; // keine Änderung / Umkehr
        if (me.queue.length >= QUEUE_SIZE) me.queue[QUEUE_SIZE - 1] = action.dir;
        else me.queue.push(action.dir);
        // In der Wartephase direkt drehen, damit der Startpfeil die neue Richtung zeigt
        if (state.phase === "countdown") {
            me.dir = me.queue.pop();
            me.queue = [];
        }
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Die Partie läuft noch.");
        state.phase = "setup";
        state.players = [];
        state.grid = null;
        state.result = null;
        state.round = 0;
        state.roundWinner = null;
        state.phaseEndsAt = null;
        state.log = [];
    }
};

// ===========================================================================
// Sicht eines Spielers (viewFor)
// ===========================================================================

/** Ersetzt absolute Zeitpunkte durch Restzeiten und lässt interne Felder weg. */
function viewFor(state) {
    const remaining = state.phaseEndsAt ? Math.max(0, state.phaseEndsAt - Date.now()) : null;
    return {
        ...state,
        rng: undefined,
        phaseEndsAt: undefined,
        countdownMs: state.phase === "countdown" ? remaining : null,
        roundOverMs: state.phase === "roundOver" ? remaining : null,
        players: state.players.map(({ queue, ...player }) => player)
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "lichtrenner",
        name: "Lichtrenner",
        description: "Rasantes Echtzeit-Duell: Alle fahren gleichzeitig und ziehen eine leuchtende Spur hinter sich her. Lenke mit den Pfeiltasten, schneide den anderen den Weg ab – wer zuletzt fährt, gewinnt die Runde.",
        minPlayers: 1,
        maxPlayers: MAX_PARTICIPANTS,
        tickMs: TICK_MS
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            settings: { bots: DEFAULT_BOTS, maxBots: MAX_BOTS, wins: DEFAULT_WINS, minWins: MIN_WINS, maxWins: MAX_WINS },
            width: WIDTH,
            height: HEIGHT,
            players: [],
            grid: null,
            round: 0,
            roundTicks: 0,
            roundWinner: null,
            phaseEndsAt: null,
            result: null,
            countdownTotalMs: COUNTDOWN_MS,
            log: [],
            rng: Math.floor(Math.random() * 4294967296)
        };
    },

    handleAction(state, action, player, context) {
        const handler = Object.hasOwn(actions, action.type) ? actions[action.type] : null;
        if (!handler) throw new Error("Unbekannte Aktion.");
        const next = structuredClone(state);
        const result = handler(next, action, player, context);
        return result === false ? undefined : next;
    },

    tick(state, { now }) {
        if (state.phase === "countdown") {
            if (now < state.phaseEndsAt) return undefined;
            const next = structuredClone(state);
            next.phase = "running";
            next.phaseEndsAt = null;
            return next;
        }
        if (state.phase === "running") {
            const next = structuredClone(state);
            step(next, now);
            return next;
        }
        if (state.phase === "roundOver") {
            if (now < state.phaseEndsAt) return undefined;
            const next = structuredClone(state);
            startRound(next, now);
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
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);
        const participant = next.players.find(p => p.id === player.id);
        if (!participant || participant.left || next.phase === "setup" || next.phase === "finished") return next;

        participant.left = true;
        if (participant.alive) {
            participant.alive = false;
            participant.crashedAt = { x: participant.x, y: participant.y };
        }
        addLog(next, `${participant.name} hat das Spiel verlassen.`);

        const remaining = activePlayers(next);
        if (remaining.length < 2 || !remaining.some(p => !p.bot)) {
            finishMatch(next, null);
            return next;
        }
        checkRoundEnd(next, Date.now());
        return next;
    },

    /** Nur für Tests. */
    _internals: {
        WIDTH, HEIGHT, EMPTY, OWNER_CHARS, TICK_MS, COUNTDOWN_MS, ROUND_PAUSE_MS, ROUND_MAX_TICKS,
        startPositions, reachableArea, indexOf
    }
};

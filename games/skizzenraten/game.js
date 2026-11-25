"use strict";

/**
 * Skizzen-Raten – Server-Teil.
 *
 * Partyspiel für 2–8 Spieler (ohne Bots). Reihum zeichnet einer einen Begriff,
 * die anderen raten über ein eigenes Ratefeld. Falsche Tipps sehen alle,
 * richtige bleiben verborgen; wer knapp daneben liegt, bekommt einen privaten
 * „Fast!“-Hinweis. Je schneller geraten, desto mehr Punkte; der Zeichner
 * bekommt Punkte nach dem Anteil der Rater, die es geschafft haben.
 *
 * Phasen:  setup → choosing → drawing → reveal → choosing … → finished
 *
 * Reihenfolge: Spieler-Reihenfolge (Host zuerst). Ein „Durchgang“ ist vorbei,
 * wenn jeder aktive Spieler einmal gezeichnet hat; settings.rounds Durchgänge.
 * Neuzugänge raten sofort mit und zeichnen im laufenden Durchgang am Ende.
 *
 * Striche: { id, c (Farb-Index), s (Größe), p: [x0, y0, x1, y1, …] } auf einer
 * Fläche von CANVAS.width × CANVAS.height, insgesamt höchstens LIMITS.totalPoints.
 *
 * Regeln: rules.js, Begriffe: words.js.
 */

const crypto = require("crypto");
const rules = require("./rules");
const { WORDS } = require("./words");

const CANVAS = Object.freeze({ width: 800, height: 500 });
const COLORS = Object.freeze(["#1d1d1d", "#7a7a7a", "#e63946", "#ff8c1a", "#f4c542", "#2ec27e", "#1d6fd1", "#8e44ad", "#8b5a2b", "#ffffff"]);
const ERASER = COLORS.length - 1;
const SIZES = Object.freeze([4, 10, 24]);
const LIMITS = Object.freeze({
    minPlayers: 2, maxPlayers: 8,
    pointsPerAction: 300, totalPoints: 6000, maxStrokes: 600,
    guessLength: 40, guessList: 30,
    customWords: 100, wordLength: 30, minCustomOnly: 10
});
const ROUND_OPTIONS = Object.freeze([1, 2, 3]);
const SECONDS_OPTIONS = Object.freeze([60, 80, 100, 120]);
const DIFFICULTIES = Object.freeze({ gemischt: "Gemischt", leicht: "Leicht", mittel: "Mittel", schwer: "Schwer" });
const CHOOSE_MS = 15_000;
const REVEAL_MS = 5_000;
const HINT_AT = Object.freeze([0.5, 0.75]);   // Anteil der Zeit, ab dem je ein Buchstabe aufgedeckt wird
const CHOICES = 3;
const TICK_MS = 250;
const LOG_SIZE = 8;
const PLAYER_COLORS = ["#e63946", "#1d9bf0", "#2ec27e", "#ffb300", "#a259ff", "#ff8c1a", "#ff5fa2", "#00b8a9"];

let randomIndex = n => crypto.randomInt(0, n);

/** Nur für Tests: Zufall vorgeben (fn(n) → Index); ohne Argument zurück auf Zufall. */
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
const findPlayer = (state, id) => state.players.find(p => p.id === id);
const nameOf = (state, id) => findPlayer(state, id)?.name ?? "?";
/** Aktive Rater des laufenden Zugs (alle außer dem Zeichner). */
const guessers = state => activePlayers(state).filter(p => p.id !== state.turn?.drawerId);

function requireDrawer(state, player) {
    if (state.phase !== "drawing") throw new Error("Gerade wird nicht gezeichnet.");
    if (state.turn.drawerId !== player.id) throw new Error("Du zeichnest gerade nicht.");
}

function cleanWord(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.wordLength);
}

function parseCustomWords(value) {
    const list = Array.isArray(value) ? value : String(value ?? "").split(/[,\n;]/);
    const seen = new Set();
    const result = [];
    for (const raw of list) {
        const word = cleanWord(raw);
        const key = rules.normalize(word);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(word);
        if (result.length >= LIMITS.customWords) break;
    }
    return result;
}

/** Begriffe, aus denen gezogen wird (nach Einstellungen). */
function wordPool(settings) {
    const custom = settings.customWords;
    if (settings.onlyCustom && custom.length >= LIMITS.minCustomOnly) return [...custom];
    const builtIn = settings.difficulty === "gemischt" ? [...WORDS.leicht, ...WORDS.mittel, ...WORDS.schwer] : [...WORDS[settings.difficulty]];
    return [...builtIn, ...custom];
}

function drawChoices(state) {
    const pool = wordPool(state.settings);
    let free = pool.filter(w => !state.usedWords.includes(rules.normalize(w)));
    if (free.length < CHOICES) {
        state.usedWords = [];
        free = pool;
    }
    const choices = [];
    while (choices.length < CHOICES && free.length > 0) {
        const [word] = free.splice(randomIndex(free.length), 1);
        choices.push(word);
    }
    return choices;
}

const totalPoints = strokes => strokes.reduce((sum, s) => sum + s.p.length / 2, 0);

// ===========================================================================
// Ablauf
// ===========================================================================

function makePlayer(member, index) {
    return { id: member.id, name: member.name, color: PLAYER_COLORS[index % PLAYER_COLORS.length], left: false, score: 0 };
}

function startMatch(state, now) {
    state.players = state.members.slice(0, LIMITS.maxPlayers).map(makePlayer);
    state.usedWords = [];
    state.cycle = 1;
    state.drawnThisCycle = [];
    state.turnNumber = 0;
    state.turn = null;
    state.result = null;
    state.log = [];
    state.matchNumber += 1;
    const turns = state.settings.rounds * state.players.length;
    addLog(state, `Partie ${state.matchNumber}: ${state.settings.rounds} ${state.settings.rounds === 1 ? "Durchgang" : "Durchgänge"} (${turns} Bilder).`);
    nextTurn(state, now);
}

/** Nächster Zeichner (oder Ende der Partie). */
function nextTurn(state, now) {
    let drawer = activePlayers(state).find(p => !state.drawnThisCycle.includes(p.id));
    if (!drawer) {
        state.cycle += 1;
        state.drawnThisCycle = [];
        if (state.cycle > state.settings.rounds) {
            finishMatch(state, "finished");
            return;
        }
        drawer = activePlayers(state)[0];
    }
    state.drawnThisCycle.push(drawer.id);
    state.turnNumber += 1;
    state.phase = "choosing";
    state.turn = {
        number: state.turnNumber,
        cycle: state.cycle,
        drawerId: drawer.id,
        choices: drawChoices(state),
        word: null,
        endsAt: now + CHOOSE_MS,
        totalMs: 0,
        revealed: [],
        hints: 0,
        strokes: [],
        guesses: [],
        guessed: [],
        near: {},
        drawerPoints: 0,
        ending: null
    };
}

function chooseWord(state, index, now) {
    const word = state.turn.choices[index];
    state.turn.word = word;
    state.turn.choices = [];
    state.usedWords.push(rules.normalize(word));
    state.turn.totalMs = state.settings.drawSeconds * 1000;
    state.turn.endsAt = now + state.turn.totalMs;
    state.phase = "drawing";
}

/** Zug beenden: Zeichner-Punkte, Auflösung anzeigen. */
function beginReveal(state, now, ending) {
    const turn = state.turn;
    const drawer = findPlayer(state, turn.drawerId);
    if (turn.word && drawer && !drawer.left) {
        turn.drawerPoints = rules.drawerPoints(turn.guessed.length, guessers(state).length);
        drawer.score += turn.drawerPoints;
    }
    turn.ending = ending;
    turn.endsAt = now + REVEAL_MS;
    state.phase = "reveal";
    if (turn.word) addLog(state, `Der Begriff war „${turn.word}“.`);
}

function checkAllGuessed(state, now) {
    if (state.phase !== "drawing") return;
    const open = guessers(state).filter(p => !state.turn.guessed.some(g => g.id === p.id));
    if (guessers(state).length > 0 && open.length === 0) beginReveal(state, now, "all");
}

/** Hinweise: bei 50 % und 75 % der Zeit je einen Buchstaben aufdecken (mind. 2 bleiben verdeckt). */
function giveHints(state, now) {
    const turn = state.turn;
    let changed = false;
    while (turn.hints < HINT_AT.length && now >= turn.endsAt - turn.totalMs * (1 - HINT_AT[turn.hints])) {
        turn.hints += 1;
        const hidden = rules.letterPositions(turn.word).filter(i => !turn.revealed.includes(i));
        if (hidden.length > 2) turn.revealed.push(hidden[randomIndex(hidden.length)]);
        changed = true;
    }
    return changed;
}

function finishMatch(state, outcome) {
    const ranked = activePlayers(state).sort((a, b) => b.score - a.score);
    state.phase = "finished";
    if (state.turn) state.turn.endsAt = null;
    const placements = ranked.map(p => p.id);
    state.result = { outcome, winnerId: placements[0] ?? null, placements };
    if (outcome === "finished" && ranked[0]) addLog(state, `${ranked[0].name} gewinnt mit ${ranked[0].score} Punkten!`);
    else if (outcome === "aborted") addLog(state, "Spiel beendet – zu wenige Spieler.");
}

// ===========================================================================
// Aktionen
// ===========================================================================

function intIn(value, min, max) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor dem Start möglich.");
        const s = state.settings;
        if (action.rounds !== undefined) {
            if (!ROUND_OPTIONS.includes(Number(action.rounds))) throw new Error("Ungültige Zahl an Durchgängen.");
            s.rounds = Number(action.rounds);
        }
        if (action.drawSeconds !== undefined) {
            if (!SECONDS_OPTIONS.includes(Number(action.drawSeconds))) throw new Error("Ungültige Zeichenzeit.");
            s.drawSeconds = Number(action.drawSeconds);
        }
        if (action.difficulty !== undefined) {
            if (!Object.hasOwn(DIFFICULTIES, action.difficulty)) throw new Error("Unbekannte Schwierigkeit.");
            s.difficulty = action.difficulty;
        }
        if (action.customWords !== undefined) {
            s.customWords = parseCustomWords(action.customWords);
            s.customBy = player.id;   // nur wer sie eingetragen hat, sieht die Liste (viewFor)
        }
        if (action.onlyCustom !== undefined) s.onlyCustom = Boolean(action.onlyCustom);
        if (s.onlyCustom && s.customWords.length < LIMITS.minCustomOnly) {
            throw new Error(`„Nur eigene Begriffe“ braucht mindestens ${LIMITS.minCustomOnly} eigene Begriffe.`);
        }
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Das Spiel läuft bereits.");
        if (state.members.length < LIMITS.minPlayers) throw new Error(`Skizzen-Raten braucht mindestens ${LIMITS.minPlayers} Spieler.`);
        startMatch(state, context.now ?? Date.now());
    },

    choose(state, action, player, context) {
        if (state.phase !== "choosing") throw new Error("Gerade wird kein Begriff gewählt.");
        if (state.turn.drawerId !== player.id) throw new Error("Den Begriff wählt der Zeichner.");
        const index = Number(action.index);
        if (!Number.isInteger(index) || index < 0 || index >= state.turn.choices.length) throw new Error("Ungültige Auswahl.");
        chooseWord(state, index, context.now ?? Date.now());
    },

    stroke(state, action, player) {
        requireDrawer(state, player);
        const turn = state.turn;
        const id = Number(action.id);
        if (!Number.isInteger(id) || id < 0) throw new Error("Ungültiger Strich.");
        const raw = Array.isArray(action.points) ? action.points : [];
        if (raw.length === 0 || raw.length % 2 !== 0) throw new Error("Ungültige Punkte.");
        if (raw.length / 2 > LIMITS.pointsPerAction) throw new Error("Zu viele Punkte auf einmal.");
        if (totalPoints(turn.strokes) + raw.length / 2 > LIMITS.totalPoints) throw new Error("Das Bild ist voll – Rückgängig oder Leeren hilft.");
        const points = raw.map((v, i) => intIn(v, 0, i % 2 === 0 ? CANVAS.width : CANVAS.height));
        if (points.some(v => v === null)) throw new Error("Ungültige Punkte.");
        const last = turn.strokes.at(-1);
        if (last && last.id === id) {
            last.p.push(...points);
            return;
        }
        if (turn.strokes.some(s => s.id === id)) throw new Error("Dieser Strich ist schon abgeschlossen.");
        const color = Number(action.color);
        const size = Number(action.size);
        if (!Number.isInteger(color) || color < 0 || color >= COLORS.length) throw new Error("Unbekannte Farbe.");
        if (!SIZES.includes(size)) throw new Error("Unbekannte Stiftgröße.");
        if (turn.strokes.length >= LIMITS.maxStrokes) throw new Error("Das Bild ist voll – Rückgängig oder Leeren hilft.");
        turn.strokes.push({ id, c: color, s: size, p: points });
    },

    undo(state, action, player) {
        requireDrawer(state, player);
        if (state.turn.strokes.length === 0) return false;
        state.turn.strokes.pop();
    },

    clear(state, action, player) {
        requireDrawer(state, player);
        if (state.turn.strokes.length === 0) return false;
        state.turn.strokes = [];
    },

    guess(state, action, player, context) {
        if (state.phase !== "drawing") throw new Error("Gerade wird nicht geraten.");
        const turn = state.turn;
        if (turn.drawerId === player.id) throw new Error("Du zeichnest – raten dürfen die anderen.");
        const p = activePlayers(state).find(x => x.id === player.id);
        if (!p) throw new Error("Du spielst nicht mit.");
        if (turn.guessed.some(g => g.id === p.id)) throw new Error("Du hast es schon erraten.");
        const text = String(action.text ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.guessLength);
        if (!text) return false;
        const now = context.now ?? Date.now();
        if (rules.isCorrect(text, turn.word)) {
            const points = rules.guesserPoints(turn.endsAt - now, turn.totalMs);
            turn.guessed.push({ id: p.id, points });
            p.score += points;
            delete turn.near[p.id];
            addLog(state, `${p.name} hat es erraten! (+${points})`);
            checkAllGuessed(state, now);
            return;
        }
        turn.guesses.push({ id: p.id, text });
        if (turn.guesses.length > LIMITS.guessList) turn.guesses.splice(0, turn.guesses.length - LIMITS.guessList);
        if (rules.isClose(text, turn.word)) turn.near[p.id] = text;
    },

    skip(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "choosing" && state.phase !== "drawing") throw new Error("Gerade gibt es nichts zu überspringen.");
        addLog(state, "Der Host hat das Bild übersprungen.");
        beginReveal(state, context.now ?? Date.now(), "skipped");
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Das Spiel läuft noch.");
        Object.assign(state, { phase: "setup", players: [], turn: null, result: null, log: [] });
    }
};

// ===========================================================================
// Sicht: Begriff, Vorschläge und „Fast!“-Hinweise bleiben geheim
// ===========================================================================

function viewFor(state, userId) {
    const now = Date.now();
    const { turn, usedWords, drawnThisCycle, ...rest } = state;
    void usedWords;
    void drawnThisCycle;
    // Eigene Begriffe sieht nur, wer sie eingetragen hat – die anderen nur die Anzahl
    const settings = { ...state.settings, customCount: state.settings.customWords.length };
    if (state.settings.customBy !== userId) settings.customWords = [];
    rest.settings = settings;
    if (!turn) return { ...rest, turn: null };
    const isDrawer = turn.drawerId === userId;
    const solved = turn.guessed.some(g => g.id === userId);
    const open = state.phase === "reveal" || state.phase === "finished";
    return {
        ...rest,
        turn: {
            number: turn.number,
            cycle: turn.cycle,
            drawerId: turn.drawerId,
            choices: isDrawer && state.phase === "choosing" ? turn.choices : [],
            word: turn.word && (isDrawer || solved || open) ? turn.word : null,
            hint: turn.word ? rules.hintFor(turn.word, turn.revealed) : null,
            letters: turn.word ? rules.letterPositions(turn.word).length : 0,
            remainingMs: turn.endsAt ? Math.max(0, turn.endsAt - now) : null,
            totalMs: state.phase === "choosing" ? CHOOSE_MS : state.phase === "reveal" ? REVEAL_MS : turn.totalMs,
            strokes: turn.strokes,
            guesses: turn.guesses,
            guessed: turn.guessed,
            near: turn.near[userId] ?? null,
            drawerPoints: turn.drawerPoints,
            ending: turn.ending
        }
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "skizzenraten",
        name: "Skizzen-Raten",
        description: "Reihum zeichnet einer einen Begriff, die anderen raten um die Wette – je schneller, desto mehr Punkte. Mit eigener Begriffsliste und eigenen Wörtern.",
        minPlayers: LIMITS.minPlayers,
        maxPlayers: LIMITS.maxPlayers,
        tickMs: TICK_MS
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            settings: { rounds: 2, drawSeconds: 80, difficulty: "gemischt", customWords: [], customBy: null, onlyCustom: false },
            catalog: {
                canvas: { ...CANVAS }, colors: [...COLORS], eraser: ERASER, sizes: [...SIZES],
                roundOptions: [...ROUND_OPTIONS], secondsOptions: [...SECONDS_OPTIONS], difficulties: { ...DIFFICULTIES },
                limits: { ...LIMITS }, chooseMs: CHOOSE_MS, revealMs: REVEAL_MS
            },
            players: [],
            usedWords: [],
            cycle: 0,
            drawnThisCycle: [],
            turnNumber: 0,
            turn: null,
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
        const turn = state.turn;
        if (!turn?.endsAt || !["choosing", "drawing", "reveal"].includes(state.phase)) return undefined;
        const hintDue = state.phase === "drawing" && turn.hints < HINT_AT.length &&
            time >= turn.endsAt - turn.totalMs * (1 - HINT_AT[turn.hints]);
        if (time < turn.endsAt && !hintDue) return undefined;
        const next = structuredClone(state);
        if (time < next.turn.endsAt) {
            giveHints(next, time);
        } else if (next.phase === "choosing") {
            chooseWord(next, randomIndex(next.turn.choices.length), time);
        } else if (next.phase === "drawing") {
            addLog(next, "Die Zeit ist um!");
            beginReveal(next, time, "time");
        } else {
            nextTurn(next, time);
        }
        return next;
    },

    viewFor,

    onPlayerJoin(state, player) {
        const next = structuredClone(state);
        if (!next.members.some(m => m.id === player.id)) next.members.push({ id: player.id, name: player.name });
        if (next.phase === "setup" || next.phase === "finished") return next;
        const known = findPlayer(next, player.id);
        if (known) {
            if (known.left) {
                known.left = false;
                addLog(next, `${known.name} ist wieder da.`);
            }
        } else if (next.players.length < LIMITS.maxPlayers) {
            next.players.push(makePlayer(player, next.players.length));
            addLog(next, `${player.name} rät ab jetzt mit.`);
        }
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);
        const p = findPlayer(next, player.id);
        if (!p || p.left || next.phase === "setup" || next.phase === "finished") return next;
        p.left = true;
        addLog(next, `${p.name} hat das Spiel verlassen.`);
        const now = Date.now();
        if (activePlayers(next).length < LIMITS.minPlayers) {
            finishMatch(next, "aborted");
        } else if (next.turn.drawerId === p.id && (next.phase === "choosing" || next.phase === "drawing")) {
            addLog(next, "Der Zeichner ist weg – weiter zum nächsten Bild.");
            beginReveal(next, now, "left");
        } else {
            checkAllGuessed(next, now);
        }
        return next;
    },

    /** Nur für Tests. */
    _internals: { CANVAS, COLORS, SIZES, LIMITS, CHOOSE_MS, REVEAL_MS, HINT_AT, rules, WORDS, wordPool, setRandom }
};

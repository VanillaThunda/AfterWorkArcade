"use strict";

/**
 * Bomben-Labyrinth – Server-Teil.
 *
 * Echtzeitspiel im Bomberman-Genre (eigene Regeln und Grafik): Alle laufen
 * gleichzeitig durch ein Raster-Labyrinth, legen Bomben, sprengen Kisten und
 * sammeln Power-ups. Wer in eine Flamme gerät, scheidet aus. Der Letzte gewinnt
 * die Runde; wer zuerst die eingestellte Zahl Siege hat, die Partie.
 *
 * Phasen:  setup → countdown → running → roundOver → countdown … → finished
 *
 * Bewegung: „Taste halten“ – der Client meldet die gehaltene Richtung (move
 * {dir}) bzw. das Loslassen (move {dir: null}). tick() läuft alle 50 ms; wer
 * eine Richtung hält, geht je nach Tempo alle 4/3/2 Ticks ein Feld weiter.
 *
 * Die Arena ist ein Text mit einem Zeichen pro Feld:
 *   "#" Wand   "x" Kiste   "." frei   "r" / "b" / "s" Power-up (Reichweite, Bombe, Tempo)
 * Unter Kisten versteckte Power-ups stehen in state.hidden und werden von
 * viewFor() nicht verschickt.
 *
 * Nach SUDDEN_DEATH_TICKS schrumpft die Arena spiralförmig von außen.
 */

const { pickBotNames } = require("../../server/bot-names");

// ===========================================================================
// Einstellungen
// ===========================================================================

const WIDTH = 15;
const HEIGHT = 13;
const WALL = "#";
const CRATE = "x";
const EMPTY = ".";
const POWERUPS = Object.freeze({ r: "range", b: "bombs", s: "speed" });

const MAX_PARTICIPANTS = 8;
const MAX_BOTS = 7;
const DEFAULT_BOTS = 3;
const MIN_WINS = 1;
const MAX_WINS = 5;
const DEFAULT_WINS = 3;

const TICK_MS = 50;
const COUNTDOWN_MS = 3_000;
const ROUND_PAUSE_MS = 3_000;
const STEP_TICKS = [4, 3, 2];          // Ticks pro Feld je Tempo-Stufe (200 / 150 / 100 ms)
const FUSE_TICKS = 50;                 // 2,5 s Zündschnur
const FLAME_TICKS = 10;                // 0,5 s Flammen
const SUDDEN_DEATH_TICKS = 1_800;      // nach 90 s schrumpft die Arena …
const SHRINK_EVERY_TICKS = 8;          // … alle 0,4 s um ein Feld
const ROUND_MAX_TICKS = 3_000;         // 150 s – danach Unentschieden

const START_BOMBS = 1;
const START_RANGE = 2;
const MAX_BOMBS = 5;
const MAX_RANGE = 6;
const MAX_SPEED = STEP_TICKS.length - 1;
const CRATE_CHANCE = 0.7;
const POWERUP_CHANCE = 0.3;
const SAFE_RADIUS = 2;                 // um Startplätze bleibt dieser Bereich frei
const LOG_SIZE = 8;

const COLORS = ["#e63946", "#1d9bf0", "#ffd60a", "#2ec27e", "#ff8c1a", "#a259ff", "#ff5fa2", "#f1f1f1"];

const DIRS = Object.freeze({
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
});

/** Startplätze: erst die vier Ecken, dann die Randmitten. */
const SPAWNS = Object.freeze([
    [1, 1], [WIDTH - 2, HEIGHT - 2], [WIDTH - 2, 1], [1, HEIGHT - 2],
    [(WIDTH - 1) / 2, 1], [(WIDTH - 1) / 2, HEIGHT - 2], [1, (HEIGHT - 1) / 2], [WIDTH - 2, (HEIGHT - 1) / 2]
]);

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
const isPillar = (x, y) => x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 || (x % 2 === 0 && y % 2 === 0);

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function activePlayers(state) {
    return state.players.filter(p => !p.left);
}

/** Innenfelder ohne Säulen, spiralförmig von außen nach innen (Reihenfolge des Schrumpfens). */
function buildSpiral() {
    const order = [];
    let left = 1, top = 1, right = WIDTH - 2, bottom = HEIGHT - 2;
    while (left <= right && top <= bottom) {
        for (let x = left; x <= right; x++) order.push([x, top]);
        for (let y = top + 1; y <= bottom; y++) order.push([right, y]);
        if (top < bottom) for (let x = right - 1; x >= left; x--) order.push([x, bottom]);
        if (left < right) for (let y = bottom - 1; y > top; y--) order.push([left, y]);
        left++; top++; right--; bottom--;
    }
    return order.filter(([x, y]) => !isPillar(x, y)).map(([x, y]) => indexOf(x, y));
}
const SPIRAL = Object.freeze(buildSpiral());

/** Neue Arena: Säulen, zufällige Kisten, freie Startbereiche, versteckte Power-ups. */
function buildArena(rng, spawns) {
    const cells = new Array(WIDTH * HEIGHT);
    const hidden = {};
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const index = indexOf(x, y);
            if (isPillar(x, y)) {
                cells[index] = WALL;
                continue;
            }
            const nearSpawn = spawns.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= SAFE_RADIUS);
            if (nearSpawn || rng.next() >= CRATE_CHANCE) {
                cells[index] = EMPTY;
                continue;
            }
            cells[index] = CRATE;
            if (rng.next() < POWERUP_CHANCE) {
                const kinds = Object.keys(POWERUPS);
                hidden[index] = kinds[Math.floor(rng.next() * kinds.length)];
            }
        }
    }
    return { grid: cells.join(""), hidden };
}

/** Felder, die eine Bombe bei (x, y) mit Reichweite range trifft (Kiste inkl., Wand nicht). */
function blastCells(cells, x, y, range) {
    const result = [indexOf(x, y)];
    for (const [dx, dy] of Object.values(DIRS)) {
        for (let k = 1; k <= range; k++) {
            const nx = x + dx * k;
            const ny = y + dy * k;
            if (!inside(nx, ny)) break;
            const index = indexOf(nx, ny);
            const cell = cells[index];
            if (cell === WALL) break;
            result.push(index);
            if (cell === CRATE || Object.hasOwn(POWERUPS, cell)) break;
        }
    }
    return result;
}

const stepTicksOf = player => STEP_TICKS[player.speed];

// ===========================================================================
// Ablauf
// ===========================================================================

function startRound(state, now) {
    const rng = createRng(state.rng);
    const players = activePlayers(state);
    const spawns = SPAWNS.slice(0, players.length);

    // Startplätze zufällig verteilen, damit nicht immer dieselben nebeneinander stehen
    const order = players.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }

    const arena = buildArena(rng, spawns);
    players.forEach((player, k) => {
        const [x, y] = spawns[order[k]];
        Object.assign(player, {
            x, y, held: null, facing: "down", cooldown: 0,
            alive: true, diedAt: null,
            bombs: START_BOMBS, range: START_RANGE, speed: 0
        });
        if (player.bot) Object.assign(player, { botTarget: null, botTargetUntil: 0, botPause: 0 });
    });

    state.rng = rng.state;
    state.grid = arena.grid;
    state.hidden = arena.hidden;
    state.bombs = [];
    state.flames = [];
    state.shrinkIndex = 0;
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
    const rng = createRng(state.rng);
    state.players = participants.map((p, i) => ({
        ...p,
        color: COLORS[i],
        x: 0, y: 0, held: null, facing: "down", cooldown: 0,
        alive: false, left: false, diedAt: null,
        bombs: START_BOMBS, range: START_RANGE, speed: 0,
        wins: 0, survivedTicks: 0,
        ...(p.bot ? { traits: rollTraits(rng), botTarget: null, botTargetUntil: 0, botPause: 0 } : {})
    }));
    state.rng = rng.state;
    state.matchNumber += 1;
    state.round = 0;
    state.result = null;
    state.log = [];
    startRound(state, now);
}

/** Bombe für player auf dessen Feld legen, falls erlaubt. @returns {boolean} */
function placeBomb(state, player) {
    if (!player.alive) return false;
    if (state.bombs.some(b => b.x === player.x && b.y === player.y)) return false;
    if (state.bombs.filter(b => b.owner === player.id).length >= player.bombs) return false;
    state.bombs.push({ x: player.x, y: player.y, owner: player.id, range: player.range, fuse: FUSE_TICKS });
    return true;
}

function canEnter(state, cells, x, y) {
    if (!inside(x, y)) return false;
    const cell = cells[indexOf(x, y)];
    if (cell === WALL || cell === CRATE) return false;
    return !state.bombs.some(b => b.x === x && b.y === y);
}

function collect(player, cell) {
    const kind = POWERUPS[cell];
    if (kind === "range") player.range = Math.min(MAX_RANGE, player.range + 1);
    else if (kind === "bombs") player.bombs = Math.min(MAX_BOMBS, player.bombs + 1);
    else if (kind === "speed") player.speed = Math.min(MAX_SPEED, player.speed + 1);
}

/** Alle fälligen Bomben zünden (mit Kettenreaktion). */
function explodeBombs(state, cells) {
    const queue = state.bombs.filter(b => b.fuse <= 0);
    if (queue.length === 0) return;
    const exploded = new Set();
    const revealed = new Set();
    const flameCells = new Set();

    while (queue.length > 0) {
        const bomb = queue.shift();
        if (exploded.has(bomb)) continue;
        exploded.add(bomb);
        for (const index of blastCells(cells, bomb.x, bomb.y, bomb.range)) {
            flameCells.add(index);
            const cell = cells[index];
            if (cell === CRATE) revealed.add(index);
            else if (Object.hasOwn(POWERUPS, cell)) cells[index] = EMPTY; // Power-up verbrennt
            const x = index % WIDTH;
            const y = Math.floor(index / WIDTH);
            for (const other of state.bombs) {
                if (!exploded.has(other) && other.x === x && other.y === y) queue.push(other);
            }
        }
    }
    // Kisten erst nach allen Explosionen öffnen, damit Power-ups nicht sofort mitverbrennen
    for (const index of revealed) {
        cells[index] = state.hidden[index] ?? EMPTY;
        delete state.hidden[index];
    }
    state.bombs = state.bombs.filter(b => !exploded.has(b));
    state.flames.push({ cells: [...flameCells], ticks: FLAME_TICKS });
}

/** Ein Spiel-Tick (50 ms) – Bewegung, Bomben, Flammen, Schrumpfen, Ausscheiden. */
function step(state, now) {
    const cells = state.grid.split("");
    const rng = createRng(state.rng);
    const alive = state.players.filter(p => p.alive);
    state.roundTicks += 1;

    // Bots entscheiden, Bewegung, Power-ups einsammeln
    for (const player of alive) {
        if (player.bot) botThink(state, cells, player, rng);
        player.cooldown = Math.max(0, player.cooldown - 1);
        if (!player.held || player.cooldown > 0) continue;
        const [dx, dy] = DIRS[player.held];
        player.facing = player.held;
        const nx = player.x + dx;
        const ny = player.y + dy;
        if (!canEnter(state, cells, nx, ny)) continue;
        player.x = nx;
        player.y = ny;
        player.cooldown = stepTicksOf(player);
        const index = indexOf(nx, ny);
        if (Object.hasOwn(POWERUPS, cells[index])) {
            collect(player, cells[index]);
            cells[index] = EMPTY;
        }
    }

    // Flammen verglühen, Bomben ticken und explodieren
    for (const flame of state.flames) flame.ticks -= 1;
    state.flames = state.flames.filter(f => f.ticks > 0);
    for (const bomb of state.bombs) bomb.fuse -= 1;
    explodeBombs(state, cells);

    // Arena schrumpft
    if (state.roundTicks === SUDDEN_DEATH_TICKS) addLog(state, "Die Arena schrumpft!");
    if (state.roundTicks >= SUDDEN_DEATH_TICKS
        && (state.roundTicks - SUDDEN_DEATH_TICKS) % SHRINK_EVERY_TICKS === 0
        && state.shrinkIndex < SPIRAL.length) {
        const index = SPIRAL[state.shrinkIndex++];
        cells[index] = WALL;
        delete state.hidden[index];
        state.bombs = state.bombs.filter(b => indexOf(b.x, b.y) !== index);
    }

    // Ausscheiden: Flamme oder Wand auf dem eigenen Feld
    const burning = new Set(state.flames.flatMap(f => f.cells));
    const died = [];
    for (const player of alive) {
        const index = indexOf(player.x, player.y);
        if (burning.has(index) || cells[index] === WALL) {
            player.alive = false;
            player.held = null;
            player.diedAt = { x: player.x, y: player.y };
            died.push(player);
        } else {
            player.survivedTicks += 1;
        }
    }
    if (died.length === 1) addLog(state, `${died[0].name} ist raus.`);
    else if (died.length > 1) addLog(state, `${died.map(p => p.name).join(" und ")} sind raus.`);

    state.grid = cells.join("");
    state.rng = rng.state;
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
    for (const player of state.players) player.held = null;

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

/**
 * Gefahrenkarte: Feld → Tick, ab dem dort eine Flamme ist (0 = brennt jetzt).
 * Berücksichtigt Kettenreaktionen (eine Bombe im Strahl zündet früher).
 */
function dangerMap(state, cells, bombs) {
    const danger = new Map();
    for (const flame of state.flames) for (const index of flame.cells) danger.set(index, 0);

    const fuse = bombs.map(b => b.fuse);
    const blasts = bombs.map(b => blastCells(cells, b.x, b.y, b.range));
    let changed = true;
    while (changed) {
        changed = false;
        bombs.forEach((bomb, i) => {
            bombs.forEach((other, j) => {
                if (i !== j && fuse[j] > fuse[i] && blasts[i].includes(indexOf(other.x, other.y))) {
                    fuse[j] = fuse[i];
                    changed = true;
                }
            });
        });
    }
    blasts.forEach((cellsHit, i) => {
        for (const index of cellsHit) {
            const at = Math.max(0, fuse[i]);
            if (!danger.has(index) || danger.get(index) > at) danger.set(index, at);
        }
    });
    return danger;
}

/**
 * Breitensuche über begehbare Felder. Ein Feld ist auf dem Weg erlaubt, wenn
 * dort beim Ankommen/Durchlaufen keine Flamme lodert.
 * @returns {Map<number, {dist: number, first: string|null}>}
 */
function explore(state, cells, bombs, danger, bot) {
    const stepTicks = stepTicksOf(bot);
    const bombCells = new Set(bombs.map(b => indexOf(b.x, b.y)));
    const start = indexOf(bot.x, bot.y);
    const result = new Map([[start, { dist: 0, first: null }]]);
    const queue = [[bot.x, bot.y]];
    while (queue.length > 0) {
        const [x, y] = queue.shift();
        const current = result.get(indexOf(x, y));
        for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inside(nx, ny)) continue;
            const index = indexOf(nx, ny);
            if (result.has(index)) continue;
            const cell = cells[index];
            if (cell === WALL || cell === CRATE || bombCells.has(index)) continue;
            const arrive = (current.dist + 1) * stepTicks;
            if (danger.has(index)) {
                const at = danger.get(index);
                if (at - 2 <= arrive + stepTicks && at + FLAME_TICKS + 1 >= arrive - stepTicks) continue;
            }
            result.set(index, { dist: current.dist + 1, first: current.first ?? dir });
            queue.push([nx, ny]);
        }
    }
    return result;
}

/**
 * Sicheres Feld (ohne Gefahr) – erster Schritt dorthin oder null.
 * Mit rng wird zufällig unter den nächsten Feldern (Abstand ≤ Minimum + 1) gewählt,
 * bevorzugt ohne andere Spieler darauf; so trennen sich Bots auf demselben Feld.
 */
function escapeRoute(state, cells, bombs, danger, runner, rng = null) {
    const reach = explore(state, cells, bombs, danger, runner);
    let min = Infinity;
    for (const [index, info] of reach) if (!danger.has(index)) min = Math.min(min, info.dist);
    if (min === Infinity) return null;
    if (!rng) {
        for (const [index, info] of reach) if (!danger.has(index) && info.dist === min) return info;
    }
    const occupied = new Set(state.players.filter(p => p.alive && p !== runner).map(p => indexOf(p.x, p.y)));
    const near = [...reach].filter(([index, info]) => !danger.has(index) && info.dist <= min + 1);
    const free = near.filter(([index]) => !occupied.has(index));
    const pool = free.length > 0 ? free : near;
    return pool[Math.floor(rng.next() * pool.length)][1];
}

/** Gegner, die eine Bombe auf (x, y) mit Reichweite range treffen würde. */
function enemiesInBlast(state, cells, bot, x, y, range) {
    const hit = new Set(blastCells(cells, x, y, range));
    return state.players.filter(p => p.alive && p !== bot && hit.has(indexOf(p.x, p.y)));
}

/** Säße der Gegner nach einer Bombe auf (x, y) in der Falle (kein Fluchtweg)? */
function wouldTrap(state, cells, bot, x, y, enemy) {
    const bombs = [...state.bombs, { x, y, owner: bot.id, range: bot.range, fuse: FUSE_TICKS }];
    return !escapeRoute(state, cells, bombs, dangerMap(state, cells, bombs), enemy);
}

/**
 * Wie lohnend wäre eine Bombe auf (x, y)? Kisten zählen 1, getroffene Gegner je
 * nach Angriffslust, eingesperrte Gegner sehr viel.
 */
function bombValue(state, cells, bot, x, y, { withTraps = false } = {}) {
    let value = 0;
    for (const index of blastCells(cells, x, y, bot.range)) if (cells[index] === CRATE) value += 1;
    for (const enemy of enemiesInBlast(state, cells, bot, x, y, bot.range)) {
        value += 1 + 2 * bot.traits.aggression;
        if (withTraps && wouldTrap(state, cells, bot, x, y, enemy)) value += 20;
    }
    return value;
}

/** Zufällige Persönlichkeit eines Bots (gespeichert in player.traits). */
function rollTraits(rng) {
    return {
        aggression: 0.3 + rng.next() * 0.7,  // Gewicht für Gegner und Jagd
        greed: 0.5 + rng.next(),             // Gewicht für Power-ups
        wander: rng.next(),                  // Stärke des Zufalls bei der Zielwahl
        bombChance: 0.6 + rng.next() * 0.35, // Neigung, eine lohnende Bombe auch zu legen
        reaction: 3 + Math.floor(rng.next() * 16) // Ticks, bis eine fremde Bombe bemerkt wird (0,15–0,9 s)
    };
}

/** Neues Ziel wählen. @returns {number|null} Feldindex */
function chooseTarget(state, cells, bot, reach, danger, rng, hunting) {
    const here = indexOf(bot.x, bot.y);
    const { aggression, greed, wander } = bot.traits;
    const canBomb = state.bombs.filter(b => b.owner === bot.id).length < bot.bombs;
    const enemies = state.players.filter(p => p.alive && p !== bot);
    const otherTargets = new Set(state.players.filter(p => p.bot && p !== bot && p.alive && p.botTarget !== null).map(p => p.botTarget));

    let best = null;
    let bestScore = -Infinity;
    for (const [index, info] of reach) {
        if (index === here || danger.has(index)) continue;
        const x = index % WIDTH;
        const y = Math.floor(index / WIDTH);
        let score = -info.dist * (hunting ? 0.6 : 1);
        if (Object.hasOwn(POWERUPS, cells[index])) score += 12 * greed;
        if (canBomb) score += Math.min(10, bombValue(state, cells, bot, x, y, { withTraps: hunting })) * 2;
        if (hunting && enemies.length > 0) {
            const nearest = Math.min(...enemies.map(e => Math.abs(e.x - x) + Math.abs(e.y - y)));
            score -= nearest * aggression * 0.8;
        } else if (enemies.some(e => Math.abs(e.x - x) + Math.abs(e.y - y) <= 1)) {
            score -= 3; // nicht allen hinterherlaufen
        }
        if (otherTargets.has(index)) score -= 6;
        score += rng.next() * (2 + 6 * wander);
        if (score > bestScore) {
            bestScore = score;
            best = index;
        }
    }
    return best;
}

function botThink(state, cells, bot, rng) {
    if (bot.cooldown > 1) return; // erst kurz vor dem nächsten Schritt neu entscheiden
    // Fremde Bomben bemerkt ein Bot erst nach seiner Reaktionszeit – so macht er
    // gelegentlich Fehler, und Duelle entscheiden sich nicht erst beim Schrumpfen.
    const noticed = state.bombs.filter(b => b.owner === bot.id || FUSE_TICKS - b.fuse >= bot.traits.reaction);
    const danger = dangerMap(state, cells, noticed);
    const here = indexOf(bot.x, bot.y);

    // 1. In Gefahr → fliehen (zufällig unter den nächsten sicheren Feldern)
    if (danger.has(here)) {
        const route = escapeRoute(state, cells, state.bombs, danger, bot, rng);
        bot.held = route?.first ?? null;
        bot.botTarget = null;
        bot.botPause = 0;
        return;
    }

    // 2. Kurz zögern (bricht gleichförmige Bewegungen auf)
    if (bot.botPause > 0) {
        bot.botPause -= 1;
        bot.held = null;
        return;
    }
    if (rng.next() < 0.015) {
        bot.botPause = 2 + Math.floor(rng.next() * 5);
        bot.held = null;
        return;
    }

    const reach = explore(state, cells, state.bombs, danger, bot);
    const aliveCount = state.players.filter(p => p.alive).length;
    let cratesLeft = false;
    for (const index of reach.keys()) {
        if (blastCells(cells, index % WIDTH, Math.floor(index / WIDTH), bot.range).some(i => cells[i] === CRATE)) {
            cratesLeft = true;
            break;
        }
    }
    const hunting = aliveCount <= 2 || !cratesLeft;

    // 3. Lohnt eine Bombe hier, und gibt es danach einen Fluchtweg?
    const ownBombs = state.bombs.filter(b => b.owner === bot.id).length;
    const onBomb = state.bombs.some(b => b.x === bot.x && b.y === bot.y);
    if (!onBomb && ownBombs < bot.bombs) {
        const value = bombValue(state, cells, bot, bot.x, bot.y, { withTraps: true });
        const chance = value >= 20 ? 1 : bot.traits.bombChance;
        if (value > 0 && rng.next() < chance) {
            const newBomb = { x: bot.x, y: bot.y, owner: bot.id, range: bot.range, fuse: FUSE_TICKS };
            const danger2 = dangerMap(state, cells, [...noticed, newBomb]);
            const route = escapeRoute(state, cells, [...state.bombs, newBomb], danger2, bot, rng);
            if (route?.first) {
                placeBomb(state, bot);
                bot.held = route.first;
                bot.botTarget = null;
                return;
            }
        }
    }

    // 4. Ziel verfolgen – es gilt 1–3 s, dann (oder wenn ungültig) neu wählen
    const target = bot.botTarget;
    const valid = target !== null && target !== here && reach.has(target) && !danger.has(target)
        && state.roundTicks < bot.botTargetUntil;
    if (!valid) {
        bot.botTarget = chooseTarget(state, cells, bot, reach, danger, rng, hunting);
        bot.botTargetUntil = state.roundTicks + 20 + Math.floor(rng.next() * 40);
    }
    bot.held = bot.botTarget === null ? null : reach.get(bot.botTarget).first;
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

    move(state, action, player) {
        const dir = action.dir ?? null;
        if (dir !== null && !Object.hasOwn(DIRS, dir)) throw new Error("Unbekannte Richtung.");
        if (state.phase !== "running" && state.phase !== "countdown") return false;
        const me = state.players.find(p => p.id === player.id);
        if (!me || !me.alive || me.held === dir) return false;
        me.held = dir;
        if (dir) me.facing = dir;
    },

    bomb(state, action, player) {
        if (state.phase !== "running") return false;
        const me = state.players.find(p => p.id === player.id);
        if (!me) return false;
        return placeBomb(state, me) ? undefined : false;
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Die Partie läuft noch.");
        state.phase = "setup";
        state.players = [];
        state.grid = null;
        state.hidden = {};
        state.bombs = [];
        state.flames = [];
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

/** Ersetzt absolute Zeitpunkte durch Restzeiten und lässt interne/geheime Felder weg. */
function viewFor(state) {
    const remaining = state.phaseEndsAt ? Math.max(0, state.phaseEndsAt - Date.now()) : null;
    return {
        ...state,
        rng: undefined,
        hidden: undefined,
        phaseEndsAt: undefined,
        countdownMs: state.phase === "countdown" ? remaining : null,
        roundOverMs: state.phase === "roundOver" ? remaining : null,
        suddenDeathInMs: state.phase === "running" ? Math.max(0, (SUDDEN_DEATH_TICKS - state.roundTicks) * TICK_MS) : null,
        // Bot-Interna (Persönlichkeit, Ziel, Pause) gehen die Clients nichts an
        players: state.players.map(({ cooldown, traits, botTarget, botTargetUntil, botPause, ...player }) =>
            ({ ...player, stepMs: STEP_TICKS[player.speed] * TICK_MS }))
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "bombenlabyrinth",
        name: "Bomben-Labyrinth",
        description: "Explosives Echtzeit-Gerangel im Labyrinth: Lege Bomben, sprenge Kisten frei und sammle Power-ups für mehr Reichweite, Bomben und Tempo. Wer zuletzt steht, gewinnt die Runde.",
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
            tickMs: TICK_MS,
            fuseTicks: FUSE_TICKS,
            players: [],
            grid: null,
            hidden: {},
            bombs: [],
            flames: [],
            shrinkIndex: 0,
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
        participant.held = null;
        if (participant.alive) {
            participant.alive = false;
            participant.diedAt = { x: participant.x, y: participant.y };
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
        WIDTH, HEIGHT, WALL, CRATE, EMPTY, TICK_MS, COUNTDOWN_MS, ROUND_PAUSE_MS, STEP_TICKS, FUSE_TICKS, FLAME_TICKS,
        SUDDEN_DEATH_TICKS, SHRINK_EVERY_TICKS, ROUND_MAX_TICKS, MAX_BOMBS, MAX_RANGE, MAX_SPEED, SPAWNS, SPIRAL,
        indexOf, isPillar, blastCells, dangerMap
    }
};

"use strict";

/**
 * Revierkampf – Server-Teil.
 *
 * Echtzeit-Gebietseroberung auf einer Rasterkarte mit Seen:
 *  - Jeder Spieler wählt einen Startpunkt und beginnt mit einem kleinen Revier.
 *  - Truppen wachsen ständig (abhängig von Reviergröße und Truppenzahl).
 *  - Per Klick auf ein benachbartes Gebiet wird ein Teil der Truppen losgeschickt;
 *    der Angriff erobert Feld für Feld, bis die Truppen aufgebraucht sind.
 *  - Bots füllen das Spielfeld auf.
 *
 * Phasen:  setup → spawn → running → finished → (Neue Runde) setup
 *
 * Der Zustand ist reines JSON. Die Karte steht als Text in state.grid
 * (ein Zeichen pro Feld):  "~" Wasser,  "." neutrales Land,  "A"–"P" Spieler 0–15.
 *
 * Diese Datei nutzt den optionalen tick()-Hook des Lobby-Systems
 * (siehe dokumentation.md, Abschnitt "Neues Spiel hinzufügen").
 */

const { pickBotNames } = require("../../server/bot-names");

// ===========================================================================
// Einstellungen
// ===========================================================================

const WIDTH = 144;
const HEIGHT = 90;
const WATER = "~";
const NEUTRAL = ".";
const OWNER_CHARS = "ABCDEFGHIJKLMNOP";
const MAX_PARTICIPANTS = OWNER_CHARS.length; // 16
const MAX_BOTS = 8;
const DEFAULT_BOTS = 3;
const WATER_SHARE = 0.25;

const SPAWN_DURATION_MS = 10_000;
const SPAWN_RADIUS = 3;
const MIN_SPAWN_DISTANCE = 10;
const START_TROOPS = 150;

const WIN_SHARE = 0.7;             // Anteil am Land, der sofort gewinnt
const NEUTRAL_COST = 2;            // Truppen pro neutralem Feld
const ENEMY_BASE_COST = 2;         // Grundkosten pro gegnerischem Feld …
const ENEMY_DENSITY_FACTOR = 1.2;  // … plus Verteidiger-Dichte × Faktor
const MIN_CELLS_PER_TICK = 2;
const MAX_CELLS_PER_TICK = 40;
const BOT_THINK_EVERY = 5;         // Ticks (bei 200 ms ≈ 1 s)
const LOG_SIZE = 6;

/** 16 gut unterscheidbare Farben (Index = Spielerindex). */
const COLORS = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
    "#fabed4", "#469990", "#9a6324", "#800000", "#aaffc3", "#808000", "#ffd8b1", "#000075"
];

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

/**
 * Kleiner Zufallsgenerator (mulberry32) mit Zustand als Zahl – dadurch lässt
 * sich der Zufall im JSON-Zustand speichern und in Tests reproduzieren.
 */
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
        int(max) {
            return Math.floor(this.next() * max);
        },
        get state() {
            return value;
        }
    };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = value => Math.round(value * 100) / 100;
const indexOf = (x, y) => y * WIDTH + x;

/** Indizes der (bis zu 4) direkten Nachbarfelder. */
function neighborIndices(index) {
    const x = index % WIDTH;
    const result = [];
    if (x > 0) result.push(index - 1);
    if (x < WIDTH - 1) result.push(index + 1);
    if (index >= WIDTH) result.push(index - WIDTH);
    if (index < WIDTH * (HEIGHT - 1)) result.push(index + WIDTH);
    return result;
}

const ownerChar = playerIndex => OWNER_CHARS[playerIndex];

/** Spielerindex eines Feldes oder -1 (neutral) bzw. null (Wasser). */
function ownerOf(cell) {
    if (cell === WATER) return null;
    if (cell === NEUTRAL) return -1;
    return OWNER_CHARS.indexOf(cell);
}

function addLog(state, text) {
    state.log = [...state.log, text].slice(-LOG_SIZE);
}

function maxTroops(cells) {
    return 100 + cells * 12;
}

// ===========================================================================
// Karte
// ===========================================================================

/** Eine Lage "Value Noise": zufällige Gitterwerte, weich interpoliert. */
function createNoiseLayer(rng, latticeX, latticeY) {
    const lattice = Array.from({ length: (latticeX + 1) * (latticeY + 1) }, () => rng.next());
    const at = (lx, ly) => lattice[ly * (latticeX + 1) + lx];
    const smooth = t => t * t * (3 - 2 * t);

    return (x, y) => {
        const fx = (x / WIDTH) * latticeX;
        const fy = (y / HEIGHT) * latticeY;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        return top * (1 - ty) + bottom * ty;
    };
}

/**
 * Erzeugt eine Karte mit Seen. Nur die größte zusammenhängende Landfläche
 * bleibt Land – so ist jedes Landfeld für jeden Spieler erreichbar.
 * @returns {string[]} Felder ("~" oder ".")
 */
function generateMap(rng) {
    const coarse = createNoiseLayer(rng, 9, 6);
    const fine = createNoiseLayer(rng, 22, 14);

    const values = new Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            values[indexOf(x, y)] = coarse(x, y) * 0.65 + fine(x, y) * 0.35;
        }
    }

    // Schwelle so wählen, dass etwa WATER_SHARE der Fläche Wasser ist.
    const threshold = [...values].sort((a, b) => a - b)[Math.floor(values.length * WATER_SHARE)];
    const cells = values.map(value => (value < threshold ? WATER : NEUTRAL));

    // Größte zusammenhängende Landfläche suchen (Breitensuche).
    const component = new Int32Array(cells.length).fill(-1);
    let bestComponent = -1;
    let bestSize = 0;
    let componentId = 0;

    for (let start = 0; start < cells.length; start++) {
        if (cells[start] !== NEUTRAL || component[start] !== -1) continue;
        const queue = [start];
        component[start] = componentId;
        for (let head = 0; head < queue.length; head++) {
            for (const next of neighborIndices(queue[head])) {
                if (cells[next] === NEUTRAL && component[next] === -1) {
                    component[next] = componentId;
                    queue.push(next);
                }
            }
        }
        if (queue.length > bestSize) {
            bestSize = queue.length;
            bestComponent = componentId;
        }
        componentId++;
    }

    return cells.map((cell, i) => (cell === NEUTRAL && component[i] !== bestComponent ? WATER : cell));
}

// ===========================================================================
// Startpunkte
// ===========================================================================

/** Ist (x, y) Land und weit genug von allen anderen Startpunkten entfernt? */
function isValidSpawn(state, cells, x, y, ignoreIndex, minDistance = MIN_SPAWN_DISTANCE) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
        return false;
    }
    if (cells[indexOf(x, y)] === WATER) return false;

    return state.players.every((player, index) =>
        index === ignoreIndex || !player.spawn ||
        Math.hypot(player.spawn.x - x, player.spawn.y - y) >= minDistance
    );
}

/** Setzt das Start-Revier eines Spielers (entfernt ein vorheriges). */
function placeSpawn(state, cells, playerIndex, x, y) {
    const char = ownerChar(playerIndex);
    for (let i = 0; i < cells.length; i++) {
        if (cells[i] === char) cells[i] = NEUTRAL;
    }
    for (let dy = -SPAWN_RADIUS; dy <= SPAWN_RADIUS; dy++) {
        for (let dx = -SPAWN_RADIUS; dx <= SPAWN_RADIUS; dx++) {
            const cx = x + dx;
            const cy = y + dy;
            if (cx < 0 || cy < 0 || cx >= WIDTH || cy >= HEIGHT) continue;
            if (dx * dx + dy * dy > SPAWN_RADIUS * SPAWN_RADIUS + 1) continue;
            const i = indexOf(cx, cy);
            if (cells[i] === NEUTRAL) cells[i] = char;
        }
    }
    state.players[playerIndex].spawn = { x, y };
}

/** Sucht einen zufälligen gültigen Startpunkt (lockert notfalls den Abstand). */
function placeRandomSpawn(state, cells, rng, playerIndex) {
    for (let distance = MIN_SPAWN_DISTANCE * 1.5; distance >= 0; distance -= 3) {
        for (let attempt = 0; attempt < 400; attempt++) {
            const x = rng.int(WIDTH);
            const y = rng.int(HEIGHT);
            if (cells[indexOf(x, y)] === NEUTRAL && isValidSpawn(state, cells, x, y, playerIndex, distance)) {
                placeSpawn(state, cells, playerIndex, x, y);
                return;
            }
        }
    }
}

// ===========================================================================
// Zählen und Nachbarschaften
// ===========================================================================

/** Aktualisiert players[].cells anhand der Karte. */
function countCells(state, cells) {
    const counts = new Array(state.players.length).fill(0);
    for (const cell of cells) {
        const owner = ownerOf(cell);
        if (owner !== null && owner >= 0) counts[owner]++;
    }
    state.players.forEach((player, index) => { player.cells = counts[index]; });
}

/**
 * Wer grenzt an wen? Liefert pro Spieler eine Menge von Nachbarn
 * (-1 = neutrales Land, sonst Spielerindex).
 */
function computeNeighbors(state, cells) {
    const neighbors = state.players.map(() => new Set());
    for (let i = 0; i < cells.length; i++) {
        const owner = ownerOf(cells[i]);
        if (owner === null || owner < 0) continue;
        for (const next of neighborIndices(i)) {
            const other = ownerOf(cells[next]);
            if (other !== null && other !== owner) neighbors[owner].add(other);
        }
    }
    return neighbors;
}

/** Fügt einen Angriff hinzu oder stockt einen bestehenden auf dasselbe Ziel auf. */
function addAttack(state, attacker, target, troops) {
    const existing = state.attacks.find(a => a.attacker === attacker && a.target === target);
    if (existing) existing.troops = round2(existing.troops + troops);
    else state.attacks.push({ attacker, target, troops: round2(troops) });
}

/** Beendet alle Angriffe eines ausgeschiedenen Spielers bzw. auf ihn. */
function removeAttacksOf(state, playerIndex) {
    state.attacks = state.attacks.filter(attack => {
        if (attack.attacker === playerIndex) return false;
        if (attack.target === playerIndex) {
            const attacker = state.players[attack.attacker];
            if (attacker.alive) attacker.troops = round2(attacker.troops + attack.troops);
            return false;
        }
        return true;
    });
}

// ===========================================================================
// Spielablauf pro Tick
// ===========================================================================

function growTroops(state) {
    for (const player of state.players) {
        if (!player.alive) continue;
        const limit = maxTroops(player.cells);
        if (player.troops < limit) {
            const growth = 1 + player.cells * 0.03 + player.troops * 0.004;
            player.troops = Math.min(limit, player.troops + growth);
        }
        player.maxTroops = limit;
    }
}

/** Gleichzeitige Angriffe A→B und B→A heben sich zuerst gegenseitig auf. */
function cancelCounterAttacks(state) {
    for (const attack of state.attacks) {
        if (attack.target < 0) continue;
        const counter = state.attacks.find(a => a.attacker === attack.target && a.target === attack.attacker);
        if (!counter) continue;
        const cancelled = Math.min(attack.troops, counter.troops);
        attack.troops -= cancelled;
        counter.troops -= cancelled;
    }
}

/** Führt einen Angriff einen Tick lang aus. @returns {boolean} läuft weiter? */
function advanceAttack(state, cells, rng, attack) {
    const attacker = state.players[attack.attacker];
    const defender = attack.target >= 0 ? state.players[attack.target] : null;
    if (!attacker.alive || (defender && !defender.alive)) {
        if (attacker.alive) attacker.troops += attack.troops;
        return false;
    }

    const attackerChar = ownerChar(attack.attacker);
    const targetChar = defender ? ownerChar(attack.target) : NEUTRAL;

    // Front: Zielfelder mit mindestens einem eigenen Nachbarfeld.
    const front = [];
    for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== targetChar) continue;
        let ownNeighbors = 0;
        for (const next of neighborIndices(i)) {
            if (cells[next] === attackerChar) ownNeighbors++;
        }
        if (ownNeighbors > 0) front.push({ index: i, score: ownNeighbors + rng.next() * 1.5 });
    }

    const density = defender ? defender.troops / Math.max(1, defender.cells) : 0;
    const cost = defender ? ENEMY_BASE_COST + density * ENEMY_DENSITY_FACTOR : NEUTRAL_COST;

    if (front.length === 0 || attack.troops < cost) {
        attacker.troops += attack.troops; // Rest kehrt zurück
        return false;
    }

    // Felder mit vielen eigenen Nachbarn zuerst → das Revier wächst gleichmäßig.
    front.sort((a, b) => b.score - a.score);
    const count = Math.min(front.length, clamp(Math.floor(attack.troops / cost / 10), MIN_CELLS_PER_TICK, MAX_CELLS_PER_TICK));

    for (let k = 0; k < count && attack.troops >= cost; k++) {
        cells[front[k].index] = attackerChar;
        attack.troops -= cost;
        attacker.cells++;
        if (defender) {
            defender.cells--;
            defender.troops = Math.max(0, defender.troops - density);
        }
    }
    return true;
}

/** Einfache Bot-Logik: erst neutrales Land, dann der schwächste Nachbar. */
function runBots(state, rng, neighbors) {
    state.players.forEach((bot, index) => {
        if (!bot.bot || !bot.alive) return;
        if ((state.tickCount + index) % BOT_THINK_EVERY !== 0) return;
        if (bot.troops < maxTroops(bot.cells) * 0.35) return;
        if (state.attacks.some(a => a.attacker === index) && rng.next() < 0.7) return;

        const options = [...neighbors[index]];
        if (options.length === 0) return;

        let target;
        if (options.includes(-1) && rng.next() < 0.85) {
            target = -1;
        } else {
            const enemies = options.filter(o => o >= 0);
            if (enemies.length === 0) {
                target = -1;
            } else {
                const densityOf = i => state.players[i].troops / Math.max(1, state.players[i].cells);
                target = enemies.reduce((weakest, o) => (densityOf(o) < densityOf(weakest) ? o : weakest));
            }
        }

        const troops = bot.troops * (0.3 + rng.next() * 0.3);
        bot.troops -= troops;
        addAttack(state, index, target, troops);
    });
}

/** Ausgeschiedene markieren, Sieg prüfen. */
function checkEliminationsAndEnd(state) {
    state.players.forEach((player, index) => {
        if (player.alive && player.cells === 0) {
            player.alive = false;
            player.troops = 0;
            removeAttacksOf(state, index);
            addLog(state, `${player.name} wurde besiegt.`);
        }
    });

    const alive = state.players.filter(p => p.alive);
    const leader = [...state.players].sort((a, b) => b.cells - a.cells)[0];
    const humansAlive = alive.some(p => !p.bot);

    if (alive.length <= 1 || !humansAlive || leader.cells >= state.landCells * WIN_SHARE) {
        state.phase = "finished";
        state.attacks = [];
        state.winner = state.players.indexOf(leader);
        addLog(state, `${leader.name} gewinnt die Runde!`);
    }
}

function tickRunning(state) {
    const rng = createRng(state.rng);
    const cells = state.grid.split("");

    countCells(state, cells);
    growTroops(state);
    runBots(state, rng, computeNeighbors(state, cells));
    cancelCounterAttacks(state);
    state.attacks = state.attacks.filter(attack => advanceAttack(state, cells, rng, attack));
    countCells(state, cells);
    checkEliminationsAndEnd(state);

    for (const player of state.players) {
        player.troops = round2(player.troops);
        player.maxTroops = maxTroops(player.cells);
    }
    for (const attack of state.attacks) attack.troops = round2(attack.troops);

    state.grid = cells.join("");
    state.rng = rng.state;
    state.tickCount++;
}

/** Spawn-Phase beenden: fehlende Startpunkte zufällig vergeben, Spiel starten. */
function finishSpawnPhase(state) {
    const rng = createRng(state.rng);
    const cells = state.grid.split("");

    state.players.forEach((player, index) => {
        if (!player.spawn && !player.left) placeRandomSpawn(state, cells, rng, index);
    });

    countCells(state, cells);
    for (const player of state.players) {
        player.alive = !player.left && player.cells > 0;
        player.troops = player.alive ? START_TROOPS : 0;
        player.maxTroops = maxTroops(player.cells);
    }

    state.grid = cells.join("");
    state.rng = rng.state;
    state.phase = "running";
    state.spawnSecondsLeft = 0;
    addLog(state, "Los geht's!");
}

// ===========================================================================
// Rundenstart
// ===========================================================================

function createPlayer(index, { id, name, bot }) {
    return {
        id,
        name,
        bot,
        color: COLORS[index],
        alive: true,
        left: false,
        troops: 0,
        maxTroops: maxTroops(0),
        cells: 0,
        spawn: null
    };
}

function startRound(state, now) {
    const humans = state.members.slice(0, MAX_PARTICIPANTS);
    const botCount = Math.min(state.settings.bots, MAX_PARTICIPANTS - humans.length);
    if (humans.length + botCount < 2) {
        throw new Error("Für eine Runde braucht es mindestens 2 Teilnehmer – füge Bots hinzu.");
    }

    const rng = createRng(state.rng);
    const cells = generateMap(rng);

    const botNames = pickBotNames(botCount, humans.map(h => h.name));
    state.players = [
        ...humans.map((member, i) => createPlayer(i, { ...member, bot: false })),
        ...Array.from({ length: botCount }, (_, i) =>
            createPlayer(humans.length + i, { id: `bot-${i + 1}`, name: botNames[i], bot: true }))
    ];

    // Bots setzen ihren Startpunkt sofort – so sehen Menschen, wo schon jemand ist.
    state.players.forEach((player, index) => {
        if (player.bot) placeRandomSpawn(state, cells, rng, index);
    });

    state.phase = "spawn";
    state.round++;
    state.grid = cells.join("");
    state.landCells = cells.filter(cell => cell !== WATER).length;
    state.attacks = [];
    state.winner = null;
    state.tickCount = 0;
    state.spawnEndsAt = now + SPAWN_DURATION_MS;
    state.spawnSecondsLeft = Math.ceil(SPAWN_DURATION_MS / 1000);
    state.rng = rng.state;
    state.log = [];
    countCells(state, cells);
    addLog(state, `Runde ${state.round}: Wählt eure Startpunkte!`);
}

// ===========================================================================
// Aktionen
// ===========================================================================

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) {
        throw new Error("Das darf nur der Host der Lobby.");
    }
}

function requireActivePlayer(state, player) {
    const index = state.players.findIndex(p => p.id === player.id);
    if (index === -1) throw new Error("Du spielst in dieser Runde nicht mit – nächste Runde bist du dabei.");
    if (!state.players[index].alive) throw new Error("Du bist in dieser Runde ausgeschieden.");
    return index;
}

function readCoordinates(action) {
    const x = Number(action.x);
    const y = Number(action.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
        throw new Error("Ungültige Position.");
    }
    return { x, y };
}

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor der Runde möglich.");
        const bots = Number(action.bots);
        if (!Number.isInteger(bots) || bots < 0 || bots > MAX_BOTS) {
            throw new Error(`Es sind 0 bis ${MAX_BOTS} Bots möglich.`);
        }
        state.settings.bots = bots;
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Die Runde läuft bereits.");
        startRound(state, context.now ?? Date.now());
    },

    spawn(state, action, player) {
        if (state.phase !== "spawn") throw new Error("Startpunkte können nur zu Beginn gewählt werden.");
        const index = requireActivePlayer(state, player);
        const { x, y } = readCoordinates(action);
        const cells = state.grid.split("");

        if (cells[indexOf(x, y)] === WATER) throw new Error("Startpunkte müssen an Land liegen.");
        if (!isValidSpawn(state, cells, x, y, index)) throw new Error("Zu nah an einem anderen Startpunkt.");

        placeSpawn(state, cells, index, x, y);
        countCells(state, cells);
        state.grid = cells.join("");
    },

    attack(state, action, player) {
        if (state.phase !== "running") throw new Error("Angriffe sind nur während der Runde möglich.");
        const index = requireActivePlayer(state, player);
        const { x, y } = readCoordinates(action);
        const cells = state.grid.split("");
        const target = ownerOf(cells[indexOf(x, y)]);

        // Klick auf Wasser oder das eigene Gebiet: einfach ignorieren (kein Fehler-Hinweis).
        if (target === null || target === index) return false;

        if (!computeNeighbors(state, cells)[index].has(target)) {
            throw new Error("Kein gemeinsamer Grenzabschnitt mit diesem Gebiet.");
        }

        const percent = clamp(Math.round(Number(action.percent) || 0), 1, 100);
        const attacker = state.players[index];
        const troops = Math.floor(attacker.troops * percent / 100);
        if (troops < 1) throw new Error("Zu wenige Truppen für einen Angriff.");

        attacker.troops = round2(attacker.troops - troops);
        addAttack(state, index, target, troops);
    },

    "new-round"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Die Runde läuft noch.");
        state.phase = "setup";
        state.players = [];
        state.attacks = [];
        state.grid = "";
        state.winner = null;
        state.log = [];
    }
};

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "revierkampf",
        name: "Revierkampf",
        description: "Echtzeit-Strategie um Gebiete: Baue dein Revier aus, schicke Truppen zu den Nachbarn und erobere die Karte. Wer 70 % des Landes hält, gewinnt.",
        minPlayers: 1,
        tickMs: 200
    },

    createState({ players }) {
        return {
            phase: "setup",
            round: 0,
            width: WIDTH,
            height: HEIGHT,
            grid: "",
            landCells: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            players: [],
            attacks: [],
            settings: { bots: DEFAULT_BOTS, maxBots: MAX_BOTS },
            spawnEndsAt: null,
            spawnSecondsLeft: 0,
            winner: null,
            tickCount: 0,
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
        if (state.phase === "spawn") {
            if (now >= state.spawnEndsAt) {
                const next = structuredClone(state);
                finishSpawnPhase(next);
                return next;
            }
            const secondsLeft = Math.ceil((state.spawnEndsAt - now) / 1000);
            if (secondsLeft === state.spawnSecondsLeft) return undefined;
            return { ...state, spawnSecondsLeft: secondsLeft };
        }

        if (state.phase === "running") {
            const next = structuredClone(state);
            tickRunning(next);
            return next;
        }

        return undefined; // setup / finished: nichts zu tun
    },

    onPlayerJoin(state, player) {
        const next = structuredClone(state);
        if (!next.members.some(m => m.id === player.id)) {
            next.members.push({ id: player.id, name: player.name });
        }
        // Während der Startphase darf man noch (wieder) einsteigen.
        if (next.phase === "spawn") {
            const existing = next.players.find(p => p.id === player.id);
            if (existing) {
                existing.left = false;
                existing.alive = true;
            } else if (next.players.length < MAX_PARTICIPANTS) {
                next.players.push(createPlayer(next.players.length, { ...player, bot: false }));
            }
        }
        return next;
    },

    onPlayerLeave(state, player) {
        const next = structuredClone(state);
        next.members = next.members.filter(m => m.id !== player.id);

        const index = next.players.findIndex(p => p.id === player.id);
        if (index === -1 || !next.players[index].alive || next.phase === "setup") return next;

        const char = ownerChar(index);
        if (next.grid) next.grid = next.grid.replaceAll(char, NEUTRAL);
        const leaver = next.players[index];
        leaver.alive = false;
        leaver.left = true;
        leaver.cells = 0;
        leaver.troops = 0;
        leaver.spawn = null;
        removeAttacksOf(next, index);
        addLog(next, `${leaver.name} hat das Spiel verlassen.`);

        if (next.phase === "running") checkEliminationsAndEnd(next);
        return next;
    },

    // Für Tests
    _internals: { WIDTH, HEIGHT, WATER, NEUTRAL, OWNER_CHARS, generateMap, createRng, MIN_SPAWN_DISTANCE, maxTroops }
};

"use strict";

/**
 * Turmwacht – Server-Teil.
 *
 * Koop-Tower-Defense für 1–4 Spieler: Gegnerwellen laufen über einen zufällig
 * erzeugten Pfad, die Gruppe baut gemeinsam Türme daneben. Jeder Gegner, der
 * das Ziel erreicht, kostet gemeinsame Leben.
 *
 * Phasen:  setup → build → wave → build → wave … → finished
 *   setup   Host würfelt die Karte, wählt Schwierigkeit und Wellenzahl (10/20/30/endlos)
 *   build   Bauphase (25 s); endet früher, wenn alle „Bereit“ sind (Bonus-Gold)
 *   wave    Gegner laufen; bauen, upgraden und verkaufen geht weiterhin
 *
 * Wirtschaft (Koop): Startgold, Kopfgeld und Wellenbonus werden gleichmäßig auf
 * alle aktiven Spieler verteilt – das Einkommen der Gruppe hängt also nicht von
 * der Spielerzahl ab. Jeder zahlt aus seiner eigenen Kasse und kann Mitspielern
 * Gold schenken. Türme gehören dem Erbauer; upgraden darf jeder. Beim Verkauf
 * bekommt jeder Geldgeber seinen Anteil zurück (70 %, in derselben Bauphase 100 %).
 *
 * Wertung: Schaden der Türme wird anteilig nach Investition gutgeschrieben;
 * placements sind nach Schaden sortiert.
 */

const data = require("./data");
const { generateMap, cellAt, createRng } = require("./map");
const sim = require("./sim");

const { TOWERS, TOWER_IDS, MAX_LEVEL, SELL_RATE, ENEMIES, DIFFICULTIES, WAVE_OPTIONS, START_GOLD, START_LIVES } = data;

const MAX_PLAYERS = 4;
const TICK_MS = 100;
const BUILD_TICKS = 250;         // 25 s Bauphase
const FIRST_BUILD_TICKS = 300;   // 30 s vor der ersten Welle
const EARLY_BONUS_PER_SECOND = 2;
const FX_TICKS = 3;
const LOG_SIZE = 8;
const GIFT_STEP = 25;
const COLORS = ["#1d9bf0", "#e63946", "#2ec27e", "#ffb300"];
const DEFAULT_DIFFICULTY = "mittel";
const DEFAULT_WAVES = 20;

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

const activePlayers = state => state.players.filter(p => !p.left);

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) throw new Error("Das darf nur der Host der Lobby.");
}

/** Aktiver Teilnehmer der laufenden Partie (sonst Fehler). */
function requirePlayer(state, player) {
    if (state.phase !== "build" && state.phase !== "wave") throw new Error("Gerade läuft keine Partie.");
    const p = state.players.find(x => x.id === player.id && !x.left);
    if (!p) throw new Error("Du schaust bei dieser Partie nur zu.");
    return p;
}

/**
 * Gold gleichmäßig auf alle aktiven Spieler verteilen. Bruchteile sammelt jeder
 * in p.frac, damit nichts verloren geht.
 */
function distribute(state, amount, players = activePlayers(state)) {
    if (players.length === 0 || amount <= 0) return;
    const share = amount / players.length;
    for (const p of players) {
        p.frac += share;
        const whole = Math.floor(p.frac + 1e-9);
        p.gold += whole;
        p.frac -= whole;
    }
}

function nextRandomSeed(state) {
    const rng = createRng(state.rng);
    const seed = Math.floor(rng.next() * 4294967296);
    state.rng = rng.state;
    return seed;
}

function towerAt(state, x, y) {
    return state.towers.find(t => t.x === x && t.y === y) ?? null;
}

function findTower(state, id) {
    const tower = state.towers.find(t => t.id === id);
    if (!tower) throw new Error("Diesen Turm gibt es nicht.");
    return tower;
}

/** Was hat dieser Spieler in dieser Bauphase in den Turm gesteckt? */
function freshAmount(state, tower, playerId) {
    if (state.phase !== "build" || !tower.fresh || tower.fresh.round !== state.buildRound) return 0;
    return tower.fresh.by[playerId] ?? 0;
}

function invest(state, tower, p, amount) {
    p.gold -= amount;
    p.stats.invested += amount;
    tower.invest[p.id] = (tower.invest[p.id] ?? 0) + amount;
    tower.spent += amount;
    if (state.phase === "build") {
        if (!tower.fresh || tower.fresh.round !== state.buildRound) tower.fresh = { round: state.buildRound, by: {} };
        tower.fresh.by[p.id] = (tower.fresh.by[p.id] ?? 0) + amount;
    }
}

/** Rückzahlung je Geldgeber beim Verkauf. */
function refunds(state, tower) {
    const result = {};
    for (const [id, amount] of Object.entries(tower.invest)) {
        const fresh = freshAmount(state, tower, id);
        result[id] = Math.floor(fresh + (amount - fresh) * SELL_RATE);
    }
    return result;
}

// ===========================================================================
// Ablauf
// ===========================================================================

function startMatch(state) {
    const diff = DIFFICULTIES[state.settings.difficulty];
    state.matchNumber += 1;
    Object.assign(state, freshField());
    state.players = state.members.slice(0, MAX_PLAYERS).map((m, i) => ({
        id: m.id, name: m.name, color: COLORS[i], gold: 0, frac: 0, ready: false, left: false,
        stats: { damage: 0, kills: 0, built: 0, invested: 0, gifted: 0 }
    }));
    Object.assign(state, {
        phase: "build",
        lives: START_LIVES,
        buildT: FIRST_BUILD_TICKS,
        buildRound: 1,
        difficultySpeed: diff.speed
    });
    distribute(state, Math.round(START_GOLD * diff.gold));
    addLog(state, `Turmwacht beginnt – ${state.settings.waves ? `${state.settings.waves} Wellen` : "endlos"}, ${diff.name.toLowerCase()}.`);
}

function startWave(state, early) {
    if (early && state.buildT > 0) {
        const bonus = Math.floor(state.buildT / 10) * EARLY_BONUS_PER_SECOND;
        if (bonus > 0) {
            distribute(state, bonus);
            addLog(state, `Früher Start: +${bonus} Gold für die Gruppe.`);
        }
    }
    state.wave += 1;
    state.phase = "wave";
    state.buildT = 0;
    state.spawn = data.waveList(state.wave);
    state.spawnT = 1;
    for (const p of state.players) p.ready = false;
    addLog(state, state.spawn.includes("koloss") ? `Welle ${state.wave}: Ein Koloss naht!` : `Welle ${state.wave} kommt.`);
}

function endWave(state) {
    const bonus = Math.round(data.waveBonus(state.wave) * DIFFICULTIES[state.settings.difficulty].gold);
    distribute(state, bonus);
    if (state.settings.waves && state.wave >= state.settings.waves) {
        finishMatch(state, "victory");
        return;
    }
    state.phase = "build";
    state.buildT = BUILD_TICKS;
    state.buildRound += 1;
    addLog(state, `Welle ${state.wave} abgewehrt: +${bonus} Gold.`);
}

function finishMatch(state, outcome) {
    const placements = [...state.players]
        .sort((a, b) => (b.stats.damage - a.stats.damage) || (b.stats.kills - a.stats.kills) || (b.stats.invested - a.stats.invested))
        .map(p => p.id);
    state.phase = "finished";
    state.spawn = [];
    for (const p of state.players) {
        p.ready = false;
        p.stats.damage = Math.round(p.stats.damage);
    }
    state.result = { outcome, winnerId: placements[0] ?? null, placements, wave: state.wave, waves: state.settings.waves };
    addLog(state, outcome === "victory" ? "Verteidigt! Alle Wellen sind abgewehrt." :
        outcome === "aborted" ? "Spiel beendet." : `Gefallen in Welle ${state.wave}.`);
}

/** Rückrufe für die Simulation. */
function hooksFor(state) {
    const credit = (tower, fn) => {
        const players = new Map(state.players.map(p => [p.id, p]));
        for (const [id, amount] of Object.entries(tower.invest)) {
            const p = players.get(id);
            if (p) fn(p, amount / tower.spent);
        }
    };
    return {
        spawn(type) {
            const def = ENEMIES[type];
            const hp = Math.round(data.waveHp(state.wave, state.settings.difficulty) * def.hp);
            state.enemies.push({
                id: `e${state.nextId++}`, type, hp, maxHp: hp, armor: data.armorFor(type, state.wave),
                bounty: Math.max(1, Math.round(data.bountyFor(type, state.wave) * DIFFICULTIES[state.settings.difficulty].gold)), d: 0, x: state.map.points[0][0], y: state.map.points[0][1], slow: 0, slowT: 0
            });
        },
        damage(tower, enemy, dealt) {
            tower.damage += dealt;
            credit(tower, (p, share) => { p.stats.damage += dealt * share; });
        },
        kill(tower, enemy) {
            const owner = state.players.find(p => p.id === tower.ownerId) ??
                state.players.find(p => p.id === Object.entries(tower.invest).sort((a, b) => b[1] - a[1])[0]?.[0]);
            if (owner) owner.stats.kills += 1;
            distribute(state, enemy.bounty);
            state.fx.push({ t: state.tickNo, k: "die", x: enemy.x, y: enemy.y, type: enemy.type, gold: enemy.bounty });
        },
        leak(enemy) {
            state.lives = Math.max(0, state.lives - ENEMIES[enemy.type].lives);
            state.fx.push({ t: state.tickNo, k: "leak", x: enemy.x, y: enemy.y });
        }
    };
}

function step(state) {
    state.tickNo += 1;
    if (state.phase === "build") {
        state.buildT -= 1;
        if (state.buildT <= 0) startWave(state, false);
    } else if (state.phase === "wave") {
        const hooks = hooksFor(state);
        for (let i = 0; i < state.speed && state.phase === "wave"; i++) {
            sim.simulate(state, hooks);
            if (state.lives <= 0) {
                finishMatch(state, state.settings.waves ? "defeat" : "endless");
            } else if (state.spawn.length === 0 && state.enemies.length === 0) {
                endWave(state);
            }
        }
    }
    state.fx = state.fx.filter(f => state.tickNo - f.t < FX_TICKS);
}

// ===========================================================================
// Aktionen
// ===========================================================================

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor dem Start möglich.");
        if (action.difficulty !== undefined) {
            if (!Object.hasOwn(DIFFICULTIES, action.difficulty)) throw new Error("Unbekannte Schwierigkeit.");
            state.settings.difficulty = action.difficulty;
        }
        if (action.waves !== undefined) {
            const waves = Number(action.waves);
            if (!WAVE_OPTIONS.includes(waves)) throw new Error("Unbekannte Wellenzahl.");
            state.settings.waves = waves;
        }
    },

    "new-map"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Die Karte wird vor dem Start gewürfelt.");
        state.map = generateMap(nextRandomSeed(state));
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Das Spiel läuft bereits.");
        if (state.members.length === 0) throw new Error("Niemand ist da.");
        startMatch(state);
    },

    build(state, action, player) {
        const p = requirePlayer(state, player);
        if (!Object.hasOwn(TOWERS, action.tower)) throw new Error("Unbekannter Turm.");
        const x = Number(action.x);
        const y = Number(action.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || cellAt(state.map, x, y) === null) throw new Error("Ungültiges Feld.");
        if (cellAt(state.map, x, y) !== "." ) throw new Error("Kein Bauplatz.");
        if (towerAt(state, x, y)) throw new Error("Feld belegt.");
        const cost = TOWERS[action.tower].cost;
        if (p.gold < cost) throw new Error("Nicht genug Gold.");
        const tower = { id: `t${state.nextId++}`, type: action.tower, x, y, level: 1, ownerId: p.id, invest: {}, spent: 0, fresh: null, cd: 0, damage: 0 };
        state.towers.push(tower);
        invest(state, tower, p, cost);
        p.stats.built += 1;
    },

    upgrade(state, action, player) {
        const p = requirePlayer(state, player);
        const tower = findTower(state, action.towerId);
        const cost = data.upgradeCost(tower.type, tower.level);
        if (cost === null) throw new Error("Der Turm hat schon die höchste Stufe.");
        if (p.gold < cost) throw new Error("Nicht genug Gold.");
        invest(state, tower, p, cost);
        tower.level += 1;
        if (tower.ownerId !== p.id) {
            const owner = state.players.find(x => x.id === tower.ownerId);
            addLog(state, `${p.name} verbessert ${owner ? `den ${TOWERS[tower.type].name} von ${owner.name}` : `einen ${TOWERS[tower.type].name}`} auf Stufe ${tower.level}.`);
        }
    },

    sell(state, action, player) {
        const p = requirePlayer(state, player);
        const tower = findTower(state, action.towerId);
        const owner = state.players.find(x => x.id === tower.ownerId && !x.left);
        if (owner && owner.id !== p.id) throw new Error("Nur der Erbauer darf diesen Turm verkaufen.");
        const back = refunds(state, tower);
        for (const [id, amount] of Object.entries(back)) {
            // wer die Partie verlassen hat, dessen Anteil geht an den Verkäufer
            const investor = state.players.find(x => x.id === id && !x.left) ?? p;
            investor.gold += amount;
        }
        state.towers = state.towers.filter(t => t !== tower);
    },

    gift(state, action, player) {
        const p = requirePlayer(state, player);
        const target = state.players.find(x => x.id === action.to && !x.left);
        if (!target || target.id === p.id) throw new Error("Unbekannter Mitspieler.");
        const amount = Number(action.amount);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error("Ungültiger Betrag.");
        if (amount > p.gold) throw new Error("So viel Gold hast du nicht.");
        p.gold -= amount;
        target.gold += amount;
        p.stats.gifted += amount;
        addLog(state, `${p.name} schenkt ${target.name} ${amount} Gold.`);
    },

    ready(state, action, player) {
        const p = requirePlayer(state, player);
        if (state.phase !== "build") return false;
        p.ready = !p.ready;
        if (activePlayers(state).every(x => x.ready)) startWave(state, true);
    },

    "call-wave"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "build") throw new Error("Die Welle läuft schon.");
        startWave(state, true);
    },

    speed(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "build" && state.phase !== "wave") throw new Error("Gerade läuft keine Partie.");
        state.speed = state.speed === 1 ? 2 : 1;
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Das Spiel läuft noch.");
        Object.assign(state, freshField(), { phase: "setup", result: null, log: [] });
    }
};

/** Leeres Spielfeld (vor dem Start bzw. nach „Neues Spiel“). */
function freshField() {
    return {
        players: [], towers: [], enemies: [], spawn: [], spawnT: 0, fx: [],
        wave: 0, lives: START_LIVES, buildT: 0, buildRound: 0, speed: 1, difficultySpeed: 1, tickNo: 0
    };
}

// ===========================================================================
// Sicht eines Spielers (viewFor)
// ===========================================================================

const round2 = n => Math.round(n * 100) / 100;

function viewFor(state) {
    return {
        ...state,
        rng: undefined,
        players: state.players.map(({ frac, ...p }) => ({ ...p, stats: { ...p.stats, damage: Math.round(p.stats.damage) } })),
        towers: state.towers.map(({ fresh, invest: shares, ...t }) => ({
            ...t, damage: Math.round(t.damage), investors: Object.keys(shares),
            refund: Object.values(refunds(state, { ...t, fresh, invest: shares })).reduce((a, b) => a + b, 0)
        })),
        enemies: state.enemies.map(e => ({ ...e, x: round2(e.x), y: round2(e.y), d: round2(e.d), hp: Math.ceil(e.hp) })),
        upcoming: state.phase === "build" ? summarize(data.waveList(state.wave + 1)) : null
    };
}

/** Vorschau der nächsten Welle: { typ: anzahl }. */
function summarize(list) {
    const counts = {};
    for (const type of list) counts[type] = (counts[type] ?? 0) + 1;
    return counts;
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "turmwacht",
        name: "Turmwacht",
        description: "Koop-Tower-Defense für 1–4: Baut gemeinsam Türme am zufälligen Pfad und haltet Welle um Welle auf – mit eigener Kasse, geteiltem Einkommen und Geschenken. Auch endlos spielbar.",
        minPlayers: 1,
        maxPlayers: MAX_PLAYERS,
        tickMs: TICK_MS
    },

    createState({ players }) {
        const rng = Math.floor(Math.random() * 4294967296);
        const state = {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            settings: { difficulty: DEFAULT_DIFFICULTY, waves: DEFAULT_WAVES },
            catalog: {
                towers: Object.fromEntries(TOWER_IDS.map(id => [id, {
                    name: TOWERS[id].name, short: TOWERS[id].short, info: TOWERS[id].info, color: TOWERS[id].color, cost: TOWERS[id].cost,
                    levels: TOWERS[id].levels, upgrades: [1, 2, 3].map(level => data.upgradeCost(id, level))
                }])),
                enemies: Object.fromEntries(Object.entries(ENEMIES).map(([id, e]) => [id, { name: e.name, color: e.color, size: e.size, boss: Boolean(e.boss) }])),
                difficulties: Object.fromEntries(Object.entries(DIFFICULTIES).map(([id, d]) => [id, d.name])),
                waveOptions: WAVE_OPTIONS
            },
            world: { tickMs: TICK_MS, buildTicks: BUILD_TICKS, firstBuildTicks: FIRST_BUILD_TICKS, fxTicks: FX_TICKS, maxLevel: MAX_LEVEL, sellRate: SELL_RATE, giftStep: GIFT_STEP, startLives: START_LIVES },
            map: null,
            ...freshField(),
            result: null,
            log: [],
            nextId: 1,
            rng
        };
        state.map = generateMap(nextRandomSeed(state));
        return state;
    },

    handleAction(state, action, player, context) {
        const handler = Object.hasOwn(actions, action.type) ? actions[action.type] : null;
        if (!handler) throw new Error("Unbekannte Aktion.");
        const next = structuredClone(state);
        const result = handler(next, action, player, context);
        return result === false ? undefined : next;
    },

    tick(state) {
        if (state.phase !== "build" && state.phase !== "wave") return undefined;
        const next = structuredClone(state);
        step(next);
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
        if (!p || p.left || (next.phase !== "build" && next.phase !== "wave")) return next;
        p.left = true;
        p.ready = false;
        const rest = activePlayers(next);
        distribute(next, p.gold + p.frac, rest);
        p.gold = 0;
        p.frac = 0;
        for (const tower of next.towers) if (tower.ownerId === p.id) tower.ownerId = null;
        addLog(next, `${p.name} hat die Wacht verlassen – Gold und Türme bleiben bei der Gruppe.`);
        if (rest.length === 0) finishMatch(next, "aborted");
        else if (next.phase === "build" && rest.every(x => x.ready)) startWave(next, true);
        return next;
    },

    /** Nur für Tests. */
    _internals: {
        ...data, MAX_PLAYERS, BUILD_TICKS, FIRST_BUILD_TICKS, EARLY_BONUS_PER_SECOND, GIFT_STEP, COLORS,
        generateMap, sim, distribute, refunds, startWave, endWave, step, hooksFor
    }
};

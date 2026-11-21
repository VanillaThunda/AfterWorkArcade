"use strict";

/**
 * Artillerie-Duell – Server-Teil.
 *
 * Rundenbasiertes Artilleriespiel (eigene Regeln und Grafik): Panzer stehen auf
 * einem zerstörbaren Gelände. In jeder Salve zielen alle GLEICHZEITIG (Winkel,
 * Kraft, Waffe, ein paar Meter fahren), dann fliegen alle Geschosse zusammen.
 * Wer keine Trefferpunkte mehr hat, scheidet aus; der Letzte gewinnt die Runde.
 *
 * Phasen:  setup → aiming → flight → aiming … → roundOver → … → finished
 *
 * Physik (reine Funktionen, wiederverwendbar z. B. für ein späteres Burgen-Duell):
 *   generateTerrain · restY · carve · launch · stepProjectile · simulateShot · resolveVolley
 * Koordinaten: x nach rechts (0 … WIDTH), y nach OBEN (0 = Boden der Welt).
 * Das Gelände ist ein Höhenprofil: heights[i] = Geländehöhe der Spalte i (je COL Einheiten breit).
 *
 * Der Server rechnet die ganze Salve vorab; der Client spielt sie aus state.flight
 * als Animation ab (Pfade, Krater, Schaden, Stürze).
 */

const { pickBotNames } = require("../../server/bot-names");

// ===========================================================================
// Einstellungen
// ===========================================================================

const WIDTH = 800;
const HEIGHT = 400;
const COL = 2;                       // Breite einer Gelände-Spalte
const COLS = WIDTH / COL;

const GRAVITY = 120;                 // Einheiten/s²
const POWER_SCALE = 3.3;             // Kraft 100 → 330 Einheiten/s
const WIND_MAX = 30;                 // max. Windbeschleunigung (Einheiten/s²)
const DT = 0.02;                     // Simulationsschritt (s)
const SAMPLE_EVERY = 2;              // Pfadpunkt alle 2 Schritte (40 ms)
const MAX_FLIGHT_S = 12;
const OWNER_IMMUNE_S = 0.2;          // eigener Panzer wird beim Abschuss nicht getroffen

const TANK_HALF = 13;                // Rumpf: 26 breit …
const TANK_HEIGHT = 12;              // … 12 hoch
const BARREL = 17;
const START_HP = 100;
const FUEL = 10;                     // Fahrschritte pro Salve
const MOVE_STEP = 8;
const MAX_CLIMB = 14;                // höher geht es nicht in einem Schritt
const FALL_SAFE = 20;                // so tief fällt man ohne Schaden

const WEAPONS = Object.freeze({
    granate: { name: "Granate", radius: 30, damage: 45 },
    splitter: { name: "Splitter", radius: 18, damage: 20, fragments: 5, fragmentRadius: 14, fragmentDamage: 15, fragmentSpeed: 110 },
    bohrer: { name: "Bohrer", radius: 22, damage: 35, dig: 70, channel: 6 }
});
const START_AMMO = Object.freeze({ splitter: 2, bohrer: 2 }); // Granate unbegrenzt

const MAX_PARTICIPANTS = 6;
const MAX_BOTS = 5;
const DEFAULT_BOTS = 2;
const MIN_WINS = 1;
const MAX_WINS = 5;
const DEFAULT_WINS = 3;
const MAX_VOLLEYS = 12;

const TICK_MS = 200;
const AIM_MS = 20_000;
const FLIGHT_PAD_MS = 1_500;         // Pause nach der Animation
const FALL_ANIM_MS = 600;
const ROUND_PAUSE_MS = 3_500;
const BOT_READY_MIN_MS = 1_000;
const BOT_READY_MAX_MS = 4_000;
const LOG_SIZE = 8;

const COLORS = ["#d62828", "#1d6fd6", "#e0a100", "#2a9d48", "#8e44ad", "#e76f00"];

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round1 = value => Math.round(value * 10) / 10;

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function activePlayers(state) {
    return state.players.filter(p => !p.left);
}

// ===========================================================================
// Gelände
// ===========================================================================

/** Geländehöhe an der Stelle x. */
function groundAt(heights, x) {
    return heights[clamp(Math.floor(x / COL), 0, COLS - 1)];
}

/** Höhe, auf der ein Panzer bei x steht (höchste Spalte unter dem Rumpf). */
function restY(heights, x) {
    let max = 0;
    for (let i = Math.floor((x - TANK_HALF + 2) / COL); i <= Math.floor((x + TANK_HALF - 2) / COL); i++) {
        max = Math.max(max, heights[clamp(i, 0, COLS - 1)]);
    }
    return max;
}

/** Hügeliges Gelände aus Sinuswellen + Rauschen; unter den Startplätzen eingeebnet. */
function generateTerrain(rng, spawnXs = []) {
    const waves = [
        { amp: 55 + rng.next() * 25, freq: 1 + rng.next() * 1.5, phase: rng.next() * Math.PI * 2 },
        { amp: 25 + rng.next() * 15, freq: 3 + rng.next() * 2, phase: rng.next() * Math.PI * 2 },
        { amp: 8 + rng.next() * 6, freq: 8 + rng.next() * 5, phase: rng.next() * Math.PI * 2 }
    ];
    const base = 150 + rng.next() * 40;
    const heights = Array.from({ length: COLS }, (_, i) => {
        const u = i / COLS;
        let h = base;
        for (const w of waves) h += w.amp * Math.sin(u * Math.PI * 2 * w.freq + w.phase);
        return Math.round(clamp(h + (rng.next() - 0.5) * 4, 60, 300));
    });
    for (const x of spawnXs) {
        const level = groundAt(heights, x);
        for (let i = Math.floor((x - TANK_HALF - 6) / COL); i <= Math.floor((x + TANK_HALF + 6) / COL); i++) {
            if (i >= 0 && i < COLS) heights[i] = level;
        }
    }
    return heights;
}

/**
 * Kreisförmigen Krater in das Höhenprofil sprengen (verändert heights).
 * Material oberhalb des Kreises rutscht nach (Höhenprofil hat keine Überhänge).
 */
function carve(heights, cx, cy, r) {
    for (let i = Math.floor((cx - r) / COL); i <= Math.floor((cx + r) / COL); i++) {
        if (i < 0 || i >= COLS) continue;
        const dx = (i + 0.5) * COL - cx;
        if (Math.abs(dx) > r) continue;
        const half = Math.sqrt(r * r - dx * dx);
        const bottom = cy - half;
        const top = cy + half;
        const h = heights[i];
        if (h <= bottom) continue;
        heights[i] = Math.max(0, Math.round(h - (Math.min(h, top) - bottom)));
    }
}

// ===========================================================================
// Flugbahn
// ===========================================================================

/** Geschoss an der Rohrmündung eines Panzers erzeugen. */
function launch(heights, tank, angle, power, weapon) {
    const rad = (angle * Math.PI) / 180;
    const speed = power * POWER_SCALE;
    const baseY = restY(heights, tank.x) + TANK_HEIGHT * 0.8;
    return {
        owner: tank.id,
        weapon,
        x: tank.x + Math.cos(rad) * BARREL,
        y: baseY + Math.sin(rad) * BARREL,
        vx: Math.cos(rad) * speed,
        vy: Math.sin(rad) * speed,
        age: 0,
        dug: 0
    };
}

/** Steht ein Punkt im Rumpf eines Panzers? @returns {object|null} der Panzer */
function tankAt(heights, tanks, x, y, projectile) {
    for (const tank of tanks) {
        if (!tank.alive) continue;
        if (tank.id === projectile.owner && projectile.age < OWNER_IMMUNE_S && !projectile.fragment) continue;
        const ty = tank.y ?? restY(heights, tank.x);
        if (Math.abs(x - tank.x) <= TANK_HALF && y >= ty - 1 && y <= ty + TANK_HEIGHT) return tank;
    }
    return null;
}

/**
 * Einen Simulationsschritt für ein Geschoss.
 * @returns {null | {type: "lost"} | {type: "impact", x, y, tankId}} Ereignis oder null (fliegt weiter)
 * Beim Bohrer wird im Gelände ein Kanal gegraben (onCarve), bis WEAPONS.bohrer.dig erreicht ist.
 */
function stepProjectile(p, heights, tanks, wind, onCarve = null) {
    p.vx += wind * DT;
    p.vy -= GRAVITY * DT;
    const nx = p.x + p.vx * DT;
    const ny = p.y + p.vy * DT;
    const stepLength = Math.hypot(nx - p.x, ny - p.y);
    p.x = nx;
    p.y = ny;
    p.age += DT;

    if (p.x < 0 || p.x >= WIDTH || p.y < 0) {
        if (p.weapon === "bohrer" && p.dug > 0 && p.y < 0) return { type: "impact", x: p.x, y: 0, tankId: null };
        return { type: "lost" };
    }
    const tank = tankAt(heights, tanks, p.x, p.y, p);
    if (tank) return { type: "impact", x: p.x, y: p.y, tankId: tank.id };

    if (p.y <= groundAt(heights, p.x)) {
        if (p.weapon !== "bohrer") return { type: "impact", x: p.x, y: p.y, tankId: null };
        p.dug += stepLength;
        if (onCarve) onCarve(p.x, p.y, WEAPONS.bohrer.channel);
        if (p.dug >= WEAPONS.bohrer.dig) return { type: "impact", x: p.x, y: p.y, tankId: null };
    }
    if (p.age > MAX_FLIGHT_S) return { type: "lost" };
    return null;
}

/**
 * Einzelnen Schuss simulieren (ohne das Gelände zu verändern) – für Bots und Tests.
 * @returns {{impact: null | {x, y, tankId}, time: number, path: number[][]}}
 */
function simulateShot(heights, tanks, tank, angle, power, weapon, wind, { withPath = false } = {}) {
    const p = launch(heights, tank, angle, power, weapon);
    const path = [];
    let steps = 0;
    while (true) {
        const event = stepProjectile(p, heights, tanks, wind);
        steps++;
        if (withPath && steps % SAMPLE_EVERY === 0) path.push([round1(p.x), round1(p.y)]);
        if (event) {
            return { impact: event.type === "impact" ? { x: event.x, y: event.y, tankId: event.tankId } : null, time: steps * DT, path };
        }
    }
}

/** Schaden einer Explosion an einem Panzer (linear abnehmend zum Rand). */
function blastDamage(tank, heights, x, y, radius, damage) {
    const ty = tank.y ?? restY(heights, tank.x);
    const d = Math.hypot(tank.x - x, ty + TANK_HEIGHT / 2 - y);
    const reach = radius + TANK_HALF;
    if (d >= reach) return 0;
    return Math.round(damage * (1 - d / reach));
}

/**
 * Eine ganze Salve gleichzeitig abwickeln. Alle Geschosse fliegen im selben
 * Zeittakt; Einschläge verändern das Gelände sofort (spätere Geschosse sehen die
 * neuen Krater). Schaden wird gesammelt und am Ende abgezogen – wer sich
 * gegenseitig trifft, scheidet also gemeinsam aus.
 *
 * @param {number[]} heights   wird verändert
 * @param {Array} tanks        {id, x, alive, …} – y wird während der Salve festgehalten
 * @param {Array} shots        {owner, angle, power, weapon}
 * @returns {{shots: Array, carves: Array, explosions: Array, damage: Object<string, number>, hits: Array, durationS: number}}
 */
function resolveVolley(heights, tanks, shots, wind) {
    for (const tank of tanks) tank.y = restY(heights, tank.x);
    const flights = [];
    const carves = [];
    const explosions = [];
    const hits = [];
    const damage = {};
    let active = [];

    for (const shot of shots) {
        const tank = tanks.find(t => t.id === shot.owner);
        const p = launch(heights, tank, shot.angle, shot.power, shot.weapon);
        const record = { owner: shot.owner, weapon: shot.weapon, t0: 0, path: [[round1(p.x), round1(p.y)]], fragment: false };
        flights.push(record);
        active.push({ p, record });
    }

    let t = 0;
    let step = 0;
    while (active.length > 0 && t < MAX_FLIGHT_S + 4) {
        step++;
        t = Math.round(step * DT * 100) / 100;
        const next = [];
        for (const entry of active) {
            const { p, record } = entry;
            const event = stepProjectile(p, heights, tanks, wind, (x, y, r) => {
                carve(heights, x, y, r);
                carves.push({ t, x: round1(x), y: round1(y), r });
            });
            if (step % SAMPLE_EVERY === 0 || event) record.path.push([round1(p.x), round1(p.y)]);
            if (!event) {
                next.push(entry);
                continue;
            }
            record.t1 = t;
            if (event.type === "lost") continue;

            const spec = WEAPONS[p.weapon];
            const radius = p.fragment ? spec.fragmentRadius : spec.radius;
            const power = p.fragment ? spec.fragmentDamage : spec.damage;
            carve(heights, event.x, event.y, radius);
            carves.push({ t, x: round1(event.x), y: round1(event.y), r: radius });
            explosions.push({ t, x: round1(event.x), y: round1(event.y), r: radius, owner: p.owner });
            for (const tank of tanks) {
                if (!tank.alive) continue;
                const amount = blastDamage(tank, heights, event.x, event.y, radius, power);
                if (amount <= 0) continue;
                damage[tank.id] = (damage[tank.id] ?? 0) + amount;
                hits.push({ t, target: tank.id, owner: p.owner, amount });
            }
            if (p.weapon === "splitter" && !p.fragment) {
                for (let k = 0; k < spec.fragments; k++) {
                    const angle = ((30 + (120 * k) / (spec.fragments - 1)) * Math.PI) / 180;
                    const fragment = {
                        owner: p.owner, weapon: "splitter", fragment: true,
                        x: event.x, y: Math.max(event.y, groundAt(heights, event.x)) + 3,
                        vx: Math.cos(angle) * spec.fragmentSpeed, vy: Math.sin(angle) * spec.fragmentSpeed,
                        age: 0, dug: 0
                    };
                    const fragmentRecord = { owner: p.owner, weapon: "splitter", t0: t, path: [[round1(fragment.x), round1(fragment.y)]], fragment: true };
                    flights.push(fragmentRecord);
                    next.push({ p: fragment, record: fragmentRecord });
                }
            }
        }
        active = next;
    }
    return { shots: flights, carves, explosions, damage, hits, durationS: t };
}

// ===========================================================================
// Ablauf
// ===========================================================================

function spawnPositions(rng, count) {
    const margin = 50;
    const span = WIDTH - margin * 2;
    const xs = Array.from({ length: count }, (_, i) => Math.round(margin + (span * (i + 0.5)) / count + (rng.next() - 0.5) * 30));
    for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
}

function startRound(state, now) {
    const rng = createRng(state.rng);
    const players = activePlayers(state);
    const xs = spawnPositions(rng, players.length);
    state.heights = generateTerrain(rng, xs);
    players.forEach((player, i) => {
        const x = xs[i];
        Object.assign(player, {
            x, y: restY(state.heights, x), hp: START_HP, alive: true,
            angle: x < WIDTH / 2 ? 50 : 130, power: 60, weapon: "granate",
            ammo: { ...START_AMMO }, fuel: FUEL, ready: false
        });
    });
    state.rng = rng.state;
    state.round += 1;
    state.volley = 0;
    state.roundWinner = null;
    state.flight = null;
    addLog(state, `Runde ${state.round} – Rohre ausrichten!`);
    startAiming(state, now);
}

function startAiming(state, now) {
    const rng = createRng(state.rng);
    state.volley += 1;
    state.wind = Math.round((rng.next() * 2 - 1) * WIND_MAX);
    state.phase = "aiming";
    state.phaseEndsAt = now + AIM_MS;
    for (const player of state.players) {
        if (!player.alive) continue;
        player.ready = false;
        player.fuel = FUEL;
        if (player.ammo[player.weapon] === 0) player.weapon = "granate";
    }
    // Bots planen nicht sofort, sondern einer pro Tick (siehe tick) – so blockiert
    // die Zielsuche den Server nie lange am Stück.
    for (const bot of state.players.filter(p => p.bot && p.alive)) {
        bot.planned = false;
        bot.readyAt = now + BOT_READY_MIN_MS + Math.floor(rng.next() * (BOT_READY_MAX_MS - BOT_READY_MIN_MS));
    }
    state.rng = rng.state;
}

/** Zielphase im Takt: höchstens einen Bot planen lassen, fällige Bots bereit melden. @returns {boolean} geändert? */
function aimingTick(state, now) {
    let changed = false;
    const unplanned = state.players.find(p => p.bot && p.alive && !p.planned);
    if (unplanned) {
        const rng = createRng(state.rng);
        botPlan(state, unplanned, rng);
        unplanned.planned = true;
        state.rng = rng.state;
        changed = true;
    }
    for (const bot of state.players) {
        if (bot.bot && bot.alive && bot.planned && !bot.ready && now >= bot.readyAt) {
            bot.ready = true;
            changed = true;
        }
    }
    return changed;
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
        x: 0, y: 0, hp: START_HP, alive: false, left: false,
        angle: 45, power: 60, weapon: "granate", ammo: { ...START_AMMO }, fuel: FUEL, ready: false,
        wins: 0, damageDealt: 0,
        ...(p.bot ? { traits: rollTraits(rng), readyAt: 0, planned: false } : {})
    }));
    state.rng = rng.state;
    state.matchNumber += 1;
    state.round = 0;
    state.result = null;
    state.log = [];
    startRound(state, now);
}

/** Alle sind bereit (Menschen per Knopf, Bots nach ihrer Bedenkzeit)? */
function everyoneReady(state) {
    return state.players.every(p => !p.alive || p.ready);
}

/**
 * Panzer setzen sich auf das (veränderte) Gelände. Wer tiefer als FALL_SAFE
 * fällt, bekommt Fallschaden. @returns {Array<{id, fromY, toY, damage}>}
 */
function settleTanks(heights, tanks) {
    const falls = [];
    for (const tank of tanks) {
        const newY = restY(heights, tank.x);
        const drop = tank.y - newY;
        let damage = 0;
        if (drop > FALL_SAFE) {
            damage = Math.round((drop - FALL_SAFE) / 2);
            tank.hp = Math.max(0, tank.hp - damage);
        }
        if (drop > 0) falls.push({ id: tank.id, fromY: tank.y, toY: newY, damage });
        tank.y = newY;
    }
    return falls;
}

/** Salve abfeuern und die Flugphase starten. */
function fireVolley(state, now) {
    const shooters = state.players.filter(p => p.alive);
    const shots = shooters.map(p => {
        const weapon = p.weapon !== "granate" && !(p.ammo[p.weapon] > 0) ? "granate" : p.weapon;
        if (weapon !== "granate") p.ammo[weapon] -= 1;
        return { owner: p.id, angle: p.angle, power: p.power, weapon };
    });
    const heightsBefore = [...state.heights];
    const tanks = shooters.map(p => ({ id: p.id, x: p.x, alive: true }));
    const result = resolveVolley(state.heights, tanks, shots, state.wind);

    // Schaden abziehen, Treffer zählen
    for (const hit of result.hits) {
        const shooter = state.players.find(p => p.id === hit.owner);
        if (shooter && hit.owner !== hit.target) shooter.damageDealt += hit.amount;
    }
    for (const player of shooters) player.hp = Math.max(0, player.hp - (result.damage[player.id] ?? 0));

    const falls = settleTanks(state.heights, shooters);
    const out = shooters.filter(p => p.hp <= 0);
    for (const player of out) {
        player.alive = false;
        player.ready = false;
    }
    if (out.length === 1) addLog(state, `${out[0].name} ist zerstört.`);
    else if (out.length > 1) addLog(state, `${out.map(p => p.name).join(" und ")} sind zerstört.`);

    const durationMs = Math.round(result.durationS * 1000) + (falls.length > 0 ? FALL_ANIM_MS : 0);
    state.flight = {
        volley: state.volley,
        heightsBefore,
        shots: result.shots,
        carves: result.carves,
        explosions: result.explosions,
        hits: result.hits.filter(h => h.amount > 0),
        falls,
        durationMs
    };
    state.phase = "flight";
    state.phaseEndsAt = now + durationMs + FLIGHT_PAD_MS;
}

/** Nach der Flugphase: Runde vorbei oder nächste Salve. */
function afterFlight(state, now) {
    const alive = state.players.filter(p => p.alive);
    if (alive.length <= 1) {
        endRound(state, alive[0] ?? null, now);
        return;
    }
    if (state.volley >= MAX_VOLLEYS) {
        const best = Math.max(...alive.map(p => p.hp));
        const leaders = alive.filter(p => p.hp === best);
        addLog(state, `Letzte Salve – ${leaders.length === 1 ? "die meisten Trefferpunkte entscheiden" : "Gleichstand"}.`);
        endRound(state, leaders.length === 1 ? leaders[0] : null, now);
        return;
    }
    startAiming(state, now);
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
        .sort((a, b) => (b.wins - a.wins) || (b.damageDealt - a.damageDealt))
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

function rollTraits(rng) {
    return {
        accuracy: 0.35 + rng.next() * 0.6,   // 1 = perfekt
        aggression: 0.3 + rng.next() * 0.7,  // bevorzugt angeschlagene Gegner, nutzt Splitter
        mobility: rng.next()                 // fährt öfter
    };
}

/** Bester Schuss für eine Waffe per Rastersuche. @returns {{angle, power, miss}} */
function searchShot(state, bot, target, weapon, tanks) {
    const towardsRight = target.x >= bot.x;
    const ty = restY(state.heights, target.x) + TANK_HEIGHT / 2;
    const score = (angle, power) => {
        const { impact } = simulateShot(state.heights, tanks, bot, angle, power, weapon, state.wind);
        if (!impact) return Infinity;
        let miss = impact.tankId === target.id ? 0 : Math.hypot(impact.x - target.x, impact.y - ty);
        if (Math.hypot(impact.x - bot.x, impact.y - bot.y) < WEAPONS[weapon].radius + 15) miss += 300; // nicht selbst treffen
        return miss;
    };
    let best = { angle: 90, power: 50, miss: Infinity };
    const [from, to] = towardsRight ? [15, 87] : [93, 165];
    for (let angle = from; angle <= to; angle += 3) {
        for (let power = 20; power <= 100; power += 4) {
            const miss = score(angle, power);
            if (miss < best.miss) best = { angle, power, miss };
        }
    }
    const coarse = best;
    for (let angle = coarse.angle - 2; angle <= coarse.angle + 2; angle++) {
        for (let power = coarse.power - 3; power <= coarse.power + 3; power++) {
            if (power < 10 || power > 100) continue;
            const miss = score(angle, power);
            if (miss < best.miss) best = { angle, power, miss };
        }
    }
    return best;
}

/** Ziel, Waffe, Fahrt und Zielwerte eines Bots für diese Salve festlegen. */
function botPlan(state, bot, rng) {
    const { accuracy, aggression, mobility } = bot.traits;
    const enemies = state.players.filter(p => p.alive && p !== bot);
    if (enemies.length === 0) return;

    // Gelegentlich ein Stück fahren (bevorzugt aus Senken heraus)
    if (rng.next() < mobility * 0.4) {
        const dir = rng.next() < 0.5 ? -1 : 1;
        const steps = 1 + Math.floor(rng.next() * 4);
        for (let i = 0; i < steps; i++) if (!driveTank(state, bot, dir)) break;
    }

    const target = enemies
        .map(e => ({ e, score: (START_HP - e.hp) * aggression * 0.6 - Math.abs(e.x - bot.x) / 25 + rng.next() * 20 }))
        .sort((a, b) => b.score - a.score)[0].e;
    const tanks = state.players.filter(p => p.alive).map(p => ({ id: p.id, x: p.x, y: p.y, alive: true }));

    let weapon = "granate";
    let shot = searchShot(state, bot, target, "granate", tanks);
    if (shot.miss > 35 && bot.ammo.bohrer > 0) {
        const drill = searchShot(state, bot, target, "bohrer", tanks);
        if (drill.miss < shot.miss) {
            shot = drill;
            weapon = "bohrer";
        }
    } else if (shot.miss <= 35 && bot.ammo.splitter > 0) {
        const crowd = enemies.some(e => e !== target && Math.abs(e.x - target.x) < 80);
        if (crowd || rng.next() < aggression * 0.3) weapon = "splitter";
    }

    const error = 1 - accuracy;
    bot.weapon = weapon;
    bot.angle = clamp(Math.round(shot.angle + (rng.next() * 2 - 1) * 6 * error), 0, 180);
    bot.power = clamp(Math.round(shot.power * (1 + (rng.next() * 2 - 1) * 0.08 * error)), 10, 100);
}

// ===========================================================================
// Aktionen
// ===========================================================================

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) {
        throw new Error("Das darf nur der Host der Lobby.");
    }
}

/** Panzer um einen Schritt fahren. @returns {boolean} gefahren? */
function driveTank(state, tank, dir) {
    if (tank.fuel <= 0) return false;
    const x = clamp(tank.x + dir * MOVE_STEP, TANK_HALF, WIDTH - TANK_HALF);
    if (x === tank.x) return false;
    const y = restY(state.heights, x);
    if (y - tank.y > MAX_CLIMB) return false;
    tank.x = x;
    tank.y = y;
    tank.fuel -= 1;
    return true;
}

/** Zielwerte aus einer Aktion übernehmen (nur gültige Felder). */
function applyAim(me, action) {
    if (action.angle !== undefined) {
        const angle = Number(action.angle);
        if (!Number.isFinite(angle)) throw new Error("Ungültiger Winkel.");
        me.angle = clamp(Math.round(angle), 0, 180);
    }
    if (action.power !== undefined) {
        const power = Number(action.power);
        if (!Number.isFinite(power)) throw new Error("Ungültige Kraft.");
        me.power = clamp(Math.round(power), 10, 100);
    }
    if (action.weapon !== undefined) {
        if (!Object.hasOwn(WEAPONS, action.weapon)) throw new Error("Unbekannte Waffe.");
        if (action.weapon !== "granate" && !(me.ammo[action.weapon] > 0)) throw new Error("Keine Munition mehr für diese Waffe.");
        me.weapon = action.weapon;
    }
}

function aimingPlayer(state, player) {
    if (state.phase !== "aiming") return null;
    const me = state.players.find(p => p.id === player.id);
    return me && me.alive ? me : null;
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

    aim(state, action, player) {
        const me = aimingPlayer(state, player);
        if (!me || me.ready) return false;
        applyAim(me, action);
    },

    move(state, action, player) {
        const dir = Number(action.dir);
        if (dir !== -1 && dir !== 1) throw new Error("Unbekannte Richtung.");
        const me = aimingPlayer(state, player);
        if (!me || me.ready) return false;
        return driveTank(state, me, dir) ? undefined : false;
    },

    ready(state, action, player, context) {
        const me = aimingPlayer(state, player);
        if (!me) return false;
        if (!me.ready) applyAim(me, action);
        me.ready = action.ready !== false;
        if (everyoneReady(state)) fireVolley(state, context?.now ?? Date.now());
    },

    "new-match"(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "finished") throw new Error("Die Partie läuft noch.");
        state.phase = "setup";
        state.players = [];
        state.heights = null;
        state.flight = null;
        state.result = null;
        state.round = 0;
        state.volley = 0;
        state.roundWinner = null;
        state.phaseEndsAt = null;
        state.log = [];
    }
};

// ===========================================================================
// Sicht eines Spielers (viewFor)
// ===========================================================================

/**
 * Restzeiten statt Zeitstempel, ohne Zufallszustand und Bot-Interna.
 * Während der Zielphase sind Winkel, Kraft und Waffe der anderen verborgen.
 */
function viewFor(state, userId) {
    const remaining = state.phaseEndsAt ? Math.max(0, state.phaseEndsAt - Date.now()) : null;
    const hideAim = state.phase === "aiming";
    return {
        ...state,
        rng: undefined,
        phaseEndsAt: undefined,
        aimingMs: state.phase === "aiming" ? remaining : null,
        flightMs: state.phase === "flight" ? remaining : null,
        roundOverMs: state.phase === "roundOver" ? remaining : null,
        players: state.players.map(({ traits, readyAt, planned, ...player }) => (hideAim && player.id !== userId
            ? { ...player, angle: null, power: null, weapon: null }
            : player))
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "artillerie",
        name: "Artillerie-Duell",
        description: "Rundenbasiertes Geschützduell: Alle zielen gleichzeitig mit Winkel und Kraft, dann fliegen die Granaten. Wind, zerstörbares Gelände und drei Waffen – wer zuletzt noch steht, gewinnt.",
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
            world: { width: WIDTH, height: HEIGHT, col: COL, tankHalf: TANK_HALF, tankHeight: TANK_HEIGHT, barrel: BARREL, windMax: WIND_MAX, fuel: FUEL, startHp: START_HP },
            weapons: Object.fromEntries(Object.entries(WEAPONS).map(([id, w]) => [id, { name: w.name, radius: w.radius }])),
            maxVolleys: MAX_VOLLEYS,
            aimTotalMs: AIM_MS,
            flightPadMs: FLIGHT_PAD_MS,
            players: [],
            heights: null,
            wind: 0,
            volley: 0,
            flight: null,
            round: 0,
            roundWinner: null,
            phaseEndsAt: null,
            result: null,
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
        if (state.phase === "aiming") {
            const pending = state.players.some(p => p.bot && p.alive && (!p.planned || (!p.ready && now >= p.readyAt)));
            if (!pending && now < state.phaseEndsAt) return undefined;
            const next = structuredClone(state);
            aimingTick(next, now);
            if (everyoneReady(next) || now >= next.phaseEndsAt) fireVolley(next, now);
            return next;
        }
        if (state.phase === "flight") {
            if (now < state.phaseEndsAt) return undefined;
            const next = structuredClone(state);
            afterFlight(next, now);
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
        participant.alive = false;
        participant.ready = false;
        participant.hp = 0;
        addLog(next, `${participant.name} hat das Spiel verlassen.`);

        const remaining = activePlayers(next);
        if (remaining.length < 2 || !remaining.some(p => !p.bot)) {
            finishMatch(next, null);
            return next;
        }
        const alive = next.players.filter(p => p.alive);
        if (alive.length <= 1 && next.phase === "aiming") {
            endRound(next, alive[0] ?? null, Date.now());
        } else if (next.phase === "aiming" && everyoneReady(next)) {
            fireVolley(next, Date.now());
        }
        return next;
    },

    /** Nur für Tests. */
    _internals: {
        WIDTH, HEIGHT, COL, COLS, GRAVITY, POWER_SCALE, WIND_MAX, TANK_HALF, TANK_HEIGHT, START_HP, FUEL, MOVE_STEP,
        MAX_CLIMB, FALL_SAFE, WEAPONS, START_AMMO, MAX_VOLLEYS, AIM_MS, FLIGHT_PAD_MS, ROUND_PAUSE_MS, BOT_READY_MAX_MS,
        createRng, groundAt, restY, generateTerrain, carve, launch, simulateShot, resolveVolley, blastDamage, settleTanks, searchShot, botPlan
    }
};

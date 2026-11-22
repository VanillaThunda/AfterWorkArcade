"use strict";

/**
 * Feierabend-Fäuste – Server-Teil.
 *
 * Koop-Prügelspiel im Seitenscroller (eigenes Spiel im Beat-'em-up-Genre):
 * 1–4 Spieler (freie Plätze auf Wunsch mit Bot-Mitstreitern) prügeln sich
 * gemeinsam durch drei Abschnitte mit Gegnerwellen und besiegen am Ende den
 * Boss. Wer insgesamt den meisten Schaden austeilt, ist „Mitarbeiter des Abends“.
 *
 * Phasen:  setup (Figurenwahl) → playing (Abschnitte, Wellen, Boss) → finished
 * Takt:    tick() alle 50 ms; Eingaben (move/attack/jump/special) wirken im nächsten Tick.
 *
 * Aufteilung:  level.js (Daten) · combat.js (Bewegung, Treffer) · ai.js (Gegner, Boss, Bots)
 */

const { pickBotNames } = require("../../server/bot-names");
const { VIEW_W, DEPTH, FIGURES, FIGURE_IDS, ENEMIES, DIFFICULTIES, SECTIONS } = require("./level");
const combat = require("./combat");
const { TICK_MS, JUMP_SPEED, COMBO_WINDOW, SPECIAL_COST, SPECIAL_TICKS, SPECIAL_RADIUS, clamp, setState, canAct, isTargetable, physics, walk, attackBox, applyHit, strike } = combat;
const ai = require("./ai");

// ===========================================================================
// Einstellungen
// ===========================================================================

const MAX_PLAYERS = 4;
const MAX_ALLIES = 3;
const DEFAULT_ALLIES = 1;
const DEFAULT_DIFFICULTY = "mittel";
const DEFAULT_ALLY_LEVEL = "mittel";
const INPUT_BUFFER = 6;            // so lange (Ticks) bleibt ein Tastendruck gemerkt
const INTRO_TICKS = 40;            // „Los geht's!“
const TRANSITION_TICKS = 30;       // Überblendung zwischen Abschnitten
const REVIVE_TICKS = 30;           // 1,5 s neben einem Liegenden stehen
const SELF_REVIVE_TICKS = 200;     // 10 s
const REVIVE_RANGE = { x: 30, z: 18 };
const SECTION_EXIT = 60;           // so weit vor dem Ende eines Abschnitts geht es weiter
const FOOD_HEAL = 30;
const CRATE_HITS = 2;
const DYING_TICKS = 16;
const FX_TICKS = 24;
const LOG_SIZE = 8;

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

function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
}

function fx(state, kind, at, value = null) {
    state.fx.push({ id: state.nextId++, t: state.tickNo, kind, x: Math.round(at.x), z: Math.round(at.z), h: Math.round(at.h ?? 0), value });
}

/** Gemeinsame Startwerte eines Akteurs. */
function actorBase(id, x, z, hp) {
    return {
        id, x, z, h: 0, vh: 0, kx: 0, facing: 1, hp, maxHp: hp,
        state: "idle", lock: 0, invuln: 0, attack: null, anim: "idle", animT: 0, flash: 0
    };
}

const fieldPlayers = state => state.players.filter(p => !p.left);
const section = state => SECTIONS[state.section];

// ===========================================================================
// Ablauf
// ===========================================================================

/** Freie Figuren der Reihe nach vergeben (Wunsch der Menschen hat Vorrang). */
function assignFigures(participants, picks) {
    const taken = new Set();
    const result = new Map();
    for (const p of participants) {
        const wish = picks[p.id];
        if (!p.bot && wish && !taken.has(wish)) {
            result.set(p.id, wish);
            taken.add(wish);
        }
    }
    for (const p of participants) {
        if (result.has(p.id)) continue;
        const free = FIGURE_IDS.find(id => !taken.has(id));
        result.set(p.id, free);
        taken.add(free);
    }
    return result;
}

function startMatch(state) {
    const humans = state.members.slice(0, MAX_PLAYERS);
    if (humans.length === 0) throw new Error("Niemand da, der spielen könnte.");
    const allyCount = Math.min(state.settings.allies, MAX_PLAYERS - humans.length);
    const botNames = pickBotNames(allyCount, humans.map(h => h.name));
    const participants = [
        ...humans.map(m => ({ id: m.id, name: m.name, bot: false })),
        ...botNames.map((name, i) => ({ id: `bot-${i + 1}`, name, bot: true }))
    ];
    const figures = assignFigures(participants, state.picks);
    state.players = participants.map(p => {
        const figure = FIGURES[figures.get(p.id)];
        return {
            ...actorBase(p.id, 0, 0, figure.hp),
            name: p.name, bot: p.bot, left: false,
            figure: figures.get(p.id), color: figure.color,
            input: { dx: 0, dz: 0, attack: 0, jump: 0, special: 0 },
            combo: { step: 0, window: 0 },
            ko: null,
            stats: { damage: 0, hits: 0, kos: 0, bossDamage: 0, downs: 0 }
        };
    });
    state.matchNumber += 1;
    state.phase = "playing";
    state.result = null;
    state.log = [];
    state.fx = [];
    state.tickNo = 0;
    state.intro = INTRO_TICKS;
    state.bossSummons = 0;
    loadSection(state, 0);
    addLog(state, "Schichtbeginn – los geht's!");
}

/** Abschnitt laden: Spieler links aufstellen, Kisten setzen, Kamera zurück. */
function loadSection(state, index) {
    const data = SECTIONS[index];
    state.section = index;
    state.sectionId = data.id;
    state.sectionName = data.name;
    state.sectionWidth = data.width;
    state.waveIndex = 0;
    state.camX = 0;
    state.lock = false;
    state.go = false;
    state.enemies = [];
    state.projectiles = [];
    state.pickups = [];
    state.crates = data.crates.map(c => ({ id: `c${state.nextId++}`, x: c.x, z: c.z, h: 0, hp: CRATE_HITS, item: c.item }));
    fieldPlayers(state).forEach((p, i) => {
        Object.assign(p, { x: 50 + i * 26, z: 25 + i * 20, h: 0, vh: 0, kx: 0, facing: 1, attack: null });
        if (p.state !== "ko") setState(p, "idle");
    });
    if (data.boss) {
        state.lock = true;
        spawnEnemy(state, "boss", VIEW_W - 90, 55);
        addLog(state, "Der Schichtleiter wartet schon …");
    } else {
        addLog(state, `${data.name}`);
    }
}

/**
 * Wie stark Gegner mit der Gruppengröße (1–4 Teilnehmer) wachsen – per Simulation
 * abgestimmt: Größere Gruppen sind überproportional stark, weil immer jemand
 * aufhelfen kann.
 */
const GROUP_SCALE = Object.freeze([
    null,
    { wave: 0.45, boss: 0.38, bossDamage: 0.55, tickets: 0.5, helpers: 1 },
    { wave: 0.7, boss: 0.68, bossDamage: 0.7, tickets: 0.67, helpers: 1 },
    { wave: 1.15, boss: 1.2, bossDamage: 0.85, tickets: 0.9, helpers: 2 },
    { wave: 1.75, boss: 2.1, bossDamage: 1.15, tickets: 1.33, helpers: 2 }
]);
function groupScale(count) {
    return GROUP_SCALE[Math.max(1, Math.min(4, count))];
}

function participantCount(state) {
    return fieldPlayers(state).length;
}

function spawnEnemy(state, type, x, z) {
    const spec = ENEMIES[type];
    const difficulty = DIFFICULTIES[state.settings.difficulty];
    let hp = Math.round(spec.hp * difficulty.hp);
    const scale = groupScale(participantCount(state));
    if (type === "boss") hp = Math.round(hp * scale.boss);
    const enemy = {
        ...actorBase(`e${state.nextId++}`, x, z, hp),
        type, armored: spec.armored, color: spec.color, damageScale: type === "boss" ? scale.bossDamage : 1,
        ai: { ticket: false, cooldown: 10 + (state.nextId % 20), specialCd: 60, slot: state.enemies.length % 4, zOffset: (state.nextId % 3 - 1) * 25 },
        dyingT: 0, entered: false, superArmor: false, juggle: 0, juggleT: 0
    };
    enemy.facing = x > state.camX + VIEW_W / 2 ? -1 : 1;
    state.enemies.push(enemy);
    return enemy;
}

/** Welle erscheinen lassen; Anzahl je Schwierigkeit und Gruppengröße. */
function spawnWave(state, wave) {
    const rng = createRng(state.rng);
    const difficulty = DIFFICULTIES[state.settings.difficulty];
    const factor = difficulty.wave * groupScale(participantCount(state)).wave;
    const count = Math.max(1, Math.round(wave.enemies.length * factor));
    for (let i = 0; i < count; i++) {
        const type = wave.enemies[i % wave.enemies.length];
        const fromLeft = i % 3 === 2;
        const x = fromLeft ? state.camX - 30 - i * 12 : state.camX + VIEW_W + 30 + i * 22;
        spawnEnemy(state, type, x, Math.round(10 + rng.next() * (DEPTH - 20)));
    }
    state.rng = rng.state;
}

function finishMatch(state, outcome) {
    const players = state.players;
    const placements = [...players]
        .sort((a, b) => (b.stats.damage - a.stats.damage) || (b.stats.kos - a.stats.kos) || (a.stats.downs - b.stats.downs))
        .map(p => p.id);
    state.phase = "finished";
    state.result = { outcome, winnerId: placements[0] ?? null, placements };
    for (const p of players) p.input = { dx: 0, dz: 0, attack: 0, jump: 0, special: 0 };
    addLog(state, outcome === "victory" ? "Feierabend! Der Schichtleiter ist besiegt." : outcome === "defeat" ? "Schicht verloren – alle liegen am Boden." : "Spiel beendet.");
}

// ===========================================================================
// Spieler
// ===========================================================================

function startPlayerAttack(p, kind, step = 1) {
    p.attack = { kind, step, t: 0, hit: [] };
    p.state = "attack";
    p.anim = kind === "punch" ? `punch${step}` : kind;
    p.animT = 0;
}

/** Spieler trifft Gegner oder Kiste. */
function playerHits(state, p, target, damage, finisher) {
    const figure = FIGURES[p.figure];
    if (target.item !== undefined) {               // Kiste
        target.hp -= 1;
        fx(state, "crate", target);
        if (target.hp <= 0) {
            state.crates = state.crates.filter(c => c !== target);
            if (target.item) state.pickups.push({ id: `p${state.nextId++}`, x: target.x, z: target.z, kind: target.item });
        }
        return;
    }
    const dealt = applyHit(target, damage, { facing: p.facing, finisher, knock: figure.knock });
    p.stats.damage += dealt;
    p.stats.hits += 1;
    if (target.type === "boss") p.stats.bossDamage += dealt;
    fx(state, "hit", { x: target.x, z: target.z, h: target.h + 30 }, dealt);
    if (target.hp <= 0 && target.state !== "dying") {
        target.attack = null;
        target.ai.ticket = false;
        setState(target, "dying");
        p.stats.kos += 1;
        if (target.type === "boss") addLog(state, `${p.name} streckt den Schichtleiter nieder!`);
    }
}

function runPlayerAttack(state, p, figure) {
    const attack = p.attack;
    attack.t += 1;
    const targets = [...state.enemies.filter(isTargetable), ...state.crates];
    if (attack.kind === "punch") {
        const { startup, active, recovery } = figure.timing;
        if (attack.t > startup && attack.t <= startup + active) {
            strike(p, attackBox(p, figure.reach), targets, target => playerHits(state, p, target, figure.damage[attack.step - 1], attack.step === 3));
        }
        if (attack.t >= startup + active + recovery) {
            p.combo = { step: attack.step, window: attack.step < 3 ? COMBO_WINDOW : 0 };
            p.attack = null;
            setState(p, "idle");
            // Schon wieder gedrückt? Dann geht die Kombo ohne Pause weiter.
            if (p.input.attack > 0 && attack.step < 3) {
                p.input.attack = 0;
                startPlayerAttack(p, "punch", attack.step + 1);
            }
        }
    } else if (attack.kind === "jumpkick") {
        if (attack.t <= 8) {
            strike(p, attackBox(p, figure.reach * 0.9, { zTol: 16, hMax: 60 }), targets,
                target => playerHits(state, p, target, Math.round(figure.damage[2] * 0.9), true));
        }
    } else if (attack.kind === "special") {
        if (attack.t >= 2 && attack.t <= 5) {
            strike(p, attackBox(p, SPECIAL_RADIUS, { around: true, zTol: 22 }), targets,
                target => playerHits(state, p, target, Math.round(figure.damage[2] * 0.8) + 2, true));
        }
        if (attack.t >= SPECIAL_TICKS) {
            p.attack = null;
            setState(p, "idle");
        }
    }
}

function controlPlayer(state, p) {
    const figure = FIGURES[p.figure];
    const input = p.input;
    if (p.combo.window > 0) p.combo.window -= 1;

    if (p.state === "attack") {
        if (p.attack.kind === "jumpkick") airControl(p, input, figure);
        runPlayerAttack(state, p, figure);
    } else if (p.state === "jump") {
        airControl(p, input, figure);
        if (input.attack > 0) {
            input.attack = 0;
            startPlayerAttack(p, "jumpkick");
        }
    } else if (canAct(p)) {
        const cost = Math.ceil(p.maxHp * SPECIAL_COST);
        if (input.special > 0 && p.hp > cost) {
            input.special = 0;
            p.hp -= cost;
            p.invuln = SPECIAL_TICKS + 2;
            startPlayerAttack(p, "special");
        } else if (input.jump > 0) {
            input.jump = 0;
            setState(p, "jump");
            p.vh = JUMP_SPEED;
            p.h = 0.01;
        } else if (input.attack > 0) {
            input.attack = 0;
            const step = p.combo.window > 0 ? Math.min(3, p.combo.step + 1) : 1;
            startPlayerAttack(p, "punch", step);
        } else {
            walk(p, input.dx, input.dz, figure.speed);
        }
    }
    for (const key of ["attack", "jump", "special"]) if (input[key] > 0) input[key] -= 1;
}

function airControl(p, input, figure) {
    if (input.dx !== 0) p.facing = input.dx > 0 ? 1 : -1;
    p.x += input.dx * figure.speed * 0.8 * 0.05;
    p.z += input.dz * figure.speed * 0.4 * 0.05;
}

/** Gegner oder Flasche trifft einen Spieler. */
function hitPlayer(state, enemy, target, damage, opts) {
    if (target.invuln > 0) return;
    applyHit(target, damage, opts);
    fx(state, "hurt", { x: target.x, z: target.z, h: target.h + 30 }, damage);
    if (target.hp <= 0) {
        target.attack = null;
        setState(target, "ko");
        target.ko = { t: 0, revive: 0 };
        target.stats.downs += 1;
        addLog(state, `${target.name} liegt am Boden!`);
    }
}

/** Liegende Spieler: aufhelfen durch Mitspieler oder nach Ablauf selbst aufstehen. */
function handleKo(state, p) {
    p.ko.t += 1;
    p.animT += 1;
    const helper = fieldPlayers(state).some(o => o !== p && o.state !== "ko"
        && Math.abs(o.x - p.x) <= REVIVE_RANGE.x && Math.abs(o.z - p.z) <= REVIVE_RANGE.z);
    p.ko.revive = helper ? p.ko.revive + 1 : Math.max(0, p.ko.revive - 1);
    if (p.ko.revive >= REVIVE_TICKS) standUp(state, p, 0.4, "wieder auf den Beinen – danke!");
    else if (p.ko.t >= SELF_REVIVE_TICKS) standUp(state, p, 0.5, "rappelt sich wieder auf.");
}

function standUp(state, p, share, text) {
    p.hp = Math.round(p.maxHp * share);
    p.ko = null;
    setState(p, "getup", combat.GETUP_TICKS);
    p.invuln = 30;
    fx(state, "revive", { x: p.x, z: p.z, h: 40 });
    addLog(state, `${p.name} ist ${text}`);
}

// ===========================================================================
// Spiel-Takt
// ===========================================================================

function updateCamera(state) {
    const players = fieldPlayers(state);
    const data = section(state);
    if (!state.lock && players.length > 0) {
        const lead = Math.max(...players.filter(p => p.state !== "ko").map(p => p.x), -Infinity);
        // Die Kamera folgt der Spitze; Nachzügler werden am linken Bildrand mitgeschoben
        const want = lead - VIEW_W * 0.55;
        state.camX = clamp(Math.max(state.camX, Math.round(want)), 0, data.width - VIEW_W);
    }
    // Nächste Welle?
    const wave = data.waves[state.waveIndex];
    if (!state.lock && wave && state.camX >= wave.at) {
        state.camX = wave.at;
        state.lock = true;
        state.go = false;
        spawnWave(state, wave);
    }
}

function step(state) {
    state.tickNo += 1;
    if (state.intro > 0) state.intro -= 1;
    if (state.shake > 0) state.shake -= 1;
    if (state.transition > 0) {
        state.transition -= 1;
        if (state.transition === TRANSITION_TICKS / 2) loadSection(state, state.section + 1);
        return;
    }

    const rng = createRng(state.rng);
    const difficulty = DIFFICULTIES[state.settings.difficulty];
    const allyLevel = ai.ALLY_LEVELS[state.settings.allyLevel];
    const players = fieldPlayers(state);

    // Bot-Mitstreiter entscheiden
    for (const bot of players.filter(p => p.bot)) {
        ai.allyTick(bot, {
            players, enemies: state.enemies, projectiles: state.projectiles, crates: state.crates, pickups: state.pickups,
            camX: state.camX, lock: state.lock, level: allyLevel, rng, figure: FIGURES[bot.figure]
        });
    }

    // Spieler
    for (const p of players) {
        if (p.flash > 0) p.flash -= 1;
        if (p.state === "ko") {
            handleKo(state, p);
            p.x = clamp(p.x, state.camX + 8, state.camX + VIEW_W - 8);
            continue;
        }
        physics(p);
        controlPlayer(state, p);
        p.x = clamp(p.x, state.camX + 8, state.camX + VIEW_W - 8);
        p.z = clamp(p.z, 0, DEPTH);
        const food = state.pickups.find(f => Math.abs(f.x - p.x) < 16 && Math.abs(f.z - p.z) < 12);
        if (food && p.hp < p.maxHp) {
            p.hp = Math.min(p.maxHp, p.hp + FOOD_HEAL);
            state.pickups = state.pickups.filter(f => f !== food);
            fx(state, "heal", { x: p.x, z: p.z, h: 40 }, FOOD_HEAL);
        }
    }

    // Gegner
    const env = {
        players, enemies: state.enemies, projectiles: state.projectiles, difficulty, camX: state.camX, rng,
        ticketScale: groupScale(players.length).tickets,
        hitPlayer: (enemy, target, damage, opts) => hitPlayer(state, enemy, target, damage, opts),
        shake: ticks => { state.shake = Math.max(state.shake, ticks); }
    };
    for (const enemy of state.enemies) {
        if (enemy.flash > 0) enemy.flash -= 1;
        if (enemy.state === "dying") {
            enemy.dyingT += 1;
            physics(enemy);
            continue;
        }
        physics(enemy);
        ai.enemyTick(enemy, env);
        // Gegner kommen von außen herein; wer einmal im Bild ist, bleibt drin
        if (!enemy.entered && enemy.x > state.camX + 12 && enemy.x < state.camX + VIEW_W - 12) enemy.entered = true;
        const margin = enemy.type === "boss" || enemy.entered ? -10 : 70;
        enemy.x = clamp(enemy.x, state.camX - margin, state.camX + VIEW_W + margin);
    }
    state.enemies = state.enemies.filter(e => !(e.state === "dying" && e.dyingT >= DYING_TICKS));
    state.projectiles = ai.projectileTick(state.projectiles, players, env.hitPlayer);

    // Boss ruft Hilfe
    const boss = state.enemies.find(e => e.type === "boss" && e.state !== "dying");
    if (boss) {
        const phase = ai.bossPhase(boss);
        const wanted = phase === 3 ? (boss.hp / boss.maxHp < 0.15 ? 2 : 1) : 0;
        while (state.bossSummons < wanted) {
            state.bossSummons += 1;
            const helpers = groupScale(participantCount(state)).helpers;
            spawnEnemy(state, "schlaeger", state.camX - 20, 20);
            if (helpers > 1) spawnEnemy(state, "schlaeger", state.camX + VIEW_W + 20, 90);
            addLog(state, "Der Schichtleiter ruft Verstärkung!");
        }
    }
    state.rng = rng.state;

    // Welle besiegt, Abschnitt geschafft, Sieg oder Niederlage?
    const data = section(state);
    if (state.lock && state.enemies.length === 0) {
        if (data.boss) {
            finishMatch(state, "victory");
            return;
        }
        state.lock = false;
        state.waveIndex += 1;
        state.go = true;
    }
    const lead = Math.max(...players.map(p => p.x));
    if (!data.boss && !state.lock && state.waveIndex >= data.waves.length && lead >= data.width - SECTION_EXIT) {
        state.transition = TRANSITION_TICKS;
        state.go = false;
    }
    if (players.length > 0 && players.every(p => p.state === "ko")) {
        finishMatch(state, "defeat");
        return;
    }
    updateCamera(state);
    state.fx = state.fx.filter(f => state.tickNo - f.t <= FX_TICKS);
}

// ===========================================================================
// Aktionen
// ===========================================================================

function requireHost(player, context) {
    if (!context || player.id !== context.hostId) {
        throw new Error("Das darf nur der Host der Lobby.");
    }
}

function me(state, player) {
    if (state.phase !== "playing") return null;
    const p = state.players.find(x => x.id === player.id);
    return p && !p.left && p.state !== "ko" ? p : null;
}

const actions = {
    settings(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Einstellungen sind nur vor dem Start möglich.");
        if (action.allies !== undefined) {
            const allies = Number(action.allies);
            if (!Number.isInteger(allies) || allies < 0 || allies > MAX_ALLIES) throw new Error(`Es sind 0 bis ${MAX_ALLIES} Bot-Mitstreiter möglich.`);
            state.settings.allies = allies;
        }
        if (action.difficulty !== undefined) {
            if (!Object.hasOwn(DIFFICULTIES, action.difficulty)) throw new Error("Unbekannte Schwierigkeit.");
            state.settings.difficulty = action.difficulty;
        }
        if (action.allyLevel !== undefined) {
            if (!Object.hasOwn(ai.ALLY_LEVELS, action.allyLevel)) throw new Error("Unbekannte Bot-Stärke.");
            state.settings.allyLevel = action.allyLevel;
        }
    },

    pick(state, action, player) {
        if (state.phase !== "setup") throw new Error("Die Figur wird vor dem Start gewählt.");
        if (!Object.hasOwn(FIGURES, action.figure)) throw new Error("Unbekannte Figur.");
        const owner = Object.entries(state.picks).find(([id, figure]) => figure === action.figure && id !== player.id);
        if (owner) throw new Error("Diese Figur ist schon vergeben.");
        if (state.picks[player.id] === action.figure) return false;
        state.picks[player.id] = action.figure;
    },

    start(state, action, player, context) {
        requireHost(player, context);
        if (state.phase !== "setup") throw new Error("Das Spiel läuft bereits.");
        startMatch(state);
    },

    move(state, action, player) {
        const dx = Number(action.dx);
        const dz = Number(action.dz);
        if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dz)) throw new Error("Ungültige Richtung.");
        const p = me(state, player);
        if (!p || (p.input.dx === dx && p.input.dz === dz)) return false;
        p.input.dx = dx;
        p.input.dz = dz;
    },

    attack(state, action, player) {
        const p = me(state, player);
        if (!p) return false;
        p.input.attack = INPUT_BUFFER;
    },

    jump(state, action, player) {
        const p = me(state, player);
        if (!p) return false;
        p.input.jump = INPUT_BUFFER;
    },

    special(state, action, player) {
        const p = me(state, player);
        if (!p) return false;
        p.input.special = INPUT_BUFFER;
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
        players: [], enemies: [], projectiles: [], crates: [], pickups: [], fx: [],
        section: 0, sectionId: SECTIONS[0].id, sectionName: SECTIONS[0].name, sectionWidth: SECTIONS[0].width,
        waveIndex: 0, camX: 0, lock: false, go: false, intro: 0, transition: 0, shake: 0, bossSummons: 0, tickNo: 0
    };
}

// ===========================================================================
// Sicht eines Spielers (viewFor)
// ===========================================================================

function viewFor(state) {
    return {
        ...state,
        rng: undefined,
        players: state.players.map(({ input, combo, ...p }) => ({ ...p, comboStep: combo?.step ?? 0 })),
        enemies: state.enemies.map(({ ai: _ai, ...e }) => e)
    };
}

// ===========================================================================
// Schnittstelle zum Lobby-System
// ===========================================================================

module.exports = {
    meta: {
        id: "feierabend-faeuste",
        name: "Feierabend-Fäuste",
        description: "Koop-Prügelei im Seitenscroller: Zu viert (oder mit Bot-Kollegen) kämpft ihr euch durch Hinterhof, Lagerhalle und Dach bis zum Schichtleiter. Wer den meisten Schaden austeilt, wird Mitarbeiter des Abends.",
        minPlayers: 1,
        maxPlayers: MAX_PLAYERS,
        tickMs: TICK_MS
    },

    createState({ players }) {
        return {
            phase: "setup",
            matchNumber: 0,
            members: players.map(({ id, name }) => ({ id, name })),
            settings: { allies: DEFAULT_ALLIES, maxAllies: MAX_ALLIES, difficulty: DEFAULT_DIFFICULTY, allyLevel: DEFAULT_ALLY_LEVEL },
            catalog: {
                figures: Object.fromEntries(FIGURE_IDS.map(id => [id, { name: FIGURES[id].name, role: FIGURES[id].role, info: FIGURES[id].info, color: FIGURES[id].color, hp: FIGURES[id].hp }])),
                difficulties: Object.fromEntries(Object.entries(DIFFICULTIES).map(([id, d]) => [id, d.name])),
                allyLevels: Object.fromEntries(Object.entries(ai.ALLY_LEVELS).map(([id, l]) => [id, l.name])),
                sections: SECTIONS.map(s => ({ id: s.id, name: s.name, width: s.width, boss: Boolean(s.boss) }))
            },
            world: { viewW: VIEW_W, depth: DEPTH, tickMs: TICK_MS, introTicks: INTRO_TICKS, transitionTicks: TRANSITION_TICKS, reviveTicks: REVIVE_TICKS, selfReviveTicks: SELF_REVIVE_TICKS, fxTicks: FX_TICKS },
            picks: {},
            ...freshField(),
            result: null,
            log: [],
            nextId: 1,
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

    tick(state) {
        if (state.phase !== "playing") return undefined;
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
        delete next.picks[player.id];
        const participant = next.players.find(p => p.id === player.id);
        if (!participant || participant.left || next.phase !== "playing") return next;
        participant.left = true;
        addLog(next, `${participant.name} hat Feierabend gemacht.`);
        if (!fieldPlayers(next).some(p => !p.bot)) finishMatch(next, "aborted");
        return next;
    },

    /** Nur für Tests. */
    _internals: {
        VIEW_W, DEPTH, FIGURES, FIGURE_IDS, ENEMIES, DIFFICULTIES, SECTIONS, INPUT_BUFFER, INTRO_TICKS, TRANSITION_TICKS,
        REVIVE_TICKS, SELF_REVIVE_TICKS, FOOD_HEAL, CRATE_HITS, DYING_TICKS, combat, ai,
        createRng, assignFigures, groupScale, spawnEnemy, spawnWave, loadSection, hitPlayer, step
    }
};

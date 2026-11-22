"use strict";

/**
 * Feierabend-Fäuste – KI: Gegner (mit Angriffs-Tickets), Boss und Bot-Mitstreiter.
 *
 * Gegner: Zustandsmaschine nähern → umkreisen → angreifen → erholen. Nur wer ein
 * „Ticket“ hat, darf angreifen (Anzahl je Schwierigkeit) – die anderen kreisen,
 * damit nicht alle gleichzeitig zuschlagen.
 *
 * Bot-Mitstreiter setzen nur ihre Eingaben (p.input) wie ein Mensch.
 */

const { ENEMIES, VIEW_W } = require("./level");
const { setState, canAct, isTargetable, walk, attackBox, strike, applyHit } = require("./combat");

const THROW_DISTANCE = 170;
const CHARGE_WINDUP = 16;
const CHARGE_SPEED = 330;
const CHARGE_MAX_TICKS = 34;
const STOMP_WINDUP = 20;
const STOMP_RADIUS = 72;
const BOTTLE_SPEED = 230;

/** Bot-Stärke der Mitstreiter: Reaktion (Chance pro Tick) und Genauigkeit beim Ausrichten. */
const ALLY_LEVELS = Object.freeze({
    leicht: { name: "Leicht", react: 0.35, align: 10, dodge: 0.3 },
    mittel: { name: "Mittel", react: 0.6, align: 7, dodge: 0.6 },
    schwer: { name: "Schwer", react: 0.9, align: 5, dodge: 0.9 }
});

const randInt = (rng, [min, max]) => min + Math.floor(rng.next() * (max - min + 1));

function nearest(list, from, filter = () => true) {
    let best = null;
    let bestDistance = Infinity;
    for (const item of list) {
        if (!filter(item)) continue;
        const distance = Math.abs(item.x - from.x) + Math.abs(item.z - from.z) * 1.5;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = item;
        }
    }
    return best;
}

/** Zu einem Punkt gehen; true, wenn angekommen. */
function goTo(actor, x, z, speed, tolerance = 4) {
    const dx = Math.abs(x - actor.x) > tolerance ? Math.sign(x - actor.x) : 0;
    const dz = Math.abs(z - actor.z) > tolerance * 0.6 ? Math.sign(z - actor.z) : 0;
    walk(actor, dx, dz, speed);
    return dx === 0 && dz === 0;
}

// ===========================================================================
// Gegner
// ===========================================================================

/** Bosse sind in Phase 1–3 (nach verbleibenden Lebenspunkten). */
function bossPhase(boss) {
    const share = boss.hp / boss.maxHp;
    return share > 0.66 ? 1 : share > 0.33 ? 2 : 3;
}

function startEnemyAttack(enemy, kind, armorChance = 0, rng = null) {
    enemy.attack = { kind, t: 0, hit: [] };
    // Je nach Schwierigkeit lässt sich ein Gegner beim Ausholen nicht unterbrechen
    enemy.superArmor = Boolean(rng && rng.next() < armorChance);
    setState(enemy, "attack");
    enemy.anim = kind;
}

/**
 * Einen Gegner einen Tick lang steuern.
 * @param {object} env  { players, enemies, projectiles, difficulty, camX, rng, hitPlayer(enemy, target, damage, opts) }
 */
function enemyTick(enemy, env) {
    const spec = ENEMIES[enemy.type];
    const { rng, difficulty } = env;
    const ai = enemy.ai;
    if (ai.cooldown > 0) ai.cooldown -= 1;
    if (ai.specialCd > 0) ai.specialCd -= 1;
    if (enemy.state === "attack") {
        runEnemyAttack(enemy, spec, env);
        return;
    }
    if (!canAct(enemy)) {
        ai.ticket = false;
        return;
    }
    if (ai.frozen) return; // nur für Tests: steht still

    const target = nearest(env.players, enemy, isTargetable);
    if (!target) {
        walk(enemy, 0, 0, 0);
        return;
    }
    const speed = spec.speed * difficulty.speed * (enemy.type === "boss" && bossPhase(enemy) === 3 ? 1.25 : 1);
    const side = enemy.x < target.x ? -1 : 1; // auf welcher Seite des Ziels der Gegner steht

    // Boss: Spezialangriffe
    if (enemy.type === "boss" && ai.specialCd <= 0) {
        const phase = bossPhase(enemy);
        const close = env.players.filter(p => isTargetable(p) && Math.hypot(p.x - enemy.x, (p.z - enemy.z) * 1.5) < STOMP_RADIUS);
        if (phase >= 2 && close.length > 0 && rng.next() < 0.5) {
            startEnemyAttack(enemy, "stomp");
            ai.specialCd = phase === 3 ? 70 : 100;
            return;
        }
        if (Math.abs(target.x - enemy.x) > 90) {
            enemy.facing = target.x > enemy.x ? 1 : -1;
            enemy.z = target.z;
            startEnemyAttack(enemy, "charge");
            ai.specialCd = phase === 3 ? 80 : 120;
            return;
        }
    }

    if (spec.ranged) {
        // Abstand halten, aber immer im Bild bleiben (sonst erreicht ihn niemand)
        let wantX = target.x + (enemy.x < target.x ? -THROW_DISTANCE : THROW_DISTANCE);
        if (wantX < env.camX + 30 || wantX > env.camX + VIEW_W - 30) wantX = target.x - (wantX - target.x);
        wantX = Math.max(env.camX + 30, Math.min(env.camX + VIEW_W - 30, wantX));
        const onScreen = enemy.x > env.camX + 10 && enemy.x < env.camX + VIEW_W - 10;
        const arrived = goTo(enemy, wantX, target.z, speed, 18);
        if (Math.abs(enemy.z - target.z) < 8 && ai.cooldown <= 0 && onScreen && (arrived || Math.abs(enemy.x - target.x) > 90)) {
            enemy.facing = target.x > enemy.x ? 1 : -1;
            startEnemyAttack(enemy, "throw", env.difficulty.armorChance, rng);
        }
        return;
    }

    const tickets = env.enemies.filter(e => e.ai.ticket).length;
    // Gleichzeitige Angreifer: Stufe × Gruppengröße (zu zweit weniger als zu viert)
    const maxTickets = Math.max(1, Math.round(difficulty.tickets * (env.ticketScale ?? 1)));
    if (!ai.ticket && ai.cooldown <= 0 && tickets < maxTickets) ai.ticket = true;
    if (ai.ticket) {
        const wantX = target.x + side * spec.reach * 0.8;
        if (goTo(enemy, wantX, target.z, speed, 6)) {
            enemy.facing = target.x > enemy.x ? 1 : -1;
            startEnemyAttack(enemy, "punch", env.difficulty.armorChance, rng);
        }
    } else {
        // Umkreisen: Abstand halten, leicht versetzt in der Tiefe
        const wantX = target.x + side * (85 + ai.slot * 18);
        goTo(enemy, wantX, Math.max(0, Math.min(110, target.z + ai.zOffset)), speed * 0.7, 12);
        if (rng.next() < 0.01) ai.zOffset = -30 + Math.floor(rng.next() * 61);
    }
}

function finishEnemyAttack(enemy, spec, env) {
    enemy.attack = null;
    enemy.superArmor = false;
    enemy.ai.ticket = false;
    enemy.ai.cooldown = Math.round(randInt(env.rng, spec.cooldown) * env.difficulty.cooldown);
    setState(enemy, "idle");
}

function runEnemyAttack(enemy, spec, env) {
    const attack = enemy.attack;
    attack.t += 1;
    const windup = Math.max(4, Math.round(spec.windup * env.difficulty.cooldown));
    const damage = Math.round(spec.damage * env.difficulty.damage * (enemy.damageScale ?? 1));

    if (attack.kind === "punch") {
        if (attack.t > windup && attack.t <= windup + 2) {
            strike(enemy, attackBox(enemy, spec.reach, { zTol: 12, hMax: 22 }), env.players.filter(isTargetable),
                target => env.hitPlayer(enemy, target, damage, { facing: enemy.facing, finisher: enemy.type !== "schlaeger" && enemy.type !== "werfer" }));
        }
        if (attack.t >= windup + 2 + spec.recovery) finishEnemyAttack(enemy, spec, env);
    } else if (attack.kind === "throw") {
        if (attack.t === windup) {
            env.projectiles.push({ x: enemy.x + enemy.facing * 12, z: enemy.z, h: 28, vx: enemy.facing * BOTTLE_SPEED, damage, ttl: 60, owner: enemy.id });
        }
        if (attack.t >= windup + spec.recovery) finishEnemyAttack(enemy, spec, env);
    } else if (attack.kind === "charge") {
        if (attack.t > CHARGE_WINDUP) {
            enemy.x += enemy.facing * CHARGE_SPEED * 0.05;
            strike(enemy, attackBox(enemy, 18, { around: true, zTol: 16, hMax: 20 }), env.players.filter(isTargetable),
                target => env.hitPlayer(enemy, target, Math.round(damage * 1.1), { facing: enemy.facing, finisher: true }));
            const atEdge = enemy.x <= env.camX + 20 || enemy.x >= env.camX + VIEW_W - 20;
            if (atEdge || attack.t > CHARGE_WINDUP + CHARGE_MAX_TICKS) finishEnemyAttack(enemy, spec, env);
        }
    } else if (attack.kind === "stomp") {
        if (attack.t === STOMP_WINDUP) {
            strike(enemy, attackBox(enemy, STOMP_RADIUS, { around: true, zTol: 40, hMax: 8 }), env.players.filter(isTargetable),
                target => env.hitPlayer(enemy, target, Math.round(damage * 0.9), { facing: target.x >= enemy.x ? 1 : -1, finisher: true }));
            env.shake(8);
        }
        if (attack.t >= STOMP_WINDUP + 12) finishEnemyAttack(enemy, spec, env);
    }
}

/** Flaschen fliegen auf der Bodenebene; wer hoch genug springt, weicht aus. */
function projectileTick(projectiles, players, hitPlayer) {
    for (const bottle of projectiles) {
        bottle.x += bottle.vx * 0.05;
        bottle.ttl -= 1;
        for (const player of players) {
            if (bottle.ttl <= 0 || !isTargetable(player)) continue;
            if (Math.abs(player.x - bottle.x) < 10 && Math.abs(player.z - bottle.z) < 12 && player.h < 18) {
                hitPlayer(null, player, bottle.damage, { facing: Math.sign(bottle.vx) || 1, finisher: false });
                bottle.ttl = 0;
            }
        }
    }
    return projectiles.filter(b => b.ttl > 0);
}

// ===========================================================================
// Bot-Mitstreiter
// ===========================================================================

/** Eingabe so setzen, dass der Bot auf (x, z) zuläuft (bewegt ihn nicht selbst). */
function steer(input, bot, x, z, tolerance = 4) {
    input.dx = Math.abs(x - bot.x) > tolerance ? Math.sign(x - bot.x) : 0;
    input.dz = Math.abs(z - bot.z) > tolerance * 0.6 ? Math.sign(z - bot.z) : 0;
    return input.dx === 0 && input.dz === 0;
}

/**
 * Eingaben eines Bot-Mitstreiters für diesen Tick setzen.
 * @param {object} env  { players, enemies, projectiles, crates, pickups, camX, lock, level, rng, figure }
 */
function allyTick(bot, env) {
    const { rng, level, figure } = env;
    const input = bot.input;
    input.dx = 0;
    input.dz = 0;
    if (bot.state === "ko") return;

    // 1. Gefahr ausweichen: Boss-Ansturm in derselben Tiefe, Bodenstampfer in der Nähe, Flaschen
    const boss = env.enemies.find(e => e.type === "boss" && e.state === "attack");
    if (boss && rng.next() < level.dodge) {
        if (boss.attack.kind === "charge" && Math.abs(bot.z - boss.z) < 24) {
            input.dz = bot.z < 55 ? 1 : -1;
            return;
        }
        if (boss.attack.kind === "stomp" && Math.hypot(bot.x - boss.x, (bot.z - boss.z) * 1.5) < STOMP_RADIUS + 20) {
            input.dx = bot.x < boss.x ? -1 : 1;
            if (boss.attack.t > 14) input.jump = 2;
            return;
        }
    }
    const bottle = env.projectiles.find(b => Math.abs(b.z - bot.z) < 12 && Math.sign(bot.x - b.x) === Math.sign(b.vx) && Math.abs(bot.x - b.x) < 45);
    if (bottle && rng.next() < level.dodge * 0.5) {
        input.jump = 2;
        return;
    }

    // 2. Liegende Mitspieler aufhelfen, wenn es ruhig genug ist
    const downed = env.players.find(p => p !== bot && p.state === "ko"
        && !env.enemies.some(e => e.hp > 0 && Math.abs(e.x - p.x) < 60 && Math.abs(e.z - p.z) < 30));
    if (downed) {
        steer(input, bot, downed.x + (bot.x < downed.x ? -14 : 14), downed.z, 6);
        return;
    }

    // 3. Wenig Lebenspunkte: Essen holen
    if (bot.hp < bot.maxHp * 0.35) {
        const food = nearest(env.pickups, bot);
        if (food) {
            steer(input, bot, food.x, food.z, 4);
            return;
        }
    }

    // 4. Kämpfen
    const enemies = env.enemies.filter(e => e.hp > 0 && e.state !== "dying");
    if (enemies.length > 0) {
        const target = nearest(enemies, bot);
        const crowd = enemies.filter(e => Math.abs(e.x - bot.x) < 55 && Math.abs(e.z - bot.z) < 22).length;
        if (crowd >= 3 && bot.hp > bot.maxHp * 0.45 && canAct(bot) && rng.next() < 0.08) {
            input.special = 2;
            return;
        }
        const side = bot.x < target.x ? -1 : 1;
        const wantX = target.x + side * (figure.reach * 0.7 + 6);
        const aligned = Math.abs(bot.x - wantX) < level.align + figure.reach * 0.3 && Math.abs(bot.z - target.z) < level.align;
        if (aligned) {
            if (canAct(bot) || bot.state === "attack") {
                bot.facing = target.x > bot.x ? 1 : -1;
                if (rng.next() < level.react) input.attack = 2;
            }
        } else {
            steer(input, bot, wantX, target.z, 4);
        }
        return;
    }

    // 5. Ruhe: Kisten zerschlagen, sonst mit der Kamera vorangehen
    const crate = env.crates.find(c => c.x > env.camX && c.x < env.camX + VIEW_W);
    if (crate && bot.hp < bot.maxHp * 0.8) {
        const wantX = crate.x - figure.reach * 0.7;
        if (Math.abs(bot.x - wantX) < 8 && Math.abs(bot.z - crate.z) < 8) {
            bot.facing = 1;
            if (rng.next() < level.react) input.attack = 2;
        } else {
            steer(input, bot, wantX, crate.z, 4);
        }
        return;
    }
    if (!env.lock) {
        input.dx = bot.x < env.camX + VIEW_W - 25 ? 1 : 0;
        input.dz = Math.abs(bot.z - 55) > 20 ? Math.sign(55 - bot.z) : 0;
    }
}

module.exports = {
    ALLY_LEVELS, CHARGE_WINDUP, STOMP_WINDUP, STOMP_RADIUS, BOTTLE_SPEED,
    bossPhase, enemyTick, projectileTick, allyTick, startEnemyAttack, nearest
};

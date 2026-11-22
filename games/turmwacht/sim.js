"use strict";

/**
 * Turmwacht – Simulation einer Welle: Gegner laufen den Pfad entlang, Türme
 * suchen sich Ziele und schießen. Schüsse treffen sofort; für die Anzeige
 * entstehen kurze Effekte in state.fx.
 *
 * Die Funktionen ändern den übergebenen (bereits kopierten) Zustand direkt und
 * melden Ereignisse über die Rückrufe in `hooks`:
 *   hooks.damage(tower, enemy, dealt)   hooks.kill(tower, enemy)   hooks.leak(enemy)
 */

const { TOWERS, ENEMIES, CHAIN_JUMP, CHAIN_FALLOFF, SLOW_TICKS, ARMOR_FLOOR } = require("./data");
const { positionAt } = require("./map");

const TICK_S = 0.1;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = enemy => enemy.hp > 0;

/** Gegner einen Schritt weiterbewegen; wer das Ziel erreicht, wird gemeldet und entfernt. */
function moveEnemies(state, hooks) {
    const speedFactor = state.difficultySpeed;
    for (const enemy of state.enemies) {
        let speed = ENEMIES[enemy.type].speed * speedFactor;
        if (enemy.slowT > 0) {
            speed *= 1 - enemy.slow * (ENEMIES[enemy.type].boss ? 0.5 : 1);
            enemy.slowT -= 1;
            if (enemy.slowT === 0) enemy.slow = 0;
        }
        enemy.d += speed * TICK_S;
        Object.assign(enemy, positionAt(state.map, enemy.d));
    }
    const leaked = state.enemies.filter(e => e.d >= state.map.length);
    if (leaked.length === 0) return;
    for (const enemy of leaked) hooks.leak(enemy);
    state.enemies = state.enemies.filter(e => e.d < state.map.length);
}

/** Schaden nach Panzerung, höchstens die verbleibenden Lebenspunkte. */
function applyDamage(state, tower, enemy, raw, pierce, hooks) {
    if (!alive(enemy)) return 0;
    const reduced = pierce ? raw : Math.max(raw * ARMOR_FLOOR, raw - enemy.armor);
    const dealt = Math.min(enemy.hp, reduced);
    enemy.hp -= dealt;
    hooks.damage(tower, enemy, dealt);
    if (enemy.hp <= 1e-9) {
        enemy.hp = 0;
        hooks.kill(tower, enemy);
    }
    return dealt;
}

function fx(state, data) {
    state.fx.push({ t: state.tickNo, ...data });
}

/** Ziele in Reichweite, vorderster Gegner zuerst. */
function targetsInRange(state, tower, range) {
    const center = { x: tower.x + 0.5, y: tower.y + 0.5 };
    return state.enemies
        .filter(e => alive(e) && e.d > 0 && dist(center, e) <= range)
        .sort((a, b) => b.d - a.d);
}

/** Ein Turm feuert, falls bereit und ein Ziel in Reichweite ist. */
function fireTower(state, tower, hooks) {
    if (tower.cd > 0) {
        tower.cd -= 1;
        return;
    }
    const stats = TOWERS[tower.type].levels[tower.level - 1];
    const targets = targetsInRange(state, tower, stats.range);
    if (targets.length === 0) return;
    const from = { x: tower.x + 0.5, y: tower.y + 0.5 };
    tower.cd = stats.cd;
    switch (tower.type) {
        case "pfeil":
            for (const target of targets.slice(0, stats.shots)) {
                fx(state, { k: "arrow", from, to: { x: target.x, y: target.y } });
                applyDamage(state, tower, target, stats.damage, false, hooks);
            }
            break;
        case "kanone": {
            const target = targets[0];
            const at = { x: target.x, y: target.y };
            fx(state, { k: "boom", from, to: at, r: stats.splash });
            for (const enemy of state.enemies.filter(e => alive(e) && dist(at, e) <= stats.splash)) {
                applyDamage(state, tower, enemy, stats.damage, false, hooks);
            }
            break;
        }
        case "frost":
            fx(state, { k: "frost", from, r: stats.range });
            for (const enemy of targets) {
                enemy.slow = Math.max(enemy.slow, stats.slow);
                enemy.slowT = SLOW_TICKS;
                applyDamage(state, tower, enemy, stats.damage, false, hooks);
            }
            break;
        case "blitz": {
            const hit = [targets[0]];
            while (hit.length < stats.chain) {
                const last = hit[hit.length - 1];
                const next = state.enemies
                    .filter(e => alive(e) && e.d > 0 && !hit.includes(e) && dist(last, e) <= CHAIN_JUMP)
                    .sort((a, b) => dist(last, a) - dist(last, b))[0];
                if (!next) break;
                hit.push(next);
            }
            fx(state, { k: "zap", from, pts: hit.map(e => ({ x: e.x, y: e.y })) });
            hit.forEach((enemy, i) => applyDamage(state, tower, enemy, stats.damage * CHAIN_FALLOFF ** i, true, hooks));
            break;
        }
        case "fernrohr": {
            const target = targets[0];
            fx(state, { k: "snipe", from, to: { x: target.x, y: target.y } });
            applyDamage(state, tower, target, stats.damage, false, hooks);
            break;
        }
        default:
            break;
    }
}

/** Ein Simulationsschritt: nächsten Gegner schicken, bewegen, schießen, Tote entfernen. */
function simulate(state, hooks) {
    if (state.spawn.length > 0) {
        state.spawnT -= 1;
        if (state.spawnT <= 0) {
            const type = state.spawn.shift();
            hooks.spawn(type);
            state.spawnT = state.spawn.length > 0 ? ENEMIES[state.spawn[0]].gap : 0;
        }
    }
    moveEnemies(state, hooks);
    for (const tower of state.towers) fireTower(state, tower, hooks);
    state.enemies = state.enemies.filter(alive);
}

module.exports = { TICK_S, moveEnemies, applyDamage, fireTower, targetsInRange, simulate, dist };

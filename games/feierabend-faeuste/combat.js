"use strict";

/**
 * Feierabend-Fäuste – Kampf: Bewegung, Sprung, Angriffe, Treffer, Schaden.
 *
 * Akteure (Spieler und Gegner) haben gemeinsame Felder:
 *   x, z, h, vh, kx, facing (1 = rechts, -1 = links), hp, maxHp,
 *   state ("idle" | "walk" | "attack" | "jump" | "hurt" | "down" | "getup" | "ko" | "dying" | KI-Zustände),
 *   lock (Ticks, in denen nicht gesteuert werden kann), invuln (Ticks unverwundbar),
 *   attack ({kind, step, t, hit: [ids]} während eines Angriffs), anim/animT (für den Client).
 */

const { VIEW_W, DEPTH } = require("./level");

const TICK_MS = 50;
const DT = TICK_MS / 1000;
const GRAVITY = 900;
const JUMP_SPEED = 270;
const Z_SPEED = 0.6;            // Tiefe geht langsamer als seitwärts
const Z_TOLERANCE = 14;         // Treffer nur, wenn die Tiefe passt
const HURT_TICKS = 6;
const DOWN_TICKS = 18;
const GETUP_TICKS = 8;
const COMBO_WINDOW = 7;         // so lange nach einem Schlag geht die Kombo weiter
const SPECIAL_COST = 0.1;       // Anteil der max. Lebenspunkte
const SPECIAL_TICKS = 8;
const SPECIAL_RADIUS = 52;
const LIGHT_KNOCK = 25;            // klein, damit Kombos nicht aus der Reichweite schieben
const HEAVY_KNOCK = 190;
const JUGGLE_LIMIT = 4;          // nach so vielen Treffern in Folge geht ein Gegner zu Boden
const JUGGLE_WINDOW = 30;         // … innerhalb dieser Ticks

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Zustand setzen (Animation beginnt von vorn). */
function setState(actor, state, lock = 0) {
    actor.state = state;
    actor.lock = lock;
    actor.anim = state;
    actor.animT = 0;
}

/** Kann der Akteur gerade gesteuert werden? */
function canAct(actor) {
    return (actor.state === "idle" || actor.state === "walk") && actor.lock === 0 && actor.h === 0;
}

/** Gilt der Akteur als treffbar? */
function isTargetable(actor) {
    return actor.hp > 0 && actor.invuln === 0 && !["down", "getup", "ko", "dying"].includes(actor.state);
}

/**
 * Gemeinsame Physik pro Tick: Rückstoß, Sprung/Fall, Sperrzeiten, Zustandsübergänge.
 * Grenzen der Bewegung (Kamera/Abschnitt) werden vom Aufrufer gesetzt.
 */
function physics(actor) {
    actor.animT += 1;
    if (actor.invuln > 0) actor.invuln -= 1;
    if (actor.juggleT > 0) actor.juggleT -= 1;
    if (actor.kx !== 0) {
        actor.x += actor.kx * DT;
        actor.kx *= 0.75;
        if (Math.abs(actor.kx) < 5) actor.kx = 0;
    }
    if (actor.h > 0 || actor.vh > 0) {
        actor.h += actor.vh * DT;
        actor.vh -= GRAVITY * DT;
        if (actor.h <= 0) {
            actor.h = 0;
            actor.vh = 0;
            if (actor.state === "jump" || (actor.state === "attack" && actor.attack?.kind === "jumpkick")) {
                actor.attack = null;
                setState(actor, "idle");
            }
        }
    }
    actor.z = clamp(actor.z, 0, DEPTH);
    if (actor.lock > 0) {
        actor.lock -= 1;
        if (actor.lock === 0) {
            if (actor.state === "down") {
                setState(actor, "getup", GETUP_TICKS);
                actor.invuln = GETUP_TICKS + 4;
            } else if (actor.state === "hurt" || actor.state === "getup") {
                setState(actor, "idle");
            }
        }
    }
}

/** Gehen in Richtung (dx, dz) mit dem Tempo des Akteurs. */
function walk(actor, dx, dz, speed) {
    if (dx === 0 && dz === 0) {
        if (actor.state === "walk") setState(actor, "idle");
        return;
    }
    const length = Math.hypot(dx, dz * Z_SPEED) || 1;
    actor.x += (dx / length) * speed * DT;
    actor.z += ((dz * Z_SPEED) / length) * speed * DT;
    if (dx !== 0) actor.facing = dx > 0 ? 1 : -1;
    if (actor.state === "idle") {
        actor.state = "walk";
        actor.anim = "walk";
    }
}

/** Trefferzone eines Angriffs. @returns {{x1, x2, z, zTol, hMax}} */
function attackBox(actor, reach, { around = false, zTol = Z_TOLERANCE, hMax = 40 } = {}) {
    if (around) return { x1: actor.x - reach, x2: actor.x + reach, z: actor.z, zTol, hMax };
    const near = actor.x + actor.facing * 6;
    const far = actor.x + actor.facing * (6 + reach);
    return { x1: Math.min(near, far), x2: Math.max(near, far), z: actor.z, zTol, hMax };
}

function inBox(box, target) {
    return target.x >= box.x1 - 8 && target.x <= box.x2 + 8
        && Math.abs(target.z - box.z) <= box.zTol && target.h <= box.hMax;
}

/**
 * Schaden zufügen. Gepanzerte Ziele werden nur von Abschluss-Treffern unterbrochen.
 * @returns {number} tatsächlich abgezogene Lebenspunkte
 */
function applyHit(target, amount, { facing, finisher = false, knock = 1 }) {
    const before = target.hp;
    target.hp = Math.max(0, target.hp - amount);
    // Kein Dauer-Festhalten: nach JUGGLE_LIMIT Treffern in Folge geht das Ziel zu Boden
    if (target.juggle !== undefined) {
        target.juggle = target.juggleT > 0 ? target.juggle + 1 : 1;
        target.juggleT = JUGGLE_WINDOW;
        if (target.juggle >= JUGGLE_LIMIT) {
            finisher = true;
            target.juggle = 0;
        }
    }
    const dealt = before - target.hp;
    target.flash = 3;
    if (target.hp <= 0) {
        target.kx = facing * HEAVY_KNOCK * knock;
        return dealt;
    }
    if (finisher) {
        target.attack = null;
        target.kx = facing * HEAVY_KNOCK * knock;
        if (target.h === 0) target.vh = 120;
        setState(target, "down", DOWN_TICKS);
    } else if (!target.armored && !target.superArmor) {
        target.attack = null;
        target.kx = facing * LIGHT_KNOCK * knock;
        setState(target, "hurt", HURT_TICKS);
    }
    return dealt;
}

/** Alle Ziele in der Zone treffen, die dieser Angriff noch nicht getroffen hat. */
function strike(attacker, box, targets, onHit) {
    for (const target of targets) {
        if (attacker.attack.hit.includes(target.id) || !inBox(box, target)) continue;
        attacker.attack.hit.push(target.id);
        onHit(target);
    }
}

module.exports = {
    TICK_MS, DT, GRAVITY, JUMP_SPEED, Z_TOLERANCE, HURT_TICKS, DOWN_TICKS, GETUP_TICKS, COMBO_WINDOW,
    SPECIAL_COST, SPECIAL_TICKS, SPECIAL_RADIUS, JUGGLE_LIMIT, VIEW_W, DEPTH,
    clamp, setState, canAct, isTargetable, physics, walk, attackBox, inBox, applyHit, strike
};

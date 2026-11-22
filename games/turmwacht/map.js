"use strict";

/**
 * Turmwacht – Karten-Generator.
 *
 * Raster COLS × ROWS. Der Pfad läuft vom linken zum rechten Rand und geht nur
 * nach rechts, oben oder unten (kreuzt sich also nie). Waagerechte Stücke sind
 * mindestens 2 Felder lang, damit zwischen den Kehren Platz für Türme bleibt.
 *
 * grid: Text mit einem Zeichen pro Feld
 *   "." frei (bebaubar)   "#" Pfad   "r" Felsen   "t" Baum
 * points: Wegpunkte (Feldmitten der Ecken, plus Ein- und Ausgang außerhalb),
 * cum: Distanz entlang des Pfads bis zu jedem Wegpunkt, length: Gesamtlänge.
 */

const COLS = 16;
const ROWS = 10;
const MIN_TURNS = 3;
const MAX_TURNS = 8;
const MIN_CELLS = 28;
const DECO_MIN = 6;
const DECO_MAX = 10;

/** Kleiner Zufallsgenerator (mulberry32) mit Zustand als Zahl. */
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

const randInt = (rng, min, max) => min + Math.floor(rng.next() * (max - min + 1));

/** Ein Versuch: Pfad als Liste von Feldern [x, y]. */
function tryPath(rng) {
    let x = 0;
    let y = randInt(rng, 1, ROWS - 2);
    const cells = [[x, y]];
    const go = (dx, dy, n) => {
        for (let i = 0; i < n; i++) {
            x += dx;
            y += dy;
            cells.push([x, y]);
        }
    };
    go(1, 0, randInt(rng, 1, 3));
    while (x < COLS - 1) {
        // senkrechtes Stück (2–6 Felder, innerhalb der Zeilen 1 … ROWS-2)
        const up = y - 1;
        const down = ROWS - 2 - y;
        const dir = up < 2 ? 1 : down < 2 ? -1 : rng.next() < 0.5 ? -1 : 1;
        const room = dir < 0 ? up : down;
        if (room >= 2 && x < COLS - 3) go(0, dir, randInt(rng, 2, Math.min(6, room)));
        // waagerechtes Stück (mindestens 2 Felder)
        const rest = COLS - 1 - x;
        go(1, 0, rest <= 4 ? rest : randInt(rng, 2, Math.min(4, rest - 2)));
    }
    return cells;
}

function turnsOf(cells) {
    let turns = 0;
    for (let i = 2; i < cells.length; i++) {
        const d1 = [cells[i - 1][0] - cells[i - 2][0], cells[i - 1][1] - cells[i - 2][1]];
        const d2 = [cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]];
        if (d1[0] !== d2[0] || d1[1] !== d2[1]) turns += 1;
    }
    return turns;
}

/** Keine zwei Pfadfelder dürfen sich berühren, außer sie folgen direkt aufeinander. */
function touchesItself(cells) {
    const index = new Map(cells.map(([x, y], i) => [`${x},${y}`, i]));
    if (index.size !== cells.length) return true;
    return cells.some(([x, y], i) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const j = index.get(`${x + dx},${y + dy}`);
        return j !== undefined && Math.abs(j - i) > 1;
    }));
}

function isValidPath(cells) {
    const turns = turnsOf(cells);
    const last = cells[cells.length - 1];
    return cells[0][0] === 0 && last[0] === COLS - 1 && cells.length >= MIN_CELLS &&
        turns >= MIN_TURNS && turns <= MAX_TURNS && !touchesItself(cells);
}

/** Wegpunkte (nur Ecken) mit Ein- und Ausgang außerhalb des Rasters. */
function waypoints(cells) {
    const points = [[-0.6, cells[0][1] + 0.5]];
    for (let i = 0; i < cells.length; i++) {
        const prev = cells[i - 1];
        const next = cells[i + 1];
        const corner = !prev || !next || (prev[0] !== next[0] && prev[1] !== next[1]);
        if (corner) points.push([cells[i][0] + 0.5, cells[i][1] + 0.5]);
    }
    points.push([COLS + 0.6, cells[cells.length - 1][1] + 0.5]);
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    return { points, cum, length: cum[cum.length - 1] };
}

/** Feste Ersatzkarte, falls der Zufall (sehr unwahrscheinlich) nichts Gültiges liefert. */
function fallbackPath() {
    const cells = [];
    const line = (x1, y1, x2, y2) => {
        const dx = Math.sign(x2 - x1);
        const dy = Math.sign(y2 - y1);
        let x = x1;
        let y = y1;
        if (cells.length === 0) cells.push([x, y]);
        while (x !== x2 || y !== y2) {
            x += dx;
            y += dy;
            cells.push([x, y]);
        }
    };
    line(0, 2, 3, 2);
    line(3, 2, 3, 7);
    line(3, 7, 7, 7);
    line(7, 7, 7, 2);
    line(7, 2, 11, 2);
    line(11, 2, 11, 7);
    line(11, 7, 15, 7);
    return cells;
}

/** Karte zu einem Seed erzeugen (gleicher Seed → gleiche Karte). */
function generateMap(seed) {
    const rng = createRng(seed);
    let cells = null;
    for (let attempt = 0; attempt < 400 && !cells; attempt++) {
        const candidate = tryPath(rng);
        if (isValidPath(candidate)) cells = candidate;
    }
    if (!cells) cells = fallbackPath();

    const grid = Array(COLS * ROWS).fill(".");
    for (const [x, y] of cells) grid[y * COLS + x] = "#";
    const decoCount = randInt(rng, DECO_MIN, DECO_MAX);
    for (let placed = 0, guard = 0; placed < decoCount && guard < 500; guard++) {
        const i = Math.floor(rng.next() * grid.length);
        if (grid[i] !== ".") continue;
        grid[i] = rng.next() < 0.5 ? "r" : "t";
        placed += 1;
    }
    return { seed: seed >>> 0, cols: COLS, rows: ROWS, grid: grid.join(""), path: cells, ...waypoints(cells) };
}

/** Position auf dem Pfad nach Distanz d (vor dem Start / nach dem Ziel geklemmt). */
function positionAt(map, d) {
    const { points, cum } = map;
    if (d <= 0) return { x: points[0][0], y: points[0][1] };
    for (let i = 1; i < points.length; i++) {
        if (d <= cum[i]) {
            const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
            return {
                x: points[i - 1][0] + (points[i][0] - points[i - 1][0]) * k,
                y: points[i - 1][1] + (points[i][1] - points[i - 1][1]) * k
            };
        }
    }
    const last = points[points.length - 1];
    return { x: last[0], y: last[1] };
}

const cellAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.cols && y < map.rows ? map.grid[y * map.cols + x] : null);

module.exports = { COLS, ROWS, MIN_TURNS, MAX_TURNS, MIN_CELLS, createRng, generateMap, positionAt, cellAt, turnsOf, touchesItself, isValidPath };

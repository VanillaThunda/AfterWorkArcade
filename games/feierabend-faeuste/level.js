"use strict";

/**
 * Feierabend-Fäuste – Spieldaten: Figuren, Gegner, Schwierigkeit, Level.
 *
 * Alle Werte in Welteinheiten bzw. Ticks (1 Tick = 50 ms).
 * Welt: x läuft durch den Abschnitt, z ist die Tiefe der Bodenfläche
 * (0 = hinten, DEPTH = vorn), h ist die Höhe über dem Boden (Sprung).
 */

const VIEW_W = 480;          // sichtbarer Ausschnitt (Breite)
const DEPTH = 110;           // Tiefe der Bodenfläche

/** Spielbare Figuren (eigene Figuren; jede Figur nur einmal pro Gruppe). */
const FIGURES = Object.freeze({
    kurierin: {
        name: "Kurierin", role: "Flitzer", color: "#e4572e",
        info: "Schnell und wendig, schwache aber flinke Schläge.",
        hp: 90, speed: 125, reach: 34, damage: [6, 6, 11], knock: 1,
        timing: { startup: 1, active: 2, recovery: 2 }
    },
    lagerist: {
        name: "Lagerist", role: "Allrounder", color: "#2e86de",
        info: "Ausgewogen in Tempo, Kraft und Ausdauer.",
        hp: 110, speed: 100, reach: 38, damage: [8, 8, 14], knock: 1,
        timing: { startup: 2, active: 2, recovery: 3 }
    },
    hausmeister: {
        name: "Hausmeister", role: "Brecher", color: "#27ae60",
        info: "Langsam, aber zäh und mit wuchtigen Schlägen.",
        hp: 140, speed: 80, reach: 40, damage: [11, 11, 20], knock: 1.5,
        timing: { startup: 3, active: 2, recovery: 4 }
    },
    monteurin: {
        name: "Monteurin", role: "Hebel", color: "#c9a227",
        info: "Mit Rohrzange: große Reichweite, mittlerer Schaden.",
        hp: 100, speed: 95, reach: 58, damage: [8, 8, 13], knock: 1.1,
        timing: { startup: 2, active: 3, recovery: 4 }
    }
});
const FIGURE_IDS = Object.freeze(Object.keys(FIGURES));

/** Gegnertypen (eigene Figuren). windup = Ausholen (sichtbar), recovery = Erholung. */
const ENEMIES = Object.freeze({
    schlaeger: { name: "Schläger", hp: 60, speed: 72, reach: 30, damage: 9, windup: 8, recovery: 10, cooldown: [20, 40], armored: false, color: "#7d5ba6" },
    werfer: { name: "Werfer", hp: 42, speed: 68, reach: 0, damage: 8, windup: 10, recovery: 8, cooldown: [40, 60], armored: false, ranged: true, color: "#b5651d" },
    brocken: { name: "Brocken", hp: 140, speed: 52, reach: 36, damage: 15, windup: 12, recovery: 14, cooldown: [30, 50], armored: true, color: "#5d6d7e" },
    boss: { name: "Schichtleiter", hp: 800, speed: 72, reach: 44, damage: 18, windup: 10, recovery: 12, cooldown: [16, 30], armored: true, color: "#8e1b1b" }
});

/** Schwierigkeit: Faktoren auf die Gegnerwerte, Angriffs-Tickets, Wellengröße. */
const DIFFICULTIES = Object.freeze({
    leicht: { name: "Leicht", hp: 0.75, damage: 0.7, speed: 0.9, tickets: 2, wave: 0.8, cooldown: 1.3, armorChance: 0.15 },
    mittel: { name: "Mittel", hp: 1, damage: 1, speed: 1, tickets: 3, wave: 1, cooldown: 1, armorChance: 0.35 },
    schwer: { name: "Schwer", hp: 1.4, damage: 1.25, speed: 1.1, tickets: 4, wave: 1.2, cooldown: 0.85, armorChance: 0.5 }
});

/**
 * Das Level: drei Abschnitte mit Gegnerwellen und Kisten, danach die Boss-Arena.
 * wave.at = Kameraposition, ab der die Welle kommt (die Kamera bleibt dort stehen).
 * crate.item = "food" (heilt) oder null.
 */
const SECTIONS = Object.freeze([
    {
        id: "hinterhof", name: "Hinterhof", width: 1400,
        waves: [
            { at: 160, enemies: ["schlaeger", "schlaeger", "schlaeger"] },
            { at: 620, enemies: ["schlaeger", "werfer", "schlaeger", "schlaeger"] }
        ],
        crates: [{ x: 430, z: 20, item: "food" }, { x: 980, z: 85, item: null }, { x: 1100, z: 30, item: "food" }]
    },
    {
        id: "lagerhalle", name: "Lagerhalle", width: 1400,
        waves: [
            { at: 120, enemies: ["schlaeger", "schlaeger", "werfer", "schlaeger"] },
            { at: 500, enemies: ["brocken", "schlaeger", "schlaeger"] },
            { at: 880, enemies: ["werfer", "schlaeger", "schlaeger", "werfer", "schlaeger"] }
        ],
        crates: [{ x: 360, z: 90, item: "food" }, { x: 760, z: 15, item: "food" }, { x: 1150, z: 60, item: null }]
    },
    {
        id: "dach", name: "Dach", width: 1300,
        waves: [
            { at: 200, enemies: ["brocken", "schlaeger", "werfer", "schlaeger"] },
            { at: 700, enemies: ["brocken", "brocken", "schlaeger", "werfer", "schlaeger"] }
        ],
        crates: [{ x: 480, z: 25, item: "food" }, { x: 1000, z: 80, item: "food" }]
    },
    {
        id: "chefetage", name: "Chefetage", width: VIEW_W, boss: true,
        waves: [],
        crates: [{ x: 60, z: 15, item: "food" }, { x: 420, z: 95, item: "food" }]
    }
]);

module.exports = { VIEW_W, DEPTH, FIGURES, FIGURE_IDS, ENEMIES, DIFFICULTIES, SECTIONS };

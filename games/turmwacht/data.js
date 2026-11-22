"use strict";

/**
 * Turmwacht – Spieldaten: Türme mit Stufen, Gegnertypen, Schwierigkeit und die
 * Wellen-Formel. Alle Distanzen in Feldern, Zeiten in Ticks (100 ms).
 */

/**
 * Türme. Jede Stufe (1–4) hat eigene Werte; upgrades[i] kostet den Schritt von
 * Stufe i+1 auf i+2.
 *   damage  Schaden je Treffer      range  Reichweite (Felder)
 *   cd      Ticks zwischen Schüssen splash Flächenradius (Kanone)
 *   slow    Verlangsamung (Frost)   chain  Zahl der Ziele (Blitz)
 *   shots   Ziele je Schuss (Pfeil) pierce ignoriert Panzerung
 */
const TOWERS = Object.freeze({
    pfeil: {
        name: "Pfeilturm", short: "Pfeil", color: "#8d6e63", cost: 50,
        info: "Günstig und schnell, ein Ziel. Stufe 4: zwei Pfeile.",
        levels: [
            { damage: 9, range: 2.5, cd: 6, shots: 1 },
            { damage: 15, range: 2.7, cd: 5, shots: 1 },
            { damage: 24, range: 2.9, cd: 5, shots: 1 },
            { damage: 36, range: 3.2, cd: 4, shots: 2 }
        ]
    },
    kanone: {
        name: "Kanone", short: "Kanone", color: "#546e7a", cost: 90,
        info: "Langsam, trifft alle Gegner rund um das Ziel – gut gegen Schwärme.",
        levels: [
            { damage: 16, range: 2.3, cd: 14, splash: 0.9 },
            { damage: 27, range: 2.4, cd: 13, splash: 1.0 },
            { damage: 42, range: 2.6, cd: 12, splash: 1.1 },
            { damage: 66, range: 2.8, cd: 11, splash: 1.35 }
        ]
    },
    frost: {
        name: "Frostturm", short: "Frost", color: "#4fc3f7", cost: 70,
        info: "Kältewelle trifft alle in Reichweite und bremst sie für 2 s.",
        levels: [
            { damage: 3, range: 2.0, cd: 10, slow: 0.3 },
            { damage: 5, range: 2.2, cd: 9, slow: 0.38 },
            { damage: 8, range: 2.4, cd: 8, slow: 0.46 },
            { damage: 13, range: 2.7, cd: 7, slow: 0.55 }
        ]
    },
    blitz: {
        name: "Blitzturm", short: "Blitz", color: "#ab47bc", cost: 120,
        info: "Kettenblitz springt von Gegner zu Gegner und ignoriert Panzerung.",
        levels: [
            { damage: 16, range: 2.4, cd: 12, chain: 3, pierce: true },
            { damage: 24, range: 2.6, cd: 11, chain: 4, pierce: true },
            { damage: 35, range: 2.8, cd: 10, chain: 5, pierce: true },
            { damage: 52, range: 3.0, cd: 9, chain: 6, pierce: true }
        ]
    },
    fernrohr: {
        name: "Fernrohr", short: "Fernrohr", color: "#ef6c00", cost: 140,
        info: "Riesige Reichweite, langsam, sehr hoher Einzelschaden – stark gegen Panzer und Koloss.",
        levels: [
            { damage: 60, range: 4.5, cd: 22 },
            { damage: 100, range: 5.0, cd: 21 },
            { damage: 160, range: 5.5, cd: 20 },
            { damage: 250, range: 6.5, cd: 18 }
        ]
    }
});
const TOWER_IDS = Object.freeze(Object.keys(TOWERS));
const UPGRADE_FACTORS = [0.6, 0.9, 1.3];
const MAX_LEVEL = 4;
const SELL_RATE = 0.7;
const CHAIN_JUMP = 1.6;       // Felder, die ein Blitz zum nächsten Ziel springt
const CHAIN_FALLOFF = 0.85;   // jeder Sprung verliert 15 % Schaden
const SLOW_TICKS = 20;        // Frost wirkt 2 s
const ARMOR_FLOOR = 0.25;     // Panzerung lässt mindestens 25 % durch

/** Preis für den Schritt von Stufe `level` auf `level + 1` (null = Höchststufe). */
function upgradeCost(type, level) {
    if (level >= MAX_LEVEL) return null;
    return Math.round((TOWERS[type].cost * UPGRADE_FACTORS[level - 1]) / 5) * 5;
}

/**
 * Gegner. hp ist ein Faktor auf die Grund-Lebenspunkte der Welle, speed in
 * Feldern pro Sekunde, gap = Ticks bis zum nächsten Gegner der Welle.
 */
const ENEMIES = Object.freeze({
    laeufer: { name: "Läufer", hp: 1, speed: 1.15, armor: 0, bounty: 3, lives: 1, gap: 8, size: 0.26, color: "#e53935" },
    flitzer: { name: "Flitzer", hp: 0.5, speed: 2.0, armor: 0, bounty: 2, lives: 1, gap: 6, size: 0.22, color: "#fdd835" },
    panzer: { name: "Panzer", hp: 2.6, speed: 0.7, armor: 1, bounty: 6, lives: 1, gap: 13, size: 0.32, color: "#6d4c41" },
    schwarm: { name: "Schwarm", hp: 0.3, speed: 1.35, armor: 0, bounty: 1, lives: 1, gap: 3, size: 0.17, color: "#7cb342" },
    koloss: { name: "Koloss", hp: 11, speed: 0.55, armor: 2, bounty: 60, lives: 5, gap: 20, size: 0.45, color: "#5e35b1", boss: true }
});

const DIFFICULTIES = Object.freeze({
    leicht: { name: "Leicht", hp: 0.75, speed: 0.92, gold: 1.15 },
    mittel: { name: "Mittel", hp: 1, speed: 1, gold: 1 },
    schwer: { name: "Schwer", hp: 1.4, speed: 1.08, gold: 0.85 }
});
const WAVE_OPTIONS = Object.freeze([10, 20, 30, 0]); // 0 = endlos

const BASE_HP = 30;
const HP_GROWTH = 1.16;
const ENDLESS_FROM = 30;
const ENDLESS_GROWTH = 1.06;
const START_GOLD = 250;
const START_LIVES = 20;
const waveBonus = wave => 25 + 4 * wave;

/** Lebenspunkte eines Gegners mit Faktor 1 in Welle `wave`. */
function waveHp(wave, difficulty) {
    const extra = wave > ENDLESS_FROM ? ENDLESS_GROWTH ** (wave - ENDLESS_FROM) : 1;
    return BASE_HP * HP_GROWTH ** (wave - 1) * DIFFICULTIES[difficulty].hp * extra;
}

/** Panzerung (fester Abzug je Treffer) wächst stufenweise mit der Welle. */
function armorFor(type, wave) {
    const base = ENEMIES[type].armor;
    if (!base) return 0;
    return type === "koloss" ? 4 + 2 * Math.floor(wave / 10) : 3 + 2 * Math.floor(wave / 5);
}

/** Kopfgeld wächst langsamer als die Lebenspunkte. */
function bountyFor(type, wave) {
    return Math.round(ENEMIES[type].bounty * (1 + 0.04 * (wave - 1)));
}

/**
 * Zusammensetzung einer Welle als Liste von Gegnertypen (Reihenfolge = Ankunft).
 * Feste Formel nach Wellennummer – funktioniert für beliebig viele Wellen.
 */
function waveList(wave) {
    const count = Math.min(24, 8 + Math.floor(wave / 2));
    const list = [];
    const add = (type, n) => {
        for (let i = 0; i < n; i++) list.push(type);
    };
    if (wave % 10 === 0) {
        add("laeufer", Math.ceil(count / 2));
        add("koloss", Math.max(1, Math.floor(wave / 20) + (wave >= 40 ? 1 : 0)));
        add("flitzer", Math.ceil(count / 4));
        return list;
    }
    if (wave <= 3) {
        add("laeufer", count);
        return list;
    }
    switch (wave % 5) {
        case 4: // Flitzer-Welle
            add("laeufer", Math.floor(count / 3));
            add("flitzer", Math.ceil(count * 1.1));
            break;
        case 2: // Schwarm
            add("schwarm", Math.round(count * 1.4));
            add("laeufer", Math.floor(count / 4));
            break;
        case 3: // Panzer-Mischung (ab Welle 8 mehr Panzer)
            for (let i = 0; i < count; i++) list.push(i % (wave >= 8 ? 2 : 3) === 0 ? "panzer" : "laeufer");
            break;
        default: // gemischt
            for (let i = 0; i < count; i++) list.push(i % 4 === 3 ? "flitzer" : "laeufer");
            if (wave >= 11) add("panzer", Math.floor(wave / 10));
    }
    return list;
}

module.exports = {
    TOWERS, TOWER_IDS, UPGRADE_FACTORS, MAX_LEVEL, SELL_RATE, CHAIN_JUMP, CHAIN_FALLOFF, SLOW_TICKS, ARMOR_FLOOR,
    ENEMIES, DIFFICULTIES, WAVE_OPTIONS, BASE_HP, HP_GROWTH, ENDLESS_FROM, ENDLESS_GROWTH, START_GOLD, START_LIVES,
    upgradeCost, waveHp, armorFor, bountyFor, waveList, waveBonus
};

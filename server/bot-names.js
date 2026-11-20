"use strict";

/**
 * Namen für Bots: zufällige deutsche Vornamen mit vorangestelltem 🤖.
 *
 * Das 🤖 ist Teil des Namens, damit Bots überall – Platzkarten, Protokoll,
 * Ranglisten, Spielkarten – sofort von echten Spielern zu unterscheiden sind,
 * ohne dass jedes Spiel es selbst voranstellen muss.
 *
 * Verwendung in einem Spiel (games/<id>/game.js):
 *   const { pickBotNames } = require("../../server/bot-names");
 *   const names = pickBotNames(botCount, humans.map(h => h.name));
 */

const crypto = require("crypto");

const BOT_PREFIX = "🤖 ";

/** Gängige deutsche Vornamen, höchstens 7 Zeichen (passen auf die Revierkampf-Karte). */
const FIRST_NAMES = Object.freeze([
    "Anna", "Lena", "Mia", "Emma", "Hannah", "Lea", "Sophie", "Marie", "Clara", "Lina",
    "Ella", "Laura", "Julia", "Sarah", "Lisa", "Nina", "Paula", "Greta", "Frieda", "Ida",
    "Jana", "Katrin", "Sabine", "Petra", "Heike", "Anja", "Silke", "Ute", "Maren", "Tanja",
    "Paul", "Jonas", "Lukas", "Felix", "Leon", "Max", "Ben", "Finn", "Elias", "Noah",
    "Moritz", "Jakob", "Emil", "Anton", "Theo", "Karl", "Oskar", "David", "Tim", "Jan",
    "Thomas", "Michael", "Stefan", "Andreas", "Markus", "Frank", "Jürgen", "Uwe", "Dirk", "Sven"
]);

/**
 * Liefert `count` verschiedene, zufällige Bot-Namen wie "🤖 Lena".
 * Vornamen, die schon vergeben sind (z. B. echte Spieler), werden ausgelassen.
 * @param {number} count
 * @param {string[]} [takenNames]
 * @returns {string[]}
 */
function pickBotNames(count, takenNames = []) {
    const taken = new Set(takenNames.map(name => name.trim().toLowerCase()));
    const pool = FIRST_NAMES.filter(name => !taken.has(name.toLowerCase()));

    // Teilweises Fisher-Yates-Mischen: die ersten `count` Einträge sind zufällig gewählt.
    const picked = Math.min(count, pool.length);
    for (let i = 0; i < picked; i++) {
        const j = crypto.randomInt(i, pool.length);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const names = pool.slice(0, picked).map(name => BOT_PREFIX + name);

    // Nur theoretisch nötig (mehr Bots als freie Namen): durchnummerieren.
    for (let i = names.length; i < count; i++) names.push(`${BOT_PREFIX}Bot ${i + 1}`);
    return names;
}

module.exports = { pickBotNames, BOT_PREFIX, FIRST_NAMES };

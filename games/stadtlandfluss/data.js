"use strict";

/**
 * Stadt-Land-Fluss – Daten und Grenzen.
 */

/** Vorauswahl der Kategorien (der Host kann eigene ergänzen). */
const PRESET_CATEGORIES = Object.freeze([
    "Stadt", "Land", "Fluss", "Tier", "Pflanze", "Beruf", "Vorname", "Essen & Trinken",
    "Sportart", "Hobby", "Gegenstand im Haushalt", "Musikinstrument", "Körperteil",
    "Film oder Serie", "Ausrede fürs Zuspätkommen"
]);
const DEFAULT_CATEGORIES = Object.freeze(["Stadt", "Land", "Fluss", "Tier", "Beruf", "Vorname"]);

/** Buchstaben, die gezogen werden können (ohne C, Q, X, Y). */
const LETTERS = Object.freeze("ABDEFGHIJKLMNOPRSTUVWZ".split(""));

const LIMITS = Object.freeze({
    minCategories: 3,
    maxCategories: 10,
    categoryLength: 24,
    answerLength: 40,
    minPlayers: 2,
    maxPlayers: 8
});

const ROUND_OPTIONS = Object.freeze([3, 5, 8]);
const SECONDS_OPTIONS = Object.freeze([60, 90, 120, 180]);
const DEFAULT_ROUNDS = 5;
const DEFAULT_SECONDS = 90;

/** Punkte je Kategorie. */
const POINTS = Object.freeze({ alone: 20, unique: 10, shared: 5 });

module.exports = {
    PRESET_CATEGORIES, DEFAULT_CATEGORIES, LETTERS, LIMITS, ROUND_OPTIONS, SECONDS_OPTIONS,
    DEFAULT_ROUNDS, DEFAULT_SECONDS, POINTS
};

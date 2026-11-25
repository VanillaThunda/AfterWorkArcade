"use strict";

/**
 * Stadt-Land-Fluss – Regeln als reine Funktionen.
 *
 * normalize(text)            Vergleichsform: klein, ä→ae, ß→ss, ohne Satzzeichen/Leerzeichen
 * initialOf(text)            Anfangsbuchstabe (Ä/Ö/Ü zählen als A/O/U), "" wenn keiner
 * autoInvalid(text, letter)  "empty" | "letter" | null
 * isRejected(doubts, voters) mehr als die Hälfte der anderen zweifelt
 * scoreCategory(entries)     Punkte einer Kategorie: 20 einzige gültige, 10 einmalig, 5 doppelt
 */

const { POINTS } = require("./data");

const UMLAUTS = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

function normalize(text) {
    return String(text ?? "")
        .toLowerCase()
        .replace(/[äöüß]/g, ch => UMLAUTS[ch])
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")       // Akzente (é → e)
        .replace(/[^a-z0-9]/g, "");
}

function initialOf(text) {
    const first = String(text ?? "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-zäöüß]/i);
    if (!first) return "";
    const ch = first[0].toUpperCase();
    return ch === "ß" ? "S" : ch;
}

/** Automatisch ungültig? "empty" (nichts eingetragen), "letter" (falscher Anfangsbuchstabe) oder null. */
function autoInvalid(text, letter) {
    if (!String(text ?? "").trim() || !normalize(text)) return "empty";
    return initialOf(text) === letter ? null : "letter";
}

/**
 * Abgelehnt, wenn mehr als die Hälfte der anderen zweifelt.
 * voters = Zahl der anderen aktiven Spieler (ohne den Antwortenden).
 */
function isRejected(doubts, voters) {
    return voters > 0 && doubts * 2 > voters;
}

/**
 * Punkte einer Kategorie.
 * entries: [{ id, text, valid }] → { [id]: punkte }
 */
function scoreCategory(entries) {
    const valid = entries.filter(e => e.valid);
    const counts = new Map();
    for (const e of valid) {
        const key = normalize(e.text);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const points = {};
    for (const e of entries) {
        if (!e.valid) points[e.id] = 0;
        else if (valid.length === 1) points[e.id] = POINTS.alone;
        else points[e.id] = counts.get(normalize(e.text)) > 1 ? POINTS.shared : POINTS.unique;
    }
    return points;
}

module.exports = { normalize, initialOf, autoInvalid, isRejected, scoreCategory };

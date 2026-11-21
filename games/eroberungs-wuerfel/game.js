"use strict";

/**
 * Eroberungs-Würfel – Server-Teil.
 *
 * Ablauf einer Runde:
 *  1. Angreifer würfelt mit 1–3 Würfeln, Verteidiger mit 1–2 Würfeln
 *     (Reihenfolge egal, jede Seite darf pro Runde einmal würfeln).
 *  2. Sobald beide gewürfelt haben, wird automatisch ausgewertet:
 *     Die Würfel werden absteigend sortiert und paarweise verglichen
 *     (höchster gegen höchsten usw.). Bei Gleichstand gewinnt der Verteidiger.
 *     Pro verlorenem Vergleich verliert die jeweilige Seite eine Armee.
 *  3. Der nächste Wurf (oder die Aktion "new-round") startet eine neue Runde.
 *
 * Gewürfelt wird ausschließlich auf dem Server, damit niemand schummeln kann.
 * Jedes Lobby-Mitglied darf für jede Seite würfeln.
 */

/** Maximale Würfelanzahl je Seite nach den klassischen Eroberungsregeln. */
const MAX_DICE = Object.freeze({ attacker: 3, defender: 2 });

const SIDE_LABELS = Object.freeze({ attacker: "Angreifer", defender: "Verteidiger" });

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function createEmptySide() {
    return { dice: [], rolledBy: null };
}

/** Würfelt `count` Würfel und sortiert sie absteigend. */
function rollDice(count) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1)
        .sort((a, b) => b - a);
}

/**
 * Vergleicht die (absteigend sortierten) Würfel paarweise.
 * @returns {{comparisons: {attacker: number, defender: number, winner: string}[],
 *            attackerLosses: number, defenderLosses: number}}
 */
function evaluateBattle(attackerDice, defenderDice) {
    const pairCount = Math.min(attackerDice.length, defenderDice.length);
    const comparisons = [];

    for (let i = 0; i < pairCount; i++) {
        const attacker = attackerDice[i];
        const defender = defenderDice[i];
        // Bei Gleichstand gewinnt der Verteidiger.
        const winner = attacker > defender ? "attacker" : "defender";
        comparisons.push({ attacker, defender, winner });
    }

    return {
        comparisons,
        attackerLosses: comparisons.filter(c => c.winner === "defender").length,
        defenderLosses: comparisons.filter(c => c.winner === "attacker").length
    };
}

/** Leert beide Seiten und erhöht den Rundenzähler. */
function startNewRound(state) {
    return {
        ...state,
        round: state.round + 1,
        attacker: createEmptySide(),
        defender: createEmptySide(),
        result: null
    };
}

/** Verarbeitet die Aktion { type: "roll", side, count }. */
function handleRoll(state, action, player) {
    const { side } = action;
    if (!Object.hasOwn(MAX_DICE, side)) {
        throw new Error("Unbekannte Seite.");
    }

    const count = Number(action.count);
    const max = MAX_DICE[side];
    if (!Number.isInteger(count) || count < 1 || count > max) {
        throw new Error(`Der ${SIDE_LABELS[side]} darf mit 1 bis ${max} Würfeln werfen.`);
    }

    // Ist die vorige Runde bereits ausgewertet, beginnt automatisch eine neue.
    const base = state.result ? startNewRound(state) : state;

    if (base[side].dice.length > 0) {
        throw new Error(`Der ${SIDE_LABELS[side]} hat in dieser Runde bereits gewürfelt.`);
    }

    const next = {
        ...base,
        [side]: { dice: rollDice(count), rolledBy: player.name }
    };

    if (next.attacker.dice.length > 0 && next.defender.dice.length > 0) {
        next.result = evaluateBattle(next.attacker.dice, next.defender.dice);
    }

    return next;
}

// ---------------------------------------------------------------------------
// Plugin-Schnittstelle (siehe dokumentation.md)
// ---------------------------------------------------------------------------

module.exports = {
    meta: {
        id: "eroberungs-wuerfel", // muss dem Ordnernamen entsprechen
        name: "Eroberungs-Würfel",
        description: "Würfelhelfer für Brettspiel-Abende: Angreifer und Verteidiger wählen ihre Würfelzahl und würfeln. Die Auswertung nach den klassischen Eroberungsregeln (höchste Würfel paarweise vergleichen, bei Gleichstand gewinnt der Verteidiger) erfolgt automatisch – alle sehen das Ergebnis sofort.",
        minPlayers: 1,
        maxPlayers: 8
    },

    /** Startzustand beim Auswählen des Spiels. */
    createState() {
        return {
            round: 1,
            maxDice: MAX_DICE, // wird an den Client geschickt → Buttons passen immer zu den Regeln
            attacker: createEmptySide(),
            defender: createEmptySide(),
            result: null
        };
    },

    /**
     * Verarbeitet eine Spieleraktion.
     * @param {object} state   aktueller Zustand
     * @param {object} action  vom Client gesendete Aktion
     * @param {{id: string, name: string}} player  ausführender Spieler
     * @returns {object} neuer Zustand
     */
    handleAction(state, action, player) {
        switch (action.type) {
            case "roll":
                return handleRoll(state, action, player);
            case "new-round":
                return startNewRound(state);
            default:
                throw new Error("Unbekannte Aktion.");
        }
    }
};

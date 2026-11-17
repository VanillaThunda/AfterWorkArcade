"use strict";

/**
 * VORLAGE für ein neues Spiel/Tool – Server-Teil.
 *
 * So geht's:
 *  1. Diesen Ordner "_vorlage" kopieren und umbenennen, z. B. in "mein-spiel"
 *     (nur Kleinbuchstaben, Ziffern und Bindestriche).
 *  2. Unten meta.id auf denselben Namen setzen und meta.name anpassen.
 *  3. createState() und handleAction() mit der eigenen Spiellogik füllen.
 *  4. public/client.js für die Darstellung anpassen.
 *  5. Server neu starten – das Spiel erscheint automatisch in der Auswahl.
 *
 * Ordner, die mit "_" beginnen, werden vom Server ignoriert – diese Vorlage
 * wird also nie selbst geladen.
 *
 * Beispiel-Logik: ein gemeinsamer Klick-Zähler.
 */

module.exports = {
    meta: {
        id: "mein-spiel",         // muss exakt dem Ordnernamen entsprechen
        name: "Mein Spiel",       // Anzeigename in der Spielauswahl
        description: "Kurze Beschreibung für die Spielauswahl.",
        minPlayers: 1,            // optional, Standard 1
        maxPlayers: 8             // optional, Standard unbegrenzt
    },

    /**
     * Wird aufgerufen, wenn der Host das Spiel startet.
     * @param {{players: {id: string, name: string}[]}} context
     * @returns {object} Startzustand – muss sich als JSON übertragen lassen
     */
    createState({ players }) {
        return {
            count: 0,
            lastClickedBy: null,
            playerNames: players.map(player => player.name)
        };
    },

    /**
     * Wird bei jeder Aktion eines Spielers aufgerufen.
     * - Gibt den NEUEN Zustand zurück → wird an alle Mitglieder verteilt.
     * - Wirft bei ungültigen Aktionen einen Error → Meldung erscheint beim Spieler.
     */
    handleAction(state, action, player) {
        if (action.type !== "click") {
            throw new Error("Unbekannte Aktion.");
        }
        return { ...state, count: state.count + 1, lastClickedBy: player.name };
    },

    // Optional: auf Spieler reagieren, die während des Spiels kommen oder gehen.
    // Rückgabe: neuer Zustand oder undefined (= unverändert).
    onPlayerJoin(state, player) {
        return { ...state, playerNames: [...state.playerNames, player.name] };
    },

    onPlayerLeave(state, player) {
        return { ...state, playerNames: state.playerNames.filter(name => name !== player.name) };
    }
};

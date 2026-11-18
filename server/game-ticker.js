"use strict";

/**
 * Spiel-Takt für Echtzeitspiele.
 *
 * Spiele können optional eine Funktion tick(state, context) exportieren.
 * Sie wird für jede Lobby, in der das Spiel läuft, regelmäßig aufgerufen
 * (Abstand: meta.tickMs, Standard 200 ms). Gibt tick() einen Zustand zurück,
 * wird er übernommen und an alle Lobby-Mitglieder verteilt; bei undefined
 * passiert nichts (kein unnötiger Datenverkehr).
 *
 * Es gibt nur EINEN Timer für alle Lobbys. Der Zeitpunkt des letzten Ticks wird
 * pro laufendem Spiel (lobby.game) in einer WeakMap gemerkt – endet das Spiel
 * oder wird die Lobby gelöscht, verschwindet der Eintrag automatisch.
 */

const lobbies = require("./lobbies");
const gameRegistry = require("./game-registry");
const sync = require("./sync");

/** Wie oft geprüft wird, ob ein Spiel einen Tick braucht. */
const CHECK_INTERVAL_MS = 25;

/** @type {WeakMap<object, number>} lobby.game → Zeitpunkt des letzten Ticks */
const lastTicks = new WeakMap();

function runTicks() {
    const now = Date.now();

    for (const lobby of lobbies.listAll()) {
        const game = lobby.game;
        if (!game) continue;

        const plugin = gameRegistry.getGame(game.id);
        if (!plugin || typeof plugin.tick !== "function") continue;

        const last = lastTicks.get(game);
        if (last === undefined) {
            lastTicks.set(game, now); // erster Tick erst nach einem vollen Intervall
            continue;
        }

        const dtMs = now - last;
        if (dtMs < gameRegistry.getTickMs(plugin)) continue;
        lastTicks.set(game, now);

        try {
            const newState = plugin.tick(game.state, { now, dtMs, hostId: lobby.hostId });
            if (newState !== undefined && lobby.game === game) {
                game.state = newState;
                sync.pushGameState(lobby);
            }
        } catch (err) {
            console.error(`[Spiele] Fehler in ${game.id}.tick:`, err);
        }
    }
}

/** Startet den Spiel-Takt (einmal beim Serverstart). */
function startGameTicker() {
    const timer = setInterval(runTicks, CHECK_INTERVAL_MS);
    timer.unref(); // hält den Node-Prozess nicht künstlich am Leben
}

module.exports = { startGameTicker };

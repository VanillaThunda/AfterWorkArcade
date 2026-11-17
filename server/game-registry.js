"use strict";

/**
 * Game-Registry: findet und lädt alle Spiele/Tools beim Serverstart.
 *
 * Jedes Spiel liegt in einem eigenen Ordner unter games/:
 *
 *   games/<spiel-id>/game.js          → Server-Teil (Regeln, Zustand)
 *   games/<spiel-id>/public/client.js → Client-Teil (Darstellung im Browser)
 *
 * Neue Spiele werden automatisch erkannt – am Kern muss nichts geändert
 * werden. Ordner, die mit "_" beginnen (z. B. "_vorlage"), werden ignoriert.
 * Details zur Schnittstelle: siehe dokumentation.md, Abschnitt "Neues Spiel hinzufügen".
 */

const fs = require("fs");
const path = require("path");

/** Erlaubte Zeichen für Spiel-IDs (werden Teil der URL). */
const GAME_ID_PATTERN = /^[a-z0-9-]+$/;

/** @type {Map<string, {plugin: object, publicDir: string}>} */
const games = new Map();

/**
 * Prüft, ob ein Spiel-Modul die Mindest-Schnittstelle erfüllt.
 * @throws {Error} mit verständlicher Beschreibung des Problems
 */
function validatePlugin(plugin, folderName) {
    const meta = plugin && plugin.meta;

    if (!meta || typeof meta.id !== "string" || typeof meta.name !== "string") {
        throw new Error("meta.id und meta.name müssen als Text angegeben sein.");
    }
    if (meta.id !== folderName) {
        throw new Error(`meta.id ("${meta.id}") muss dem Ordnernamen ("${folderName}") entsprechen.`);
    }
    if (!GAME_ID_PATTERN.test(meta.id)) {
        throw new Error("meta.id darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.");
    }
    if (typeof plugin.createState !== "function" || typeof plugin.handleAction !== "function") {
        throw new Error("createState() und handleAction() müssen exportiert werden.");
    }
}

/**
 * Lädt alle Spiele aus dem angegebenen Verzeichnis.
 * Fehlerhafte Spiele werden übersprungen und im Log gemeldet,
 * damit ein einzelnes kaputtes Spiel nicht den ganzen Server stoppt.
 */
function loadGames(gamesDir) {
    const entries = fs.readdirSync(gamesDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith("_")) continue;

        const gameDir = path.join(gamesDir, entry.name);
        try {
            const plugin = require(path.join(gameDir, "game.js"));
            validatePlugin(plugin, entry.name);

            games.set(plugin.meta.id, {
                plugin,
                publicDir: path.join(gameDir, "public")
            });
            console.log(`[Spiele] Geladen: ${plugin.meta.name} (${plugin.meta.id})`);
        } catch (err) {
            console.error(`[Spiele] "${entry.name}" konnte nicht geladen werden: ${err.message}`);
        }
    }

    if (games.size === 0) {
        console.warn("[Spiele] Es wurden keine Spiele gefunden.");
    }
}

/** Liefert das Spiel-Modul zu einer ID oder null. */
function getGame(gameId) {
    return games.get(gameId)?.plugin ?? null;
}

/** Ordner mit den Browser-Dateien eines Spiels oder null. */
function getPublicDir(gameId) {
    return games.get(gameId)?.publicDir ?? null;
}

/** Liste aller Spiele für die Auswahl im Client. */
function listGames() {
    return [...games.values()].map(({ plugin }) => ({
        id: plugin.meta.id,
        name: plugin.meta.name,
        description: plugin.meta.description ?? "",
        minPlayers: plugin.meta.minPlayers ?? 1,
        maxPlayers: plugin.meta.maxPlayers ?? null
    }));
}

module.exports = {
    loadGames,
    getGame,
    getPublicDir,
    listGames
};

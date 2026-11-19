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

/**
 * Vorschaubild für die Spielauswahl: games/<id>/public/preview.<endung>.
 * Gesucht wird in dieser Reihenfolge; empfohlen ist 16:10, z. B. 640×400 px.
 */
const PREVIEW_FILES = ["preview.webp", "preview.png", "preview.jpg", "preview.svg"];

/** @type {Map<string, {plugin: object, publicDir: string, preview: string|null}>} */
const games = new Map();

/** URL des Vorschaubilds eines Spiels oder null, wenn keines vorhanden ist. */
function findPreview(publicDir, gameId) {
    const file = PREVIEW_FILES.find(name => fs.existsSync(path.join(publicDir, name)));
    return file ? `/games/${gameId}/${file}` : null;
}

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
    if (plugin.tick !== undefined && typeof plugin.tick !== "function") {
        throw new Error("tick muss eine Funktion sein (oder ganz weggelassen werden).");
    }
    if (plugin.viewFor !== undefined && typeof plugin.viewFor !== "function") {
        throw new Error("viewFor muss eine Funktion sein (oder ganz weggelassen werden).");
    }
    if (meta.tickMs !== undefined && !(Number.isFinite(meta.tickMs) && meta.tickMs >= MIN_TICK_MS)) {
        throw new Error(`meta.tickMs muss eine Zahl ab ${MIN_TICK_MS} sein.`);
    }
}

/** Kleinster erlaubter Takt für tick() in Millisekunden. */
const MIN_TICK_MS = 50;

/** Standard-Takt, wenn ein Spiel tick() hat, aber kein meta.tickMs angibt. */
const DEFAULT_TICK_MS = 200;

/** Takt eines Spiels in ms (nur sinnvoll, wenn es tick() hat). */
function getTickMs(plugin) {
    return plugin.meta.tickMs ?? DEFAULT_TICK_MS;
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

            const publicDir = path.join(gameDir, "public");
            games.set(plugin.meta.id, {
                plugin,
                publicDir,
                preview: findPreview(publicDir, plugin.meta.id)
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

/** Liste aller Spiele für die Auswahl im Client (alphabetisch nach Name). */
function listGames() {
    return [...games.values()]
        .map(({ plugin, preview }) => ({
            id: plugin.meta.id,
            name: plugin.meta.name,
            description: plugin.meta.description ?? "",
            minPlayers: plugin.meta.minPlayers ?? 1,
            maxPlayers: plugin.meta.maxPlayers ?? null,
            preview
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

module.exports = {
    loadGames,
    getGame,
    getPublicDir,
    listGames,
    getTickMs
};

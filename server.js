"use strict";

/**
 * AfterWork Arcade – Einstiegspunkt des Servers.
 *
 * Start:   node server.js
 * Aufruf:  http://<IP-des-Servers>:3000
 *
 * Diese Datei erstellt nur den HTTP-Server und verteilt eingehende Anfragen:
 *   /events          → Echtzeit-Stream (Server-Sent Events)
 *   /api/...         → API (Login, Lobbys, Chat, Spiele)
 *   /games/<id>/...  → Browser-Dateien eines Spiels (aus games/<id>/public)
 *   alles andere     → statische Dateien aus public/
 */

const http = require("http");
const path = require("path");

const config = require("./server/config");
const api = require("./server/api");
const eventHub = require("./server/event-hub");
const gameRegistry = require("./server/game-registry");
const { startGameTicker } = require("./server/game-ticker");
const { getLanUrls } = require("./server/network");
const { version } = require("./package.json");
const { sendError, sendText, serveStatic } = require("./server/http-utils");

const PUBLIC_DIR = path.join(__dirname, "public");
const GAMES_DIR = path.join(__dirname, "games");

/**
 * Liefert die Browser-Dateien eines Spiels aus.
 * Beispiel: /games/eroberungs-wuerfel/client.js → games/eroberungs-wuerfel/public/client.js
 * Der Server-Teil (game.js) ist dadurch von außen nicht erreichbar.
 */
function serveGameFile(req, res, pathname) {
    const [, , gameId, ...rest] = pathname.split("/"); // ["", "games", "<id>", ...]
    const publicDir = gameRegistry.getPublicDir(gameId);

    if (!publicDir || rest.length === 0) {
        sendText(res, 404, "Nicht gefunden");
        return;
    }
    return serveStatic(req, res, publicDir, "/" + rest.join("/"));
}

/** Zentrale Anfrage-Verteilung. */
async function handleRequest(req, res) {
    // Query-String abtrennen, z. B. "/app.js?v=2" → "/app.js"
    const { pathname, searchParams } = new URL(req.url, "http://localhost");

    try {
        if (pathname === "/events" && req.method === "GET") {
            api.handleEventStream(req, res, searchParams);
            return;
        }
        if (pathname.startsWith("/api/")) {
            await api.handleApiRequest(req, res, pathname);
            return;
        }
        if (pathname.startsWith("/games/")) {
            await serveGameFile(req, res, pathname);
            return;
        }
        await serveStatic(req, res, PUBLIC_DIR, pathname === "/" ? "/index.html" : pathname);
    } catch (err) {
        console.error("[Server] Unerwarteter Fehler:", err);
        if (!res.headersSent) sendError(res, 500, "Interner Serverfehler.");
    }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

gameRegistry.loadGames(GAMES_DIR);
eventHub.startHeartbeat(config.HEARTBEAT_INTERVAL_MS);
startGameTicker();

const server = http.createServer(handleRequest);

server.listen(config.PORT, config.HOST, () => {
    console.log(`AfterWork Arcade v${version} läuft auf Port ${config.PORT}`);
    console.log(`  Lokal:    http://localhost:${config.PORT}`);
    for (const url of getLanUrls()) {
        console.log(`  Netzwerk: ${url}`);
    }
    console.log("Beenden mit Strg+C.");
});

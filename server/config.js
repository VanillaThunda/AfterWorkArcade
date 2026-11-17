"use strict";

/**
 * Zentrale Konfiguration des Servers.
 *
 * Alle Grenzwerte und Einstellungen stehen hier an einer Stelle, damit sie
 * leicht angepasst werden können, ohne den restlichen Code zu durchsuchen.
 * PORT und HOST lassen sich zusätzlich über Umgebungsvariablen setzen,
 * z. B.:  PORT=8080 node server.js
 */
module.exports = Object.freeze({
    // --- Netzwerk ---------------------------------------------------------
    PORT: Number(process.env.PORT) || 3000,
    HOST: process.env.HOST || "0.0.0.0", // 0.0.0.0 = im gesamten LAN erreichbar

    // --- HTTP ---------------------------------------------------------------
    MAX_BODY_BYTES: 16 * 1024, // maximale Größe eines JSON-Requests (16 KB)

    // --- User ---------------------------------------------------------------
    USERNAME_MIN_LENGTH: 2,
    USERNAME_MAX_LENGTH: 20,

    // --- Lobbys -------------------------------------------------------------
    LOBBY_NAME_MAX_LENGTH: 30,
    LOBBY_PASSWORD_MAX_LENGTH: 50,
    LOBBY_MAX_MEMBERS: 8,
    LOBBY_CODE_LENGTH: 6,

    // --- Chat ---------------------------------------------------------------
    CHAT_MESSAGE_MAX_LENGTH: 300,
    CHAT_HISTORY_SIZE: 50, // so viele Nachrichten pro Chat werden aufbewahrt

    // --- Echtzeit-Verbindung (Server-Sent Events) ---------------------------
    // Regelmäßiger Ping, damit Proxys (z. B. Synology Reverse Proxy) die
    // Verbindung nicht wegen Inaktivität schließen.
    HEARTBEAT_INTERVAL_MS: 25 * 1000,

    // Wie lange ein User nach Verbindungsabbruch angemeldet bleibt.
    // Ein Reload der Seite oder ein kurzer WLAN-Aussetzer wirft so niemanden
    // aus seiner Lobby. Per Umgebungsvariable überschreibbar (genutzt vom Test).
    RECONNECT_GRACE_MS: Number(process.env.RECONNECT_GRACE_MS) || 30 * 1000
});

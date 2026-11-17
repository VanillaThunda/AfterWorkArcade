"use strict";

/**
 * Event-Hub: verwaltet die Echtzeit-Verbindungen (Server-Sent Events, SSE).
 *
 * Jeder Browser-Tab öffnet genau eine SSE-Verbindung (GET /events). Darüber
 * schickt der Server Nachrichten im Format:
 *
 *     event: <typ>
 *     data: <JSON>
 *
 * Ein User kann mehrere Verbindungen haben (z. B. zwei Tabs), deshalb wird
 * pro User-ID eine Menge (Set) von Verbindungen gespeichert.
 */

/** @type {Map<string, Set<import("http").ServerResponse>>} userId → offene Verbindungen */
const connections = new Map();

/**
 * Öffnet einen SSE-Stream für einen User.
 *
 * @param {string} userId
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {(userId: string) => void} onLastDisconnect
 *        Wird aufgerufen, wenn die letzte Verbindung des Users geschlossen wurde.
 */
function openStream(userId, req, res, onLastDisconnect) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no" // verhindert Pufferung durch nginx-basierte Proxys
    });

    // "retry" sagt dem Browser, nach wie vielen Millisekunden er sich bei
    // einem Abbruch automatisch neu verbinden soll.
    res.write("retry: 3000\n\n");

    if (!connections.has(userId)) {
        connections.set(userId, new Set());
    }
    connections.get(userId).add(res);

    req.on("close", () => {
        const userConnections = connections.get(userId);
        if (!userConnections) return; // bereits per closeUserStreams entfernt

        userConnections.delete(res);
        if (userConnections.size === 0) {
            connections.delete(userId);
            onLastDisconnect(userId);
        }
    });
}

/** Baut eine SSE-Nachricht zusammen. */
function formatEvent(type, data) {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Schreibt sicher in eine Verbindung (ignoriert bereits geschlossene). */
function write(res, text) {
    if (!res.writableEnded && !res.destroyed) {
        res.write(text);
    }
}

/** Sendet ein Event an alle Verbindungen eines Users. */
function sendToUser(userId, type, data) {
    const userConnections = connections.get(userId);
    if (!userConnections) return;

    const message = formatEvent(type, data);
    for (const res of userConnections) write(res, message);
}

/** Sendet ein Event an mehrere User. */
function sendToUsers(userIds, type, data) {
    const message = formatEvent(type, data);
    for (const userId of userIds) {
        const userConnections = connections.get(userId);
        if (!userConnections) continue;
        for (const res of userConnections) write(res, message);
    }
}

/** Sendet ein Event an alle verbundenen User. */
function broadcast(type, data) {
    const message = formatEvent(type, data);
    for (const userConnections of connections.values()) {
        for (const res of userConnections) write(res, message);
    }
}

/** Schließt alle Verbindungen eines Users (z. B. beim Logout). */
function closeUserStreams(userId) {
    const userConnections = connections.get(userId);
    if (!userConnections) return;

    connections.delete(userId); // vor end(), damit onLastDisconnect nicht feuert
    for (const res of userConnections) res.end();
}

/**
 * Startet den Heartbeat: In regelmäßigen Abständen wird ein SSE-Kommentar
 * (": ping") an alle Verbindungen geschickt. Der Browser ignoriert ihn,
 * aber Proxys sehen Datenverkehr und schließen die Verbindung nicht.
 */
function startHeartbeat(intervalMs) {
    const timer = setInterval(() => {
        for (const userConnections of connections.values()) {
            for (const res of userConnections) write(res, ": ping\n\n");
        }
    }, intervalMs);

    timer.unref(); // hält den Node-Prozess nicht künstlich am Leben
}

module.exports = {
    openStream,
    sendToUser,
    sendToUsers,
    broadcast,
    closeUserStreams,
    startHeartbeat
};

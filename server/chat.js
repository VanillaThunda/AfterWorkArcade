"use strict";

/**
 * Chat-Verwaltung für den globalen Chat und die Lobby-Chats.
 *
 * Jeder Chat hat einen "Scope-Key":
 *   "global"            → globaler Chat für alle
 *   "lobby:<lobbyId>"   → Chat einer bestimmten Lobby
 *
 * Pro Chat werden die letzten Nachrichten im Speicher gehalten (Ringpuffer),
 * damit neu hinzukommende User den bisherigen Verlauf sehen.
 */

const crypto = require("crypto");
const config = require("./config");
const { HttpError } = require("./http-utils");

const GLOBAL_SCOPE = "global";

/** @type {Map<string, object[]>} scopeKey → Nachrichten */
const histories = new Map();

/** Scope-Key für den Chat einer Lobby. */
function lobbyScope(lobbyId) {
    return `lobby:${lobbyId}`;
}

/** Der Client unterscheidet nur zwischen "global" und "lobby". */
function toClientScope(scopeKey) {
    return scopeKey === GLOBAL_SCOPE ? "global" : "lobby";
}

/** Speichert eine Nachricht und kürzt den Verlauf auf die konfigurierte Länge. */
function store(scopeKey, message) {
    const history = histories.get(scopeKey) ?? [];
    history.push(message);

    const overflow = history.length - config.CHAT_HISTORY_SIZE;
    if (overflow > 0) history.splice(0, overflow);

    histories.set(scopeKey, history);
}

/**
 * Fügt eine Nachricht eines Users hinzu.
 * @throws {HttpError} bei leerer oder zu langer Nachricht
 * @returns {object} die gespeicherte Nachricht
 */
function addMessage(scopeKey, user, rawText) {
    const text = String(rawText ?? "").trim();

    if (text === "") {
        throw new HttpError(400, "Leere Nachrichten werden nicht gesendet.");
    }
    if (text.length > config.CHAT_MESSAGE_MAX_LENGTH) {
        throw new HttpError(400, `Nachrichten dürfen höchstens ${config.CHAT_MESSAGE_MAX_LENGTH} Zeichen lang sein.`);
    }

    const message = {
        id: crypto.randomUUID(),
        scope: toClientScope(scopeKey),
        system: false,
        userId: user.id,
        userName: user.name,
        text,
        timestamp: Date.now()
    };

    store(scopeKey, message);
    return message;
}

/** Fügt eine Systemnachricht hinzu (z. B. "Anna ist beigetreten."). */
function addSystemMessage(scopeKey, text) {
    const message = {
        id: crypto.randomUUID(),
        scope: toClientScope(scopeKey),
        system: true,
        userId: null,
        userName: null,
        text,
        timestamp: Date.now()
    };

    store(scopeKey, message);
    return message;
}

/** Verlauf eines Chats (älteste Nachricht zuerst). */
function getHistory(scopeKey) {
    return histories.get(scopeKey) ?? [];
}

/** Löscht den Verlauf, z. B. wenn eine Lobby aufgelöst wurde. */
function deleteHistory(scopeKey) {
    histories.delete(scopeKey);
}

module.exports = {
    GLOBAL_SCOPE,
    lobbyScope,
    addMessage,
    addSystemMessage,
    getHistory,
    deleteHistory
};

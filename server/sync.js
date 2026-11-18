"use strict";

/**
 * Sync: verteilt Zustandsänderungen an die verbundenen Clients.
 *
 * Die API ändert den Zustand (User, Lobbys, Chat, Spiele) und ruft danach
 * die passende push-Funktion auf. Hier ist an einer Stelle festgelegt,
 * WELCHES Event mit WELCHEN Daten an WEN geht.
 *
 * Event-Typen (siehe auch dokumentation.md):
 *   online-users   Liste aller angemeldeten User             → alle
 *   lobbies        Liste der öffentlichen Lobbys            → alle
 *   lobby          Details der eigenen Lobby oder null      → Lobby-Mitglieder
 *   chat           eine neue Chat-Nachricht                 → alle bzw. Lobby-Mitglieder
 *   chat-history   kompletter Verlauf eines Chats           → einzelner User
 *   game-state     Zustand des aktiven Spiels oder null     → Lobby-Mitglieder
 */

const eventHub = require("./event-hub");
const users = require("./users");
const lobbies = require("./lobbies");
const chat = require("./chat");
const gameRegistry = require("./game-registry");

function pushOnlineUsers() {
    eventHub.broadcast("online-users", users.listUsers());
}

function pushLobbyList() {
    eventHub.broadcast("lobbies", lobbies.listPublicSummaries());
}

function pushLobby(lobby) {
    eventHub.sendToUsers(lobby.memberIds, "lobby", lobbies.toDetails(lobby));
}

/** Teilt einem User mit, dass er in keiner Lobby (mehr) ist. */
function sendLobbyLeft(userId) {
    eventHub.sendToUser(userId, "lobby", null);
}

/** viewFor-Funktion des aktiven Spiels oder null (= alle sehen denselben Zustand). */
function getViewFor(lobby) {
    if (!lobby.game) return null;
    const plugin = gameRegistry.getGame(lobby.game.id);
    return plugin && typeof plugin.viewFor === "function" ? plugin.viewFor : null;
}

/**
 * Spielzustand für einen bestimmten User. Hat das Spiel einen viewFor-Hook,
 * wird der Zustand für diesen User gefiltert (geheime Infos bleiben auf dem
 * Server). Bei einem Fehler wird nichts verraten: state = null.
 */
function buildGameState(lobby, userId) {
    if (!lobby.game) return null;
    const viewFor = getViewFor(lobby);
    if (!viewFor) return { gameId: lobby.game.id, state: lobby.game.state };

    try {
        return { gameId: lobby.game.id, state: viewFor(lobby.game.state, userId) };
    } catch (err) {
        console.error(`[Spiele] Fehler in ${lobby.game.id}.viewFor:`, err);
        return { gameId: lobby.game.id, state: null };
    }
}

function pushGameState(lobby) {
    if (!getViewFor(lobby)) {
        eventHub.sendToUsers(lobby.memberIds, "game-state", buildGameState(lobby));
        return;
    }
    for (const userId of lobby.memberIds) {
        eventHub.sendToUser(userId, "game-state", buildGameState(lobby, userId));
    }
}

function broadcastChatMessage(message) {
    eventHub.broadcast("chat", message);
}

function sendChatMessage(message, recipientIds) {
    eventHub.sendToUsers(recipientIds, "chat", message);
}

function sendLobbyChatHistory(user, lobby) {
    eventHub.sendToUser(user.id, "chat-history", {
        scope: "lobby",
        messages: chat.getHistory(chat.lobbyScope(lobby.id))
    });
}

/**
 * Schickt einem frisch verbundenen User den kompletten aktuellen Zustand.
 * Dadurch sieht man nach einem Reload sofort wieder alles (inkl. Spielstand).
 */
function sendFullState(user) {
    eventHub.sendToUser(user.id, "online-users", users.listUsers());
    eventHub.sendToUser(user.id, "lobbies", lobbies.listPublicSummaries());
    eventHub.sendToUser(user.id, "chat-history", {
        scope: "global",
        messages: chat.getHistory(chat.GLOBAL_SCOPE)
    });

    const lobby = user.lobbyId ? lobbies.getById(user.lobbyId) : null;
    eventHub.sendToUser(user.id, "lobby", lobby ? lobbies.toDetails(lobby) : null);

    if (lobby) {
        sendLobbyChatHistory(user, lobby);
        eventHub.sendToUser(user.id, "game-state", buildGameState(lobby, user.id));
    }
}

module.exports = {
    pushOnlineUsers,
    pushLobbyList,
    pushLobby,
    sendLobbyLeft,
    pushGameState,
    broadcastChatMessage,
    sendChatMessage,
    sendLobbyChatHistory,
    sendFullState
};

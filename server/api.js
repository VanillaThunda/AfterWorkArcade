"use strict";

/**
 * API-Schicht: nimmt HTTP-Anfragen entgegen, prüft Berechtigungen und
 * verbindet die Module users, lobbies, chat und game-registry miteinander.
 *
 * Ablauf einer Aktion:
 *   1. Browser schickt  POST /api/...  mit Token im Authorization-Header
 *   2. Handler prüft und ändert den Zustand
 *   3. Änderungen werden per Server-Sent Events (sync.js) an alle
 *      betroffenen Clients verteilt – die HTTP-Antwort selbst ist nur
 *      eine kurze Bestätigung ({ ok: true }) oder eine Fehlermeldung.
 */

const config = require("./config");
const { HttpError, readJsonBody, sendJson, sendError } = require("./http-utils");
const eventHub = require("./event-hub");
const users = require("./users");
const lobbies = require("./lobbies");
const chat = require("./chat");
const gameRegistry = require("./game-registry");
const sync = require("./sync");
const { getLanUrls } = require("./network");
const { version } = require("../package.json");

// ===========================================================================
// Hilfsfunktionen
// ===========================================================================

/** Liest das Token aus dem Header "Authorization: Bearer <token>". */
function extractBearerToken(req) {
    const header = req.headers.authorization || "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match ? match[1] : null;
}

/** Liefert die Lobby des Users oder wirft einen Fehler. */
function requireLobby(user) {
    const lobby = user.lobbyId ? lobbies.getById(user.lobbyId) : null;
    if (!lobby) {
        throw new HttpError(409, "Du bist in keiner Lobby.");
    }
    return lobby;
}

/** Wie requireLobby, aber der User muss zusätzlich Host sein. */
function requireHost(user) {
    const lobby = requireLobby(user);
    if (lobby.hostId !== user.id) {
        throw new HttpError(403, "Nur der Host der Lobby darf das.");
    }
    return lobby;
}

/** Schreibt eine Systemnachricht in den Lobby-Chat und verteilt sie. */
function postLobbySystemMessage(lobby, text) {
    const message = chat.addSystemMessage(chat.lobbyScope(lobby.id), text);
    sync.sendChatMessage(message, lobby.memberIds);
}

/**
 * Ruft einen optionalen Hook des aktiven Spiels auf
 * (onPlayerJoin / onPlayerLeave) und übernimmt den zurückgegebenen State.
 */
function runGameHook(lobby, hookName, player) {
    if (!lobby.game) return;

    const plugin = gameRegistry.getGame(lobby.game.id);
    if (!plugin || typeof plugin[hookName] !== "function") return;

    try {
        const newState = plugin[hookName](lobby.game.state, player);
        if (newState !== undefined) lobby.game.state = newState;
    } catch (err) {
        console.error(`[Spiele] Fehler in ${lobby.game.id}.${hookName}:`, err);
    }
}

/** Nimmt einen User in eine Lobby auf und informiert alle Beteiligten. */
function addUserToLobby(user, lobby, joinMessage) {
    lobbies.addMember(lobby, user);
    runGameHook(lobby, "onPlayerJoin", users.toPublicUser(user));

    // Reihenfolge ist wichtig: erst Lobby-Details, dann Verlauf, dann Spielstand.
    // Die Systemnachricht kommt zuletzt, damit sie nicht doppelt erscheint.
    sync.pushLobby(lobby);
    sync.sendLobbyChatHistory(user, lobby);
    sync.pushGameState(lobby);
    sync.pushLobbyList();
    postLobbySystemMessage(lobby, joinMessage);
}

/** Entfernt einen User aus seiner aktuellen Lobby (falls vorhanden). */
function removeUserFromCurrentLobby(user) {
    const lobby = user.lobbyId ? lobbies.getById(user.lobbyId) : null;
    if (!lobby) {
        user.lobbyId = null;
        return;
    }

    const { deleted, newHostId } = lobbies.removeMember(lobby, user);
    sync.sendLobbyLeft(user.id);

    if (deleted) {
        chat.deleteHistory(chat.lobbyScope(lobby.id));
    } else {
        runGameHook(lobby, "onPlayerLeave", users.toPublicUser(user));
        postLobbySystemMessage(lobby, `${user.name} hat die Lobby verlassen.`);

        if (newHostId) {
            const newHost = users.getById(newHostId);
            postLobbySystemMessage(lobby, `${newHost.name} ist jetzt Host der Lobby.`);
        }

        sync.pushLobby(lobby);
        sync.pushGameState(lobby);
    }

    sync.pushLobbyList();
}

/** Meldet einen User vollständig ab (Logout oder abgelaufene Verbindung). */
function endUserSession(user) {
    removeUserFromCurrentLobby(user);
    users.removeUser(user.id);
    eventHub.closeUserStreams(user.id);
    sync.pushOnlineUsers();
}

/**
 * Sucht die Lobby für einen Beitritt – entweder per Code oder per ID.
 * Private Lobbys sind nur per Code erreichbar, auch wenn jemand die ID kennt.
 */
function findLobbyForJoin(body) {
    if (body.code) {
        const lobby = lobbies.findByCode(body.code);
        if (!lobby) throw new HttpError(404, "Keine Lobby mit diesem Code gefunden.");
        return lobby;
    }

    const lobby = lobbies.getById(body.lobbyId);
    if (!lobby || lobby.visibility !== lobbies.VISIBILITY.PUBLIC) {
        throw new HttpError(404, "Lobby nicht gefunden.");
    }
    return lobby;
}

// ===========================================================================
// Handler – jeder bekommt { user, body } und gibt ein Ergebnis-Objekt zurück
// ===========================================================================

/**
 * Allgemeine Server-Infos: Version und LAN-Adressen.
 * Die LAN-Adressen nutzt der Client für Einladungslinks, falls er selbst
 * über "localhost" geöffnet wurde (damit können andere nichts anfangen).
 */
function handleInfo() {
    return { version, lanUrls: getLanUrls() };
}

function handleListGames() {
    return { games: gameRegistry.listGames() };
}

function handleLogin({ body }) {
    const user = users.createUser(body.name);

    // Die Grace-Period läuft ab sofort: Öffnet der Browser nie einen
    // Event-Stream, wird der User automatisch wieder entfernt.
    users.scheduleRemoval(user.id, config.RECONNECT_GRACE_MS, endUserSession);
    sync.pushOnlineUsers();

    return { token: user.token, user: users.toPublicUser(user) };
}

function handleMe({ user }) {
    return { user: users.toPublicUser(user) };
}

function handleLogout({ user }) {
    endUserSession(user);
    return {};
}

function handleCreateLobby({ user, body }) {
    // Erst erstellen (dabei wird validiert), dann die alte Lobby verlassen –
    // so bleibt man bei ungültigen Angaben in seiner bisherigen Lobby.
    const lobby = lobbies.createLobby(body, user);

    removeUserFromCurrentLobby(user);
    addUserToLobby(user, lobby, `${user.name} hat die Lobby erstellt.`);

    return { lobbyId: lobby.id, code: lobby.code };
}

function handleJoinLobby({ user, body }) {
    const lobby = findLobbyForJoin(body);

    if (user.lobbyId === lobby.id) {
        return { lobbyId: lobby.id }; // bereits Mitglied
    }

    if (lobby.password) {
        if (!body.password) {
            throw new HttpError(403, "Diese Lobby ist passwortgeschützt.", "PASSWORD_REQUIRED");
        }
        if (!lobbies.verifyPassword(lobby, body.password)) {
            throw new HttpError(403, "Falsches Passwort.", "WRONG_PASSWORD");
        }
    }

    lobbies.assertHasSpace(lobby); // vor dem Verlassen der alten Lobby prüfen
    removeUserFromCurrentLobby(user);
    addUserToLobby(user, lobby, `${user.name} ist der Lobby beigetreten.`);

    return { lobbyId: lobby.id };
}

function handleLeaveLobby({ user }) {
    removeUserFromCurrentLobby(user);
    return {};
}

function handleSendChat({ user, body }) {
    if (body.scope === "global") {
        const message = chat.addMessage(chat.GLOBAL_SCOPE, user, body.text);
        sync.broadcastChatMessage(message);
    } else if (body.scope === "lobby") {
        const lobby = requireLobby(user);
        const message = chat.addMessage(chat.lobbyScope(lobby.id), user, body.text);
        sync.sendChatMessage(message, lobby.memberIds);
    } else {
        throw new HttpError(400, "Unbekannter Chat-Bereich.");
    }
    return {};
}

function handleSelectGame({ user, body }) {
    const lobby = requireHost(user);

    if (lobby.game) {
        throw new HttpError(409, "Es läuft bereits ein Spiel. Beende es zuerst.");
    }

    const plugin = gameRegistry.getGame(body.gameId);
    if (!plugin) {
        throw new HttpError(404, "Unbekanntes Spiel.");
    }

    const { name, minPlayers = 1, maxPlayers = Infinity } = plugin.meta;
    const playerCount = lobby.memberIds.length;
    if (playerCount < minPlayers) {
        throw new HttpError(400, `„${name}“ benötigt mindestens ${minPlayers} Spieler.`);
    }
    if (playerCount > maxPlayers) {
        throw new HttpError(400, `„${name}“ erlaubt höchstens ${maxPlayers} Spieler.`);
    }

    const players = lobby.memberIds.map(id => users.toPublicUser(users.getById(id)));
    let initialState;
    try {
        initialState = plugin.createState({ players, hostId: lobby.hostId, now: Date.now() });
    } catch (err) {
        console.error(`[Spiele] Fehler in ${plugin.meta.id}.createState:`, err);
        throw new HttpError(500, "Das Spiel konnte nicht gestartet werden.");
    }

    lobby.game = { id: plugin.meta.id, state: initialState };

    postLobbySystemMessage(lobby, `${user.name} hat „${name}“ gestartet.`);
    sync.pushLobby(lobby);
    sync.pushGameState(lobby);
    sync.pushLobbyList();
    return {};
}

function handleEndGame({ user }) {
    const lobby = requireHost(user);
    if (!lobby.game) return {};

    const plugin = gameRegistry.getGame(lobby.game.id);
    const gameName = plugin ? plugin.meta.name : lobby.game.id;
    lobby.game = null;

    postLobbySystemMessage(lobby, `${user.name} hat „${gameName}“ beendet.`);
    sync.pushLobby(lobby);
    sync.pushGameState(lobby);
    sync.pushLobbyList();
    return {};
}

function handleGameAction({ user, body }) {
    const lobby = requireLobby(user);
    if (!lobby.game) {
        throw new HttpError(409, "In dieser Lobby läuft kein Spiel.");
    }

    const plugin = gameRegistry.getGame(lobby.game.id);
    const action = body.action && typeof body.action === "object" ? body.action : {};

    let newState;
    try {
        newState = plugin.handleAction(lobby.game.state, action, users.toPublicUser(user), {
            hostId: lobby.hostId,
            now: Date.now()
        });
    } catch (err) {
        // Spiele melden ungültige Aktionen per throw new Error("…").
        // Die Meldung wird dem Spieler direkt angezeigt.
        throw new HttpError(400, err.message || "Ungültige Spielaktion.");
    }

    if (newState !== undefined) {
        lobby.game.state = newState;
        sync.pushGameState(lobby);
    }
    return {};
}

// ===========================================================================
// Routing
// ===========================================================================

/**
 * Routentabelle: "<METHODE> <PFAD>" → Handler.
 * auth: true bedeutet, dass ein gültiges Token nötig ist.
 */
const routes = {
    "GET /api/info":           { auth: false, handler: handleInfo },
    "GET /api/games":          { auth: false, handler: handleListGames },
    "POST /api/login":         { auth: false, handler: handleLogin },
    "GET /api/me":             { auth: true,  handler: handleMe },
    "POST /api/logout":        { auth: true,  handler: handleLogout },
    "POST /api/lobby/create":  { auth: true,  handler: handleCreateLobby },
    "POST /api/lobby/join":    { auth: true,  handler: handleJoinLobby },
    "POST /api/lobby/leave":   { auth: true,  handler: handleLeaveLobby },
    "POST /api/chat/send":     { auth: true,  handler: handleSendChat },
    "POST /api/game/select":   { auth: true,  handler: handleSelectGame },
    "POST /api/game/end":      { auth: true,  handler: handleEndGame },
    "POST /api/game/action":   { auth: true,  handler: handleGameAction }
};

/** Bearbeitet alle Anfragen unter /api/... */
async function handleApiRequest(req, res, pathname) {
    const route = routes[`${req.method} ${pathname}`];
    if (!route) {
        sendError(res, 404, "Unbekannter API-Endpunkt.");
        return;
    }

    try {
        let user = null;
        if (route.auth) {
            user = users.getByToken(extractBearerToken(req));
            if (!user) {
                throw new HttpError(401, "Nicht angemeldet oder Sitzung abgelaufen.", "UNAUTHORIZED");
            }
        }

        const body = req.method === "POST" ? await readJsonBody(req, config.MAX_BODY_BYTES) : {};
        const result = route.handler({ user, body });
        sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
        if (err instanceof HttpError) {
            sendError(res, err.status, err.message, err.code);
            return;
        }
        console.error("[API] Unerwarteter Fehler:", err);
        sendError(res, 500, "Interner Serverfehler.");
    }
}

/**
 * Öffnet den Echtzeit-Stream (GET /events?token=...).
 * Das Token steht hier in der URL, weil EventSource keine eigenen
 * Header unterstützt.
 */
function handleEventStream(req, res, searchParams) {
    const user = users.getByToken(searchParams.get("token"));
    if (!user) {
        sendError(res, 401, "Nicht angemeldet oder Sitzung abgelaufen.", "UNAUTHORIZED");
        return;
    }

    users.cancelRemoval(user.id);
    eventHub.openStream(user.id, req, res, onLastStreamClosed);
    sync.sendFullState(user);
}

/**
 * Letzte Verbindung eines Users ist weg: Erst nach Ablauf der
 * Grace-Period abmelden – ein Reload soll nicht aus der Lobby werfen.
 */
function onLastStreamClosed(userId) {
    users.scheduleRemoval(userId, config.RECONNECT_GRACE_MS, endUserSession);
}

module.exports = {
    handleApiRequest,
    handleEventStream
};

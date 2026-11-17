/**
 * Einstiegspunkt des Browsers.
 *
 * Aufgaben:
 *  - Anmeldung und Sitzung verwalten (inkl. Wiederanmeldung nach Reload)
 *  - zwischen den Ansichten Login / Übersicht / Lobby wechseln
 *  - Events vom Server (SSE) an die passenden Ansichten verteilen
 *  - Benutzeraktionen an die API weiterreichen und Fehler anzeigen
 */

import { api, getToken, setToken, clearToken, openEventStream } from "./api.js";
import { createChat } from "./chat.js";
import { showToast, askPassword, setConnectionStatus } from "./ui.js";
import { createLoginView } from "./views/login.js";
import { createLobbyListView } from "./views/lobby-list.js";
import { createLobbyRoomView } from "./views/lobby-room.js";

/** Wartezeit, bevor nach einem Verbindungsabbruch erneut verbunden wird. */
const RECONNECT_DELAY_MS = 3000;

/** Zentraler Zustand der Seite. */
const state = {
    me: null,            // eigener User { id, name }
    lobby: null,         // aktuelle Lobby (Details) oder null
    eventSource: null,   // offene EventSource
    reconnectTimer: null,
    pendingJoinCode: null // Code aus einem Einladungslink (?join=CODE)
};

// ===========================================================================
// Ansichten
// ===========================================================================

const viewElements = {
    login: document.getElementById("view-login"),
    overview: document.getElementById("view-overview"),
    lobby: document.getElementById("view-lobby")
};

/** Zeigt genau eine Ansicht an. */
function showView(name) {
    for (const [key, element] of Object.entries(viewElements)) {
        element.hidden = key !== name;
    }
    const loggedIn = name !== "login";
    document.getElementById("sidebar").hidden = !loggedIn;
    document.getElementById("session-info").hidden = !loggedIn;
}

const loginView = createLoginView({ onLogin: login });

const lobbyListView = createLobbyListView({
    onCreate: createLobby,
    onJoin: lobby => joinLobby({ lobbyId: lobby.id }),
    onJoinByCode: code => joinLobby({ code })
});

const lobbyRoomView = createLobbyRoomView({
    onLeave: () => runAction(() => api.leaveLobby()),
    onSelectGame: gameId => runAction(() => api.selectGame(gameId)),
    onEndGame: () => {
        if (confirm("Das aktuelle Spiel für alle beenden?")) {
            runAction(() => api.endGame());
        }
    },
    createGameContext: gameId => ({
        gameId,
        me: state.me,
        getLobby: () => state.lobby,
        sendAction: action => runAction(() => api.gameAction(action))
    })
});

const globalChat = createChat({
    messagesElement: document.getElementById("global-chat-messages"),
    formElement: document.getElementById("global-chat-form"),
    inputElement: document.getElementById("global-chat-input"),
    onSend: text => sendChat("global", text),
    getMe: () => state.me
});

const lobbyChat = createChat({
    messagesElement: document.getElementById("lobby-chat-messages"),
    formElement: document.getElementById("lobby-chat-form"),
    inputElement: document.getElementById("lobby-chat-input"),
    onSend: text => sendChat("lobby", text),
    getMe: () => state.me
});

// ===========================================================================
// Aktionen
// ===========================================================================

/**
 * Führt eine API-Aktion aus und zeigt Fehler als Hinweis an.
 * @returns {Promise<boolean>} true bei Erfolg
 */
async function runAction(apiCall) {
    try {
        await apiCall();
        return true;
    } catch (err) {
        showToast(err.message, "error");
        return false;
    }
}

async function login(name) {
    const { token, user } = await api.login(name); // Fehler zeigt die Login-Ansicht an
    setToken(token);
    startSession(user);
}

async function logout() {
    try {
        await api.logout();
    } catch {
        // Auch wenn der Server nicht erreichbar ist: lokal abmelden.
    }
    endSession();
}

function createLobby(options) {
    return runAction(() => api.createLobby(options));
}

/** Chat senden – wirft bei Fehlern, damit der Chat den Text wiederherstellt. */
async function sendChat(scope, text) {
    try {
        await api.sendChat(scope, text);
    } catch (err) {
        showToast(err.message, "error");
        throw err;
    }
}

/**
 * Tritt einer Lobby bei. Ist sie passwortgeschützt, wird nachgefragt –
 * bei falschem Passwort erneut, bis der Nutzer abbricht.
 *
 * @param {{lobbyId?: string, code?: string}} target
 * @returns {Promise<boolean>} true bei Erfolg
 */
async function joinLobby(target) {
    let password;

    while (true) {
        try {
            await api.joinLobby({ ...target, password });
            return true;
        } catch (err) {
            const needsPassword = err.code === "PASSWORD_REQUIRED" || err.code === "WRONG_PASSWORD";
            if (!needsPassword) {
                showToast(err.message, "error");
                return false;
            }
            if (err.code === "WRONG_PASSWORD") showToast(err.message, "error");

            password = await askPassword();
            if (password === null) return false; // abgebrochen
        }
    }
}

// ===========================================================================
// Sitzung und Echtzeit-Verbindung
// ===========================================================================

/** Handler für die Events vom Server (siehe server/sync.js). */
const eventHandlers = {
    "online-users": renderOnlineUsers,

    "lobbies": lobbies => lobbyListView.render(lobbies),

    "lobby": lobby => {
        const previousLobbyId = state.lobby?.id;
        state.lobby = lobby;

        if (!lobby) {
            lobbyRoomView.reset();
            lobbyChat.clear();
            showView("overview");
            return;
        }

        if (lobby.id !== previousLobbyId) lobbyChat.clear();
        lobbyRoomView.render(lobby, state.me);
        showView("lobby");
    },

    "chat": message => {
        const target = message.scope === "global" ? globalChat : lobbyChat;
        target.addMessage(message);
    },

    "chat-history": ({ scope, messages }) => {
        const target = scope === "global" ? globalChat : lobbyChat;
        target.setMessages(messages);
    },

    "game-state": data => lobbyRoomView.updateGameState(data)
};

function renderOnlineUsers(users) {
    document.getElementById("online-count").textContent = String(users.length);
    const items = users.map(user => {
        const item = document.createElement("li");
        item.textContent = user.id === state.me?.id ? `${user.name} (du)` : user.name;
        return item;
    });
    document.getElementById("online-list").replaceChildren(...items);
}

function connectEvents() {
    clearTimeout(state.reconnectTimer);
    state.eventSource?.close();
    state.eventSource = openEventStream(eventHandlers, handleConnectionStatus);
}

/**
 * Reagiert auf Statuswechsel der Echtzeit-Verbindung.
 * Bei "closed" hat der Browser aufgegeben – dann prüfen wir, ob die Sitzung
 * noch gültig ist: ja → neu verbinden, nein → zurück zum Login.
 */
async function handleConnectionStatus(status) {
    setConnectionStatus(status);
    if (status !== "closed" || !state.me) return;

    try {
        await api.me();
        state.reconnectTimer = setTimeout(connectEvents, RECONNECT_DELAY_MS);
    } catch (err) {
        if (err.status === 401) {
            endSession("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
        } else {
            // Server (noch) nicht erreichbar – später erneut prüfen.
            state.reconnectTimer = setTimeout(() => handleConnectionStatus("closed"), RECONNECT_DELAY_MS);
        }
    }
}

/** Nach erfolgreichem Login oder Wiederanmeldung. */
async function startSession(user) {
    state.me = user;
    document.getElementById("current-user-name").textContent = user.name;
    showView("overview");
    connectEvents();

    // Einladungslink (?join=CODE) einlösen
    if (state.pendingJoinCode) {
        const code = state.pendingJoinCode;
        state.pendingJoinCode = null;
        await joinLobby({ code });
    }
}

/** Beendet die Sitzung lokal und zeigt wieder den Login. */
function endSession(message) {
    clearTimeout(state.reconnectTimer);
    state.eventSource?.close();
    state.eventSource = null;
    state.me = null;
    state.lobby = null;
    clearToken();

    lobbyRoomView.reset();
    lobbyChat.clear();
    globalChat.clear();
    showView("login");
    loginView.focus();

    if (message) showToast(message, "error");
}

// ===========================================================================
// Start
// ===========================================================================

/** Hostnamen, unter denen nur dieser Rechner selbst erreichbar ist. */
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Lädt Version und LAN-Adressen des Servers.
 * Wurde die Seite über "localhost" geöffnet, nutzen Einladungslinks die
 * LAN-Adresse – sonst könnten andere Geräte den Link nicht öffnen.
 */
async function loadServerInfo() {
    try {
        const { version, lanUrls } = await api.info();
        document.getElementById("app-version").textContent = `v${version}`;

        if (LOCAL_HOSTNAMES.includes(location.hostname) && lanUrls.length > 0) {
            lobbyRoomView.setInviteBaseUrl(lanUrls[0]);
        }
    } catch {
        // Nicht kritisch – Einladungslinks nutzen dann die aktuelle Adresse.
    }
}

async function init() {
    document.getElementById("logout-button").addEventListener("click", logout);

    // Einladungscode aus der URL merken und die URL aufräumen.
    const params = new URLSearchParams(location.search);
    if (params.has("join")) {
        state.pendingJoinCode = params.get("join");
        history.replaceState(null, "", location.pathname);
    }

    await loadServerInfo();

    // Spieleliste für die Auswahl in der Lobby laden.
    try {
        const { games } = await api.listGames();
        lobbyRoomView.setGames(games);
    } catch (err) {
        showToast(`Spieleliste konnte nicht geladen werden: ${err.message}`, "error");
    }

    // Bestehende Sitzung wiederaufnehmen (z. B. nach einem Reload).
    if (getToken()) {
        try {
            const { user } = await api.me();
            startSession(user);
            return;
        } catch (err) {
            if (err.status === 401) clearToken();
            else showToast(err.message, "error");
        }
    }

    showView("login");
    loginView.focus();
}

init();

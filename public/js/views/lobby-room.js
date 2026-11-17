/**
 * Ansicht "In einer Lobby":
 *  - Kopf mit Name, Code, Sichtbarkeit und "Lobby verlassen"
 *  - Mitgliederliste und Einladungslink
 *  - Spielbereich: Host wählt/beendet Spiele, alle sehen das aktive Spiel
 *
 * Der Lobby-Chat wird separat in main.js über createChat() eingebunden.
 */

import { GameHost } from "../game-loader.js";
import { showToast } from "../ui.js";

const VISIBILITY_LABELS = { public: "Offen", private: "Privat" };

/**
 * @param {object} options
 * @param {() => void} options.onLeave
 * @param {(gameId: string) => void} options.onSelectGame
 * @param {() => void} options.onEndGame
 * @param {(gameId: string) => object} options.createGameContext  ctx für mount() eines Spiels
 */
export function createLobbyRoomView({ onLeave, onSelectGame, onEndGame, createGameContext }) {
    const elements = {
        name: document.getElementById("lobby-name"),
        code: document.getElementById("lobby-code"),
        visibility: document.getElementById("lobby-visibility"),
        passwordBadge: document.getElementById("lobby-password-badge"),
        leaveButton: document.getElementById("leave-lobby-button"),
        memberList: document.getElementById("member-list"),
        inviteLink: document.getElementById("invite-link"),
        copyInviteButton: document.getElementById("copy-invite-button"),
        gameTitle: document.getElementById("game-title"),
        hostControls: document.getElementById("host-game-controls"),
        gameSelect: document.getElementById("game-select"),
        startGameButton: document.getElementById("start-game-button"),
        endGameButton: document.getElementById("end-game-button"),
        gamePlaceholder: document.getElementById("game-placeholder"),
        gameContainer: document.getElementById("game-container")
    };

    const gameHost = new GameHost(elements.gameContainer, createGameContext);

    /** Basis-Adresse für Einladungslinks (siehe setInviteBaseUrl). */
    let inviteBaseUrl = location.origin;

    // --- Event-Listener -----------------------------------------------------
    elements.leaveButton.addEventListener("click", onLeave);
    elements.endGameButton.addEventListener("click", onEndGame);
    elements.startGameButton.addEventListener("click", () => {
        if (elements.gameSelect.value) onSelectGame(elements.gameSelect.value);
    });
    elements.copyInviteButton.addEventListener("click", copyInviteLink);

    /**
     * Kopiert den Einladungslink. navigator.clipboard funktioniert nur über
     * HTTPS oder localhost – im LAN per http:// greift daher der Fallback.
     */
    async function copyInviteLink() {
        const link = elements.inviteLink.value;
        try {
            await navigator.clipboard.writeText(link);
            showToast("Einladungslink kopiert.");
        } catch {
            elements.inviteLink.select();
            const copied = document.execCommand("copy");
            showToast(copied ? "Einladungslink kopiert." : "Bitte den Link manuell kopieren (Strg+C).");
        }
    }

    // --- Darstellung --------------------------------------------------------

    function renderMembers(lobby, me) {
        const items = lobby.members.map(member => {
            const item = document.createElement("li");
            let label = member.name;
            if (member.id === lobby.hostId) label = `👑 ${label}`;
            if (member.id === me.id) label += " (du)";
            item.textContent = label;
            return item;
        });
        elements.memberList.replaceChildren(...items);
    }

    function renderGameArea(lobby, me) {
        const isHost = lobby.hostId === me.id;
        const game = lobby.game;

        elements.gameTitle.textContent = game ? game.name : "Kein Spiel ausgewählt";
        elements.hostControls.hidden = !isHost || Boolean(game);
        elements.endGameButton.hidden = !isHost || !game;

        if (game) {
            elements.gamePlaceholder.hidden = true;
            gameHost.show(game.id);
        } else {
            gameHost.clear();
            elements.gamePlaceholder.hidden = false;
            elements.gamePlaceholder.textContent = isHost
                ? "Wähle ein Spiel aus und starte es für alle in der Lobby."
                : "Warte darauf, dass der Host ein Spiel startet …";
        }
    }

    return {
        /** Legt fest, mit welcher Adresse Einladungslinks beginnen. */
        setInviteBaseUrl(url) {
            inviteBaseUrl = url;
        },

        /** Füllt die Spielauswahl (einmalig nach dem Laden der Spieleliste). */
        setGames(games) {
            const options = games.map(game => {
                const option = document.createElement("option");
                option.value = game.id;
                option.textContent = game.name;
                option.title = game.description;
                return option;
            });
            elements.gameSelect.replaceChildren(...options);
            elements.startGameButton.disabled = games.length === 0;
        },

        /** Stellt die Lobby dar. */
        render(lobby, me) {
            elements.name.textContent = lobby.name;
            elements.code.textContent = lobby.code;
            elements.visibility.textContent = VISIBILITY_LABELS[lobby.visibility] ?? lobby.visibility;
            elements.passwordBadge.hidden = !lobby.hasPassword;
            elements.inviteLink.value = `${inviteBaseUrl}/?join=${lobby.code}`;

            renderMembers(lobby, me);
            renderGameArea(lobby, me);
        },

        /** Neuer Spielzustand vom Server. */
        updateGameState(data) {
            gameHost.setState(data);
        },

        /** Lobby verlassen – Spiel entladen. */
        reset() {
            gameHost.clear();
        }
    };
}

/**
 * Ansicht "Lobby-Übersicht":
 *  - Liste der offenen (öffentlichen) Lobbys mit Beitreten-Button
 *  - Formular zum Erstellen einer Lobby
 *  - Formular zum Beitreten per Code (für private Lobbys)
 */

/**
 * @param {object} options
 * @param {(options: {name: string, visibility: string, password: string}) => Promise<boolean>} options.onCreate
 * @param {(lobby: object) => void} options.onJoin            Beitritt über die Liste
 * @param {(code: string) => Promise<boolean>} options.onJoinByCode
 */
export function createLobbyListView({ onCreate, onJoin, onJoinByCode }) {
    const listElement = document.getElementById("lobby-list");
    const emptyElement = document.getElementById("lobby-list-empty");
    const createForm = document.getElementById("create-lobby-form");
    const codeForm = document.getElementById("join-code-form");
    const codeInput = document.getElementById("join-code-input");

    // --- Lobby erstellen ----------------------------------------------------
    createForm.addEventListener("submit", async event => {
        event.preventDefault();
        const formData = new FormData(createForm);

        const success = await onCreate({
            name: formData.get("name"),
            visibility: formData.get("visibility"),
            password: formData.get("password")
        });
        if (success) createForm.reset();
    });

    // --- Per Code beitreten -------------------------------------------------
    codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value.toUpperCase();
    });

    codeForm.addEventListener("submit", async event => {
        event.preventDefault();
        const success = await onJoinByCode(codeInput.value.trim());
        if (success) codeForm.reset();
    });

    // --- Darstellung --------------------------------------------------------

    /** Baut einen Listeneintrag für eine Lobby. */
    function createLobbyItem(lobby) {
        const item = document.createElement("li");
        item.className = "lobby-item";

        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = lobby.hasPassword ? `🔒 ${lobby.name}` : lobby.name;

        const details = document.createElement("div");
        details.className = "muted";
        const parts = [
            `Host: ${lobby.hostName}`,
            `${lobby.memberCount}/${lobby.maxMembers} Spieler`,
            lobby.gameName ? `Spiel: ${lobby.gameName}` : "kein Spiel aktiv"
        ];
        details.textContent = parts.join(" · ");

        info.append(title, details);

        const button = document.createElement("button");
        const isFull = lobby.memberCount >= lobby.maxMembers;
        button.textContent = isFull ? "Voll" : "Beitreten";
        button.disabled = isFull;
        button.addEventListener("click", () => onJoin(lobby));

        item.append(info, button);
        return item;
    }

    return {
        /** Zeigt die aktuelle Liste der offenen Lobbys an. */
        render(lobbies) {
            listElement.replaceChildren(...lobbies.map(createLobbyItem));
            emptyElement.hidden = lobbies.length > 0;
        }
    };
}

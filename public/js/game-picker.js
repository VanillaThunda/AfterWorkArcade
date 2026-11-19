/**
 * Spielauswahl als Dialog mit Kacheln (Vorschaubild, Titel, Spielerzahl,
 * Beschreibung, Auswahl-Button).
 *
 * Die Auswahl wird bewusst als Liste geführt (selectedIds, maxSelection):
 * Aktuell ist genau ein Spiel wählbar. Für spätere Spiel-Sessions mit
 * mehreren Spielen nacheinander (siehe roadmap.md) reicht maxSelection > 1.
 */

/** Ab dieser Anzahl Spiele erscheint das Suchfeld. */
const SEARCH_THRESHOLD = 7;

/**
 * @param {object} options
 * @param {HTMLDialogElement} options.dialog
 * @param {(gameIds: string[]) => void} options.onConfirm  gewählte Spiele in Reihenfolge
 * @param {number} [options.maxSelection=1]
 */
export function createGamePicker({ dialog, onConfirm, maxSelection = 1 }) {
    const grid = dialog.querySelector(".game-picker-grid");
    const search = dialog.querySelector(".game-picker-search");
    const empty = dialog.querySelector(".game-picker-empty");
    const selectionText = dialog.querySelector(".game-picker-selection");
    const startButton = dialog.querySelector(".game-picker-start");

    /** @type {Array<{id: string, name: string, description: string, minPlayers: number, maxPlayers: number|null, preview: string|null}>} */
    let games = [];
    /** @type {string[]} */
    let selectedIds = [];
    let playerCount = 1;

    // --- Event-Listener -----------------------------------------------------
    dialog.addEventListener("click", event => {
        const actionButton = event.target.closest("[data-action]");
        if (actionButton?.dataset.action === "cancel") {
            close();
            return;
        }
        if (actionButton?.dataset.action === "start") {
            confirm();
            return;
        }
        // Klick auf eine Kachel (oder deren Auswahl-Button) wählt sie aus.
        const tile = event.target.closest(".game-tile");
        if (tile && !tile.classList.contains("is-unavailable")) toggle(tile.dataset.gameId);
    });

    // Doppelklick auf eine Kachel: auswählen und direkt starten.
    dialog.addEventListener("dblclick", event => {
        const tile = event.target.closest(".game-tile");
        if (!tile || tile.classList.contains("is-unavailable")) return;
        selectedIds = [tile.dataset.gameId];
        confirm();
    });

    search.addEventListener("input", applyFilter);

    // --- Logik --------------------------------------------------------------

    /** Grund, warum ein Spiel bei der aktuellen Spielerzahl nicht startbar ist (oder null). */
    function unavailableReason(game) {
        if (playerCount < game.minPlayers) return `mind. ${game.minPlayers} Spieler`;
        if (game.maxPlayers !== null && playerCount > game.maxPlayers) return `max. ${game.maxPlayers} Spieler`;
        return null;
    }

    function toggle(gameId) {
        if (selectedIds.includes(gameId)) {
            selectedIds = selectedIds.filter(id => id !== gameId);
        } else if (maxSelection === 1) {
            selectedIds = [gameId];
        } else if (selectedIds.length < maxSelection) {
            selectedIds = [...selectedIds, gameId];
        }
        renderSelection();
    }

    function confirm() {
        if (selectedIds.length === 0) return;
        const ids = [...selectedIds];
        close();
        onConfirm(ids);
    }

    function close() {
        if (dialog.open) dialog.close();
    }

    // --- Darstellung --------------------------------------------------------

    function playersLabel(game) {
        if (game.maxPlayers === null) return `ab ${game.minPlayers} Spieler`;
        if (game.minPlayers === game.maxPlayers) return `${game.minPlayers} Spieler`;
        return `${game.minPlayers}–${game.maxPlayers} Spieler`;
    }

    function createTile(game) {
        const tile = document.createElement("article");
        tile.className = "game-tile";
        tile.dataset.gameId = game.id;

        const media = document.createElement("div");
        media.className = "game-tile-media";
        if (game.preview) {
            const image = document.createElement("img");
            image.src = game.preview;
            image.alt = `Vorschau: ${game.name}`;
            image.loading = "lazy";
            media.append(image);
        } else {
            media.classList.add("game-tile-placeholder");
            media.textContent = "🎲";
        }

        const body = document.createElement("div");
        body.className = "game-tile-body";

        const title = document.createElement("h4");
        title.className = "game-tile-title";
        title.textContent = game.name;

        const players = document.createElement("span");
        players.className = "game-tile-players";
        players.textContent = `👥 ${playersLabel(game)}`;

        const description = document.createElement("p");
        description.className = "game-tile-description";
        description.textContent = game.description;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "game-tile-select";

        body.append(title, players, description);
        tile.append(media, body, button);
        return tile;
    }

    function renderTiles() {
        grid.replaceChildren(...games.map(createTile));
        search.hidden = games.length < SEARCH_THRESHOLD;
        applyFilter();
        renderSelection();
    }

    /** Aktualisiert Auswahl-Zustand, Verfügbarkeit und Fußzeile, ohne neu aufzubauen. */
    function renderSelection() {
        for (const tile of grid.querySelectorAll(".game-tile")) {
            const game = games.find(g => g.id === tile.dataset.gameId);
            const reason = unavailableReason(game);
            const position = selectedIds.indexOf(game.id);
            const selected = position !== -1;
            const button = tile.querySelector(".game-tile-select");

            tile.classList.toggle("is-selected", selected);
            tile.classList.toggle("is-unavailable", Boolean(reason));
            button.disabled = Boolean(reason);
            button.setAttribute("aria-pressed", String(selected));
            if (reason) {
                button.textContent = `Nicht verfügbar (${reason})`;
            } else if (selected) {
                button.textContent = maxSelection > 1 ? `✓ Ausgewählt (${position + 1})` : "✓ Ausgewählt";
            } else {
                button.textContent = "Auswählen";
            }
        }

        const names = selectedIds.map(id => games.find(g => g.id === id)?.name).filter(Boolean);
        selectionText.textContent = names.length > 0
            ? `Ausgewählt: ${names.join(" → ")}`
            : "Noch kein Spiel ausgewählt";
        startButton.disabled = names.length === 0;
    }

    function applyFilter() {
        const query = search.hidden ? "" : search.value.trim().toLowerCase();
        let visible = 0;
        for (const tile of grid.querySelectorAll(".game-tile")) {
            const game = games.find(g => g.id === tile.dataset.gameId);
            const match = !query || `${game.name} ${game.description}`.toLowerCase().includes(query);
            tile.hidden = !match;
            if (match) visible++;
        }
        empty.hidden = visible > 0 || games.length === 0;
    }

    return {
        /** Liste der verfügbaren Spiele (aus GET /api/games). */
        setGames(list) {
            games = list;
            selectedIds = selectedIds.filter(id => games.some(g => g.id === id));
            renderTiles();
        },

        /** Öffnet den Dialog; playerCount = aktuelle Anzahl der Lobby-Mitglieder. */
        open({ playerCount: count = 1 } = {}) {
            playerCount = count;
            selectedIds = [];
            search.value = "";
            applyFilter();
            renderSelection();
            dialog.showModal();
            grid.querySelector(".game-tile:not(.is-unavailable) .game-tile-select")?.focus();
        },

        close,

        isOpen: () => dialog.open
    };
}

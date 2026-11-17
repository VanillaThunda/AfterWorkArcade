/**
 * Wiederverwendbare Chat-Komponente – wird sowohl für den globalen Chat
 * als auch für den Lobby-Chat verwendet.
 *
 * Sicherheit: Nachrichten werden ausschließlich per textContent eingefügt,
 * damit niemand HTML oder JavaScript einschleusen kann (XSS).
 */

import { formatTime } from "./ui.js";

/** Abstand zum unteren Rand, ab dem automatisch mitgescrollt wird (px). */
const AUTO_SCROLL_THRESHOLD = 40;

/**
 * @param {object} options
 * @param {HTMLElement} options.messagesElement  Container für die Nachrichten
 * @param {HTMLFormElement} options.formElement  Eingabeformular
 * @param {HTMLInputElement} options.inputElement
 * @param {(text: string) => Promise<void>} options.onSend  Sendet eine Nachricht
 * @param {() => ({id: string}|null)} options.getMe  Liefert den eigenen User
 */
export function createChat({ messagesElement, formElement, inputElement, onSend, getMe }) {
    formElement.addEventListener("submit", async event => {
        event.preventDefault();

        const text = inputElement.value.trim();
        if (!text) return;

        inputElement.value = "";
        try {
            await onSend(text);
        } catch {
            inputElement.value = text; // Text bei Fehler wiederherstellen
        }
        inputElement.focus();
    });

    /** Baut das DOM-Element für eine Nachricht. */
    function createMessageElement(message) {
        const element = document.createElement("div");
        element.className = "chat-message";

        const time = document.createElement("span");
        time.className = "chat-time";
        time.textContent = formatTime(message.timestamp);
        element.append(time);

        if (message.system) {
            element.classList.add("chat-message-system");
        } else {
            const author = document.createElement("strong");
            author.className = "chat-author";
            author.textContent = `${message.userName}:`;
            element.append(author);

            if (message.userId === getMe()?.id) {
                element.classList.add("chat-message-own");
            }
        }

        const text = document.createElement("span");
        text.className = "chat-text";
        text.textContent = message.text;
        element.append(text);

        return element;
    }

    /** Ist der Nutzer (fast) ganz unten? Dann scrollen wir mit. */
    function isScrolledToBottom() {
        const { scrollTop, scrollHeight, clientHeight } = messagesElement;
        return scrollHeight - scrollTop - clientHeight < AUTO_SCROLL_THRESHOLD;
    }

    function scrollToBottom() {
        messagesElement.scrollTop = messagesElement.scrollHeight;
    }

    return {
        /** Ersetzt den gesamten Verlauf. */
        setMessages(messages) {
            messagesElement.replaceChildren(...messages.map(createMessageElement));
            scrollToBottom();
        },

        /** Hängt eine neue Nachricht an. */
        addMessage(message) {
            const stickToBottom = isScrolledToBottom();
            messagesElement.append(createMessageElement(message));
            if (stickToBottom) scrollToBottom();
        },

        clear() {
            messagesElement.replaceChildren();
            inputElement.value = "";
        }
    };
}

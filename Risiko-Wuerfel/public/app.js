const sides = {
    attacker: {
        dice: document.getElementById("attackerDice"),
        sum: document.getElementById("attackerSum")
    },
    defender: {
        dice: document.getElementById("defenderDice"),
        sum: document.getElementById("defenderSum")
    }
};

function showRoll(side, dice) {
    const target = sides[side];

    target.dice.innerHTML = dice
        .map(value => `<div class="die">${value}</div>`)
        .join("");

    const total = dice.reduce((sum, value) => sum + value, 0);
    target.sum.textContent = `Summe: ${total}`;

    target.dice.animate(
        [
            { transform: "scale(1)" },
            { transform: "scale(1.08)" },
            { transform: "scale(1)" }
        ],
        { duration: 250 }
    );
}

async function roll(side, count) {
    const buttons = document.querySelectorAll("button");
    buttons.forEach(button => button.disabled = true);

    document.getElementById("status").textContent = "Würfeln …";

    try {
        const response = await fetch("/roll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ side, count })
        });

        if (!response.ok) throw new Error("Serverfehler");
    } catch {
        document.getElementById("status").textContent =
            "Fehler: Server nicht erreichbar.";
    } finally {
        buttons.forEach(button => button.disabled = false);
    }
}

const events = new EventSource("/events");

events.onopen = () => {
    document.getElementById("status").textContent =
        "Verbunden – bereit zum Würfeln";
};

events.onmessage = event => {
    const data = JSON.parse(event.data);
    showRoll(data.side, data.dice);

    document.getElementById("status").textContent =
        `${data.side === "attacker" ? "Angreifer" : "Verteidiger"} hat gewürfelt.`;
};

events.onerror = () => {
    document.getElementById("status").textContent =
        "Verbindung zum Server wird wiederhergestellt …";
};

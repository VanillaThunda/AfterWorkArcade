"use strict";

/**
 * Netzwerk-Hilfen: ermittelt, unter welchen Adressen der Server im
 * lokalen Netzwerk erreichbar ist.
 */

const os = require("os");
const config = require("./config");

/** IPv4-Adressen dieses Rechners im lokalen Netzwerk, z. B. ["192.168.1.20"]. */
function getLanAddresses() {
    return Object.values(os.networkInterfaces())
        .flat()
        .filter(info => info && !info.internal && (info.family === "IPv4" || info.family === 4))
        .map(info => info.address);
}

/** Vollständige URLs im LAN, z. B. ["http://192.168.1.20:3000"]. */
function getLanUrls() {
    return getLanAddresses().map(address => `http://${address}:${config.PORT}`);
}

module.exports = {
    getLanAddresses,
    getLanUrls
};

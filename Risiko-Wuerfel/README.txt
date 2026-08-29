RISIKO-WÜRFEL V2

Fehler der ersten Version behoben:
Der HTTP-Handler hat zuvor /events und /roll abgefangen, bevor deren
eigentliche Verarbeitung erreicht wurde.

Start:
    cd /volume1/apps/risiko-wuerfel
    node server.js

Aufruf:
    http://IP-DER-SYNOLOGY:3000

Beenden:
    Im Terminal mit Strg+C.

Neustarten:
    Strg+C und danach wieder:
    node server.js

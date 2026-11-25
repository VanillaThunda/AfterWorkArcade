"use strict";

/**
 * Skizzen-Raten – eigene Begriffsliste (Allgemeinbegriffe, keine Marken oder Figuren).
 *
 * leicht  einfache Dinge und Tiere, schnell zu zeichnen
 * mittel  zusammengesetzte Dinge, Orte, Tätigkeiten
 * schwer  Abstraktes, Redewendungen nah, viele Details
 */

const leicht = `
Apfel, Banane, Birne, Kirsche, Erdbeere, Zitrone, Ananas, Karotte, Tomate, Gurke,
Pilz, Brot, Brezel, Käse, Ei, Eis, Torte, Pizza, Wurst, Kaffee,
Haus, Baum, Blume, Sonne, Mond, Stern, Wolke, Regen, Schnee, Regenbogen,
Berg, Insel, Welle, Feuer, Blitz, Hund, Katze, Maus, Pferd, Kuh,
Schwein, Schaf, Ente, Fisch, Vogel, Schnecke, Spinne, Biene, Schmetterling, Hase,
Igel, Frosch, Schlange, Elefant, Giraffe, Löwe, Bär, Pinguin, Wal, Krake,
Auto, Bus, Zug, Fahrrad, Flugzeug, Schiff, Boot, Rakete, Ballon, Traktor,
Ball, Drachen, Puppe, Würfel, Kerze, Lampe, Uhr, Brille, Schlüssel, Schere,
Stuhl, Tisch, Bett, Tür, Fenster, Treppe, Leiter, Zaun, Brücke, Turm,
Hut, Mütze, Schuh, Socke, Hose, Jacke, Handschuh, Schal, Krone, Ring,
Herz, Hand, Fuß, Auge, Nase, Ohr, Mund, Zahn, Bart, Haare,
Buch, Brief, Stift, Pinsel, Tasse, Teller, Gabel, Löffel, Messer, Flasche,
Telefon, Fernseher, Computer, Kamera, Gitarre, Trommel, Glocke, Schirm, Koffer, Tasche
`;

const mittel = `
Leuchtturm, Windmühle, Schneemann, Sandburg, Iglu, Zelt, Lagerfeuer, Vulkan, Wasserfall, Wüste,
Kaktus, Palme, Tannenbaum, Sonnenblume, Kürbis, Ameisenhaufen, Spinnennetz, Vogelnest, Bienenstock, Hundehütte,
Gießkanne, Hängematte, Liegestuhl, Sonnenschirm, Schaukel, Rutsche, Karussell, Riesenrad, Achterbahn, Trampolin,
Zahnbürste, Haartrockner, Bügeleisen, Waschmaschine, Kühlschrank, Staubsauger, Toaster, Wecker, Briefkasten, Mülleimer,
Badewanne, Dusche, Kamin, Sofa, Bücherregal, Schreibtisch, Kronleuchter, Teppich, Vorhang, Spiegel,
Feuerwehrauto, Krankenwagen, Polizeiauto, Bagger, Kran, Hubschrauber, U-Boot, Segelboot, Kanu, Heißluftballon,
Roller, Skateboard, Schlitten, Skier, Tretboot, Dampflok, Straßenbahn, Ampel, Tankstelle, Parkhaus,
Fußballtor, Basketballkorb, Tennisschläger, Bowlingkugel, Angel, Zielscheibe, Pokal, Medaille, Schachbrett, Puzzle,
Pirat, Ritter, Prinzessin, Zauberer, Hexe, Gespenst, Roboter, Astronaut, Taucher, Clown,
Koch, Gärtner, Maler, Feuerwehrmann, Bäcker, Arzt, Lehrer, Polizist, Briefträger, Bauarbeiter,
Burg, Kirche, Pyramide, Wolkenkratzer, Bauernhof, Scheune, Zoo, Bahnhof, Flughafen, Hafen,
Schatzkiste, Landkarte, Kompass, Fernglas, Lupe, Taschenlampe, Laterne, Sanduhr, Kuckucksuhr, Wetterhahn,
Geburtstag, Hochzeit, Picknick, Zirkus, Konzert, Kino, Theater, Museum, Bibliothek, Spielplatz,
Känguru, Krokodil, Nashorn, Nilpferd, Flamingo, Papagei, Eule, Fledermaus, Eichhörnchen, Marienkäfer,
Seepferdchen, Qualle, Seestern, Hai, Schildkröte, Dinosaurier, Drache, Einhorn, Meerjungfrau, Zwerg
`;

const schwer = `
Muskelkater, Lampenfieber, Ohrwurm, Gänsehaut, Schnapsidee, Luftschloss, Zeitreise, Schwerkraft, Sonnenfinsternis, Polarlicht,
Erdbeben, Lawine, Wirbelsturm, Sternschnuppe, Mondlandung, Schwarzes Loch, Echo, Spiegelbild, Schatten, Fata Morgana,
Feierabend, Montagmorgen, Mittagspause, Überstunden, Homeoffice, Videokonferenz, Kaffeeautomat, Kopierer, Großraumbüro, Betriebsfeier,
Stau, Umleitung, Baustelle, Falschparker, Blitzer, Einbahnstraße, Kreisverkehr, Zebrastreifen, Verspätung, Gleiswechsel,
Winterschlaf, Frühjahrsputz, Hitzewelle, Glatteis, Wetterbericht, Gewitter, Nebel, Dürre, Hochwasser, Ebbe und Flut,
Flohmarkt, Weihnachtsmarkt, Kirmes, Schützenfest, Faschingsumzug, Laternenumzug, Osterhase, Adventskranz, Silvesterrakete, Wunderkerze,
Gartenzwerg, Vogelscheuche, Komposthaufen, Gewächshaus, Rasenmäher, Schubkarre, Gartenschlauch, Hecke, Baumhaus, Teich,
Einkaufswagen, Kassenbon, Sonderangebot, Warteschlange, Rolltreppe, Fahrstuhl, Drehtür, Umkleidekabine, Wühltisch, Pfandflasche,
Zahnarzt, Röntgenbild, Pflaster, Krücke, Rollstuhl, Gips, Thermometer, Hustensaft, Schnupfen, Schluckauf,
Fernbedienung, Ladekabel, Steckdose, Glühbirne, Batterie, Satellit, Teleskop, Mikroskop, Magnet, Kettenreaktion,
Domino, Kartenhaus, Jonglieren, Seiltanz, Zaubertrick, Bauchredner, Pantomime, Karaoke, Polonaise, Luftgitarre,
Schlafwandler, Tagtraum, Albtraum, Kopfkissenschlacht, Schneeballschlacht, Wasserbombe, Seifenblase, Sandkasten, Versteckspiel, Topfschlagen,
Bergsteiger, Fallschirm, Bungeesprung, Surfbrett, Tauchermaske, Schnorchel, Rettungsring, Leuchtrakete, Flaschenpost, Schiffbruch
`;

const parse = text => text.split(",").map(w => w.trim()).filter(Boolean);

const WORDS = Object.freeze({
    leicht: Object.freeze(parse(leicht)),
    mittel: Object.freeze(parse(mittel)),
    schwer: Object.freeze(parse(schwer))
});

module.exports = { WORDS };

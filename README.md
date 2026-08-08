# Fidget-Maker

Ein Baukasten fuer selbstgedruckte Fidgets. Du waehlst in der Galerie ein
Fidget aus, stellst es mit Reglern ein oder laesst es dir von der KI
entwerfen - und laedst am Ende ein fertiges Paket herunter, das du in
Bambu Studio oeffnen und drucken kannst.

Alles rechnet im Browser. Es gibt keinen Server, keine Anmeldung und keine
Datenbank.

## Schnellstart

```bash
npm install
npm run dev          # http://localhost:5173
```

Fuer eine Produktivfassung:

```bash
npm run build        # prueft die Typen und baut nach dist/
npm run preview
```

## Die fuenf Fidgets

| Fidget | Was es ist | Was du brauchst |
| --- | --- | --- |
| **Pop-It** | Grundplatte mit einer Tasche pro Metall-Schnappkuppel, darueber eine weiche TPU-Membran. Der Generator rechnet aus, wie viele Kuppeln in deinen Umriss passen, und legt sie in der dichtesten Packung aus. | Metall-Schnappkuppeln (optional), PLA und TPU |
| **Clicker** | Gehaeuse mit Halteplatte fuer mechanische Schalter im 14-mm-Standardausschnitt. Rastermass, Anzahl und Bautiefe frei waehlbar, Tastenkappen mit Kreuzaufnahme auf Wunsch. | MX-kompatible Schalter, PLA |
| **Stressball** | Hohle Kugel aus flexiblem Filament. Wandstaerke und Shore-Haerte bestimmen, wie stark sie nachgibt; Oberflaeche glatt, genoppt, mit Golfball-Dellen oder Stacheln. Durch die Polbohrung fuellbar, mit passendem Stopfen. | nur flexibles Filament (TPU) |
| **Magnet-Slider** | Schiene mit ueberdeckten Haltelippen und einem Wagen darin, in einem Stueck gedruckt und nach dem Druck einmal losgebrochen. Magnete lassen den Wagen einrasten - oder, umgekehrt gepolt, schweben. | drei Scheibenmagnete (optional), PLA |
| **Fidget-Spinner** | Nabe, Arme und Hohlkehlen aus einer gemeinsamen Formbeschreibung. Als Gewichte Kugellager, M8-Muttern oder Magnete. Traegheitsmoment und geschaetzte Auslaufzeit werden mitgerechnet. | ein Kugellager fuer die Mitte, optional Gewichte |

Jedes Fidget bringt Voreinstellungen mit ("Klassisch gross", "Maximum",
"Ohne Kaufteile", ...), die als Startpunkt taugen.

## Die beiden Kaufteile

Der Katalog in `src/catalog/parts.ts` ist auf diese zwei Fundstuecke
zugeschnitten - Masse, Preise und Stueckzahlen stehen dort und landen
automatisch in der Stueckliste:

- **Metall-Schnappkuppeln**, 100 Stueck fuer CHF 3.01, Kreuzkuppel-Typ in
  5 / 6 / 7 / 8.4 / 10 / 12 / 14 mm -
  <https://a.aliexpress.com/_EvOrf9y> - das Klickgefuehl im Pop-It.
- **Blaue Clicky-Schalter**, 3-Pin, DIY-Set fuer CHF 18.24 -
  <https://a.aliexpress.com/_EI5oT9c> - die Tasten im Clicker.

Beim Pop-It heisst "so viele wie moeglich" woertlich: der Packer probiert
Sechseck-, Gitter-, Ring- und Sonnenblumenmuster im Abstandsfeld deines
Umrisses durch und meldet dir die erreichte Blasenzahl. Wenn mehr als eine
Packung Kuppeln noetig waere, sagt er das.

Wer nichts kaufen will, waehlt bei Pop-It und Clicker die gedruckte
Mechanik - dann funktioniert das Fidget ohne Zukaufteile.

## Der Export

Der Knopf "Exportieren" liefert ein ZIP mit:

- `*.3mf` - alle Teile auf einer Bauplatte, in Millimetern, nach Material
  gruppiert. Das ist die Datei fuer Bambu Studio: `Datei > Oeffnen`.
- `STL/*.stl` - dieselben Teile einzeln als binaeres STL, falls du einen
  anderen Slicer benutzt.
- `Anleitung.txt` - Druckeinstellungen, Stueckliste mit Preisen und Links,
  Montageschritte und alle Warnungen deiner Konfiguration.

Teile, die zusammen gedruckt werden muessen (etwa Schiene und Wagen des
Sliders), bleiben beim Anordnen zusammen; alles andere wird auf der Platte
verteilt und zentriert.

Jedes erzeugte Netz wird vor dem Export auf geschlossene Kanten geprueft.
Was du herunterlaedst, ist wasserdicht - der Slicer muss nichts reparieren.

## Die KI

Im Dialog "Von der KI entwerfen lassen" beschreibst du in einem Satz, was
du willst ("ein kleines Pop-It in Herzform, rot, fuer den Schluesselbund").
Die KI waehlt daraufhin das passende Fidget und setzt alle Parameter.

- **Mit API-Schluessel** laeuft die Anfrage direkt aus dem Browser an die
  Anthropic-API, mit einem Structured-Output-Schema, das aus den echten
  Parameterdefinitionen der Modelle erzeugt wird. Die KI kann also gar
  keinen Parameter erfinden, den es nicht gibt. Modelle zur Auswahl:
  Opus 5, Sonnet 5, Haiku 4.5.
- **Ohne Schluessel** springt eine Stichwortsuche ein. Sie versteht Form,
  Farbe, Groesse, Zahlwoerter und Sonderwuensche auf Deutsch und Englisch
  und liefert immer ein baubares Ergebnis.

In beiden Faellen wird das Ergebnis nochmal begrenzt und gesaeubert
(`normalizeParams`), bevor gebaut wird.

**Zum Schluessel:** Er wird nur in deinem Browser gespeichert
(`localStorage`) und ausschliesslich an `api.anthropic.com` geschickt. Es
gibt keinen Server dieses Projekts, der ihn sehen koennte. Auf einem
fremden Rechner solltest du ihn trotzdem nicht eintragen - jeder mit
Zugriff auf den Browser kann ihn auslesen.

## Aufbau

```
src/geo/      Geometrie-Kernel: Netze, Triangulation, Extrusion,
              Rotationskoerper, 2D-Abstandsfelder, Marching Squares
src/pack/     Kreis-Packing im Abstandsfeld (vier Muster)
src/catalog/  Masse und Preise der Kaufteile, Materialien
src/models/   die fuenf Generatoren, je mit Parametern und Voreinstellungen
src/export/   STL, 3MF, Plattenanordnung, Anleitungstext
src/ai/       Schema, Anthropic-Aufruf, Stichwortsuche als Rueckfallebene
src/worker/   baut und exportiert im Web Worker
src/ui/       Galerie, Regler, three.js-Viewer, KI-Dialog
```

Es gibt bewusst keine CSG-Bibliothek. Loecher und Taschen entstehen als
Loecher in den Deckflaechen plus eigene Waende - so bleibt jedes Netz von
vornherein geschlossen. Weil die Triangulation bei hunderten gleich
ausgerichteten Loechern gelegentlich versagt, wird jedes Ergebnis gegen
die erwartete Kantenbilanz geprueft und notfalls mit minimal versetzten
Loechern wiederholt (`src/geo/robust.ts`).

## Tests

```bash
npm test             # 51 Einheitstests: Geometrie, Packing, SDF,
                     # Modelle, Export, KI
npm run typecheck
```

Der Oberflaechentest faehrt einen echten Browser und geht den Weg eines
Nutzers durch - Fidget waehlen, Regler bewegen, Voreinstellung laden, KI
ohne Schluessel entwerfen lassen, exportieren und das heruntergeladene ZIP
auspacken. Er braucht eine laufende Vorschau:

```bash
npm run build
npm run preview -- --port 4173 &
npm run test:ui
```

## Drucken

Die Anleitung im Export nennt die Werte fuer deine Konfiguration. Als
Faustregel:

- **PLA-Teile**: 0.2 mm Schicht, 3 Waende, 15 % Fuellung.
- **TPU-Teile** (Membran, Stressball): 0.16-0.2 mm, langsam (20-30 mm/s),
  Fuellung 0 % bei Hohlkoerpern, kein Bowden-Direktumbau noetig beim
  Bambu-Direktantrieb.
- **Print-in-Place** (Slider): nicht skalieren, keine Naht-Optimierung
  ueber die Trennfuge, 0.3 mm Spalt sind eingerechnet.

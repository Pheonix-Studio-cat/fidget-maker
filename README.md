# Fidget-Maker

Ein Baukasten fuer selbstgedruckte Fidgets. Du waehlst in der Galerie ein
Fidget aus, stellst es mit Reglern ein oder laesst es dir von der KI
entwerfen - und laedst am Ende ein fertiges Paket herunter, das du in
Bambu Studio oeffnen und drucken kannst.

Alles rechnet im Browser. Es gibt keinen Server, keine Anmeldung und keine
Datenbank.

## Im Browser benutzen

**<https://pheonix-studio-cat.github.io/fidget-maker/>**

Die Seite liegt auf GitHub Pages und wird bei jedem Push auf `main` neu
gebaut (`.github/workflows/pages.yml`) - aber nur, wenn Typpruefung und
Einheitstests durchlaufen.

> Der Workflow schaltet Pages beim ersten Lauf selbst frei. Sollte das an
> den Repository-Rechten scheitern, hilft ein Griff von Hand: unter
> **Settings → Pages → Build and deployment → Source** den Eintrag
> **GitHub Actions** waehlen und den Workflow erneut starten.

### Auf dem iPad

Laeuft in Safari, ohne irgendetwas zu installieren. Die Oberflaeche ist auf
Tablets abgestimmt:

- **Quer** stehen Einstellungen, 3D-Ansicht und Kennzahlen nebeneinander.
- **Hoch** liegt die 3D-Ansicht oben, darunter Einstellungen und Kennzahlen
  je zur Haelfte.
- Regler, Reiter und Knoepfe sind auf Fingergroesse gebracht; das Modell
  dreht man mit einem Finger, zoomt mit zwei.
- Ueber *Teilen → Zum Home-Bildschirm* laeuft der Fidget Maker mit eigenem
  Symbol und ohne Adressleiste.
- Der Export landet als ZIP in **Dateien**. Von dort laesst es sich in
  Bambu Studio oder in die Handy-App weiterreichen.

## Selbst betreiben

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

### Anbieter

Gerechnet wird mit **Llama 3** - das kostet fuer den privaten Gebrauch nichts
oder fast nichts. Zur Wahl stehen:

| Anbieter | Modelle | Was es kostet | Schluessel holen |
| --- | --- | --- | --- |
| **OpenRouter** | Llama 3.3 70B, Llama 3.2 11B Vision, Llama 3.1 8B - jeweils in einer Gratisfassung | Die Modelle mit `:free` kosten nichts, sind dafuer im Durchsatz gedrosselt. Die bezahlte Fassung liegt bei Bruchteilen eines Cents pro Entwurf. | <https://openrouter.ai/keys> |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B | Kostenloses Kontingent, sehr schnell (meist unter zwei Sekunden). Wertet keine Bilder aus. | <https://console.groq.com/keys> |

Beide sprechen dasselbe Protokoll, deshalb steckt der Unterschied nur in
`src/ai/providers.ts`.

**Modellkennungen veralten.** OpenRouter und Groq benennen Modelle um oder
nehmen sie heraus; eine fest eingebaute Liste laeuft dann in ein "kennt
dieses Modell nicht". Deshalb steht neben der Modellauswahl ein Knopf
**Aktualisieren**: er holt die Liste beim Anbieter (`GET /models`), behaelt
die Llama-Eintraege, sortiert gratis vor bezahlt und gross vor klein und
merkt sie sich. Die eingebaute Liste ist nur noch der Startwert.

Wer ein ganz bestimmtes Modell will, traegt seine Kennung im Feld **Eigene
Modellkennung** ein - das ueberschreibt die Auswahl.

Bilder als Vorlage versteht nur ein Modell mit Bilderkennung (bei OpenRouter
die Vision-Fassungen). Groq wertet hier gar keine Bilder aus, dort werden sie
deshalb erst gar nicht mitgeschickt.

Anthropic (Claude) ist weiterhin implementiert, aber **ausgeblendet**: der
Eintrag in `providers.ts` traegt `hidden: true` und taucht deshalb nicht im
Auswahlmenue auf. Ein `hidden: false` holt ihn zurueck.

### Wie es funktioniert

**Mit API-Schluessel** laeuft der Entwurf in zwei kleinen Schritten statt in
einer grossen Frage:

1. *Welches Fidget?* - dafuer genuegt eine Uebersicht von fuenf Zeilen
   (rund 590 Zeichen). Die Antwort ist ein Wort.
2. *Welche Parameter?* - dafuer zaehlen nur noch die des gewaehlten Fidgets,
   dazu ein ausgefuelltes Beispiel (2600 bis 3400 Zeichen).

Vorher stand alles in einem Prompt: alle fuenf Fidgets samt komplettem
JSON-Schema, rund 19500 Zeichen. Grosse Modelle kommen damit zurecht, kleine
offene gehen darin unter und liefern dann leere oder erfundene Parameter.
Jeder Schritt fuer sich ist jetzt eine einfache Frage.

Kommt trotzdem nichts Brauchbares zurueck, sagt die Oberflaeche das
ausdruecklich ("keine Werte gesetzt"), statt kommentarlos die Voreinstellung
anzuzeigen.
- **Ohne Schluessel** springt eine Stichwortsuche ein. Sie versteht Form,
  Farbe, Groesse, Zahlwoerter und Sonderwuensche auf Deutsch und Englisch
  und liefert immer ein baubares Ergebnis - sofort und kostenlos.

Was zurueckkommt, wird in jedem Fall begrenzt und gesaeubert
(`normalizeParams`), bevor gebaut wird: unbekannte Parameter fliegen raus,
Zahlen werden in ihre Bereiche gezwungen, ungueltige Auswahlwerte fallen auf
die Vorgabe zurueck. Die KI kann also nichts Unbaubares erzeugen, egal wie
sie antwortet. Offene Modelle halten sich nicht immer an "nur JSON" - eine
Code-Umrandung oder ein einleitender Satz wird beim Auswerten abgeraeumt.

**Zum Schluessel:** Er wird nur in deinem Browser gespeichert
(`localStorage`, ein Fach pro Anbieter) und ausschliesslich an den
gewaehlten Anbieter geschickt. Es gibt keinen Server dieses Projekts, der
ihn sehen koennte. Auf einem fremden Geraet solltest du ihn trotzdem nicht
eintragen - jeder mit Zugriff auf den Browser kann ihn auslesen.

## Aufbau

```
src/geo/      Geometrie-Kernel: Netze, Triangulation, Extrusion,
              Rotationskoerper, 2D-Abstandsfelder, Marching Squares
src/pack/     Kreis-Packing im Abstandsfeld (vier Muster)
src/catalog/  Masse und Preise der Kaufteile, Materialien
src/models/   die fuenf Generatoren, je mit Parametern und Voreinstellungen
src/export/   STL, 3MF, Plattenanordnung, Anleitungstext
src/ai/       Anbieter (Llama/Claude), Schema, Aufruf, Stichwortsuche
src/worker/   baut und exportiert im Web Worker
src/ui/       Galerie, Regler, three.js-Viewer, KI-Dialog
public/       Symbole und Manifest fuer "Zum Home-Bildschirm"
```

Es gibt bewusst keine CSG-Bibliothek. Loecher und Taschen entstehen als
Loecher in den Deckflaechen plus eigene Waende - so bleibt jedes Netz von
vornherein geschlossen. Weil die Triangulation bei hunderten gleich
ausgerichteten Loechern gelegentlich versagt, wird jedes Ergebnis gegen
die erwartete Kantenbilanz geprueft und notfalls mit minimal versetzten
Loechern wiederholt (`src/geo/robust.ts`).

## Tests

```bash
npm test             # 63 Einheitstests: Geometrie, Packing, SDF,
                     # Modelle, Export, KI
npm run typecheck
```

Die zehn Oberflaechentests fahren einen echten Browser und gehen den Weg
eines Nutzers durch - Fidget waehlen, Regler bewegen, Voreinstellung laden,
KI ohne Schluessel entwerfen lassen, exportieren und das heruntergeladene
ZIP auspacken. Drei davon laufen in iPad-Groesse mit Fingerbedienung und
pruefen, dass nichts zerdrueckt oder zu klein zum Antippen ist. Sie
brauchen eine laufende Vorschau:

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

# 📐 NanoDraft 2D — Studio CAD (`v2.0`)

[![Version](https://img.shields.io/badge/version-2.0.0%20Studio%20UI-00E5FF?style=flat-square&labelColor=14161B)](https://github.com/Petretto/NanoDraft/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&labelColor=14161B)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?style=flat-square&labelColor=14161B)](https://vitejs.dev/)
[![Offline Portable](https://img.shields.io/badge/Offline%20Portable-Single%20HTML-10B981?style=flat-square&labelColor=14161B)](./release/NanoDraft_Portable.html)
[![DXF & AutoLISP](https://img.shields.io/badge/AutoCAD-DXF%20%26%20AutoLISP-FBBF24?style=flat-square&labelColor=14161B)](#eksport-integracja-z-autocad-i-wydruk-pdf)

**NanoDraft 2D** to lekki, szybki i precyzyjny program typu **2D CAD** zaprojektowany do tworzenia rysunków technicznych, detali warsztatowych oraz layoutów hal produkcyjnych i linii montażowych. Działa bezpośrednio w przeglądarce (**Vercel / Web**) oraz **w 100% offline jako pojedynczy samowystarczalny plik `NanoDraft_Portable.html`** niewymagający instalacji ani serwera.

---

## ✨ Co nowego w wersji `v2.0` (NanoDraft Studio UI/UX)

Wersja **v2.0** wprowadza całkowicie przebudowany interfejs inżynierski **NanoDraft Studio**:

* **Motyw inżynierski *Dark Slate*:** Głębokie tło obszaru roboczego (`#0B0D10`) z kontrastującą geometrią wektorową, adaptacyjną siatką (`#1F232B` / `#2A303C`), znacznikiem układu współrzędnych `UCS 0,0` oraz panelami bocznymi (`#14161B`) i akcentem *Cyan Precision* (`#00E5FF`).
* **3-sekcyjny Pasek Górny (Header):**
  * **Lewa strefa:** Rozwijane menu pliku z nazwą aktywnego projektu, świetlnym wskaźnikiem statusu zapisu (zielony / bursztynowy), szybkimi akcjami *Nowy / Zapisz / Otwórz* oraz selektorem aktywnej warstwy z próbnikiem koloru na żywo.
  * **Środkowa strefa:** Bezpośredni dostęp do modułów inżynierskich: **Projekty**, **Podkład rastrowy**, **Zestawienie BOM**, **Tabliczka rysunkowa ISO**.
  * **Prawa strefa:** Szybki eksport **DXF**, wydruk **PDF**, pobranie paczki **Portable**, **Konsola AutoLISP**, mapa skrótów **Stream Deck** oraz przełącznik języka **`PL / EN`**.
* **Paleta Narzędzi CAD z ikonami wektorowymi i skrótami:** Kafelki pogrupowane tematycznie (*Wybór*, *Rysowanie*, *Modyfikacja*, *Opis i Bloki*) z wbudowanymi ikonami SVG (działającymi również w trybie 100% offline) i bezpośrednim oznaczeniem skrótu klawiszowego w narożniku każdego narzędzia.
* **Pływający Dynamic HUD (`F12` / `Tab ⇥`):** Półprzezroczyste okienko wymiarowe podążające za kursorem z natychmiastowym wpisywaniem długości, promienia, szerokości lub kąta i przełączaniem pól klawiszem `Tab ⇥`.
* **Dokowany Wiersz Poleceń (`POLECENIE:` / Command Dock):** Konsola na dole obszaru roboczego inspirowana AutoCAD/ZWCAD — obsługuje komendy tekstowe (`LINE`, `PLINE`, `TRIM`, `FILLET`, `OFFSET`, `BOM`, `LAYER` itd.), współrzędne bezwzględne `X,Y`, współrzędne względne `@dx,dy` oraz wyrażenia AutoLISP `(command ...)`.
* **3-zakładkowy Prawy Inspektor + Widżet Warstw:** Zakładki **`Właściwości`**, **`Warstwy (N)`** i **`Historia`**, sekcja *Szybkie operacje* (`Kopiuj [K]`, `Obróć [O]`, `Lustro [I]`, `Usuń [Del]`) oraz przypięty na dole widżet **Warstwy projektu** umożliwiający błyskawiczne przełączanie widoczności (`👁`), blokady (`🔒`) i aktywnej warstwy.

---

## 📦 Wersja Portable Offline (Pobierz i uruchom bez instalacji)

Program można pobrać i uruchomić lokalnie na dowolnym komputerze (Windows, macOS, Linux) bez instalowania Node.js ani dodatkowych bibliotek:

1. **Bezpośrednio z aplikacji webowej:** kliknij zielony przycisk **`📦 Portable`** w prawym górnym rogu programu — pobierze się plik **`NanoDraft_Portable.html`**.
2. **Bezpośrednio z repozytorium GitHub (`release/`):**
   * [**`release/NanoDraft_Portable.html`**](./release/NanoDraft_Portable.html) — kompletna aplikacja wraz ze wszystkimi stylami, ikonami i projektami pokazowymi w **jednym pliku HTML (~660 kB)**,
   * [**`release/NanoDraft_2D_Portable.zip`**](./release/NanoDraft_2D_Portable.zip) — paczka ZIP zawierająca aplikację `NanoDraft_Portable.html`, plik `INSTRUKCJA_URUCHOMIENIA.txt` oraz katalog `Projects/`.
3. **Uruchomienie:** kliknij dwukrotnie pobrany plik `NanoDraft_Portable.html` — aplikacja otworzy się w przeglądarce i działa w 100% offline.

---

## 🛠️ Główne możliwości inżynierskie

### 1. Rysowanie i kształty warsztatowe
* **Podstawowe prymitywy:** Linia (`L`), wielosegmentowa Polilinia (`W` z domykaniem `C`), Prostokąt (`R`), Okrąg (`C`), Łuk 3-punktowy i ze środka (`A`), Punkt referencyjny (`P`).
* **Otwór podłużny „Fasolka” (`Slot` — `U`):** Rysowanie otworów fasolkowych przez wskazanie rozstawu osi dwóch środków $L$ oraz szerokości $W = 2R$, z opcją automatycznego wygenerowania osi symetrii.
* **Wielokąt foremny (`Polygon` — `U`):** Rysowanie wielokątów od `3` do `24` boków (np. sześciokąty pod śruby i nakrętki) w trybie wpisanym w okrąg lub opisanym na okręgu (pod wymiar klucza $S$).
* **Kreskowanie przekrojów (`Hatch` — `H`):** Automatyczne szrafowanie obszarów zamkniętych (`ANSI31 45°`, kratka `ANSI37`, pasy `0°`) z inteligentnym docinaniem wokół wewnętrznych otworów i linii podziału.

### 2. Zaawansowane modyfikacje i edycja
* **Transformacje wektorowe:** Przesuwanie (`M`), wielokrotne Kopiowanie (`K` oraz `Ctrl+C` / `Ctrl+V`), Obracanie wokół punktu bazowego (`O`), Odbicie lustrzane względem osi 2-punktowej (`I`), Skalowanie (`V`).
* **Odsunięcie równoległe (`Offset` — `F`):** Równoległe odsuwanie linii, polilinii, prostokątów i okręgów o zadany dystans.
* **Zaokrąglanie i Fazowanie narożników (`Fillet / Chamfer` — `G`):** Zaokrąglanie promieniem $R$, fazowanie wymiarami $D_1 \times D_2$ oraz łączenie w ostry narożnik ($R = 0$).
* **Przycinanie i Wydłużanie (`Trim / Extend` — `X`):** Precyzyjne docinanie wystających odcinków, polilinii oraz pełnych okręgów/łuków pomiędzy krawędziami przecinającymi (z szybkim przełączaniem na wydłużanie klawiszem `Shift`).
* **Szyk Prostokątny i Kołowy (`Array` — `Y`):** Powielanie elementów w siatce kolumn i wierszy lub po okręgu wokół wskazanego środka obrotu, z podglądem na żywo i automatycznym grupowaniem.
* **Pędzel właściwości (`Match Properties` — `J`):** Kopiowanie warstwy, koloru, stylu/grubości linii oraz wysokości czcionki z obiektu wzorcowego na kolejne obiekty (z wyborem filtrów i obsługą `Shift+klik` dla całych grup).
* **Uchwyty edycyjne (`Grips`), Grupowanie (`Ctrl+G` / `Ctrl+U`) i Rozbijanie (`Explode` — `E`).**

### 3. Precyzja i przyciąganie obiektowe (`OSNAP` — `F3`)
* **Końce (`Endpoint`)** — kwadrat na wierzchołkach linii, łuków i polilinii.
* **Środki odcinków (`Midpoint`)** — trójkąt w połowie każdego boku.
* **Środki okręgów i łuków (`Center`)** — kółko w środku okręgów, łuków oraz obu półokręgów fasolki montażowej (`Slot`).
* **Kwadranty (`Quadrant` — $0^\circ, 90^\circ, 180^\circ, 270^\circ$)** oraz **Przecięcia (`Intersection` — `X`)**.
* **Prostopadłość (`Perpendicular` — `∟`)** — dociąganie linii pod kątem prostym ($90^\circ$) do dowolnego odcinka, boku polilinii lub okręgu.
* **Styczność (`Tangent` — `TAN`)** — automatyczne wyznaczanie dokładnych punktów styczności z punktu początkowego do obwodu okręgów.

### 4. Wymiarowanie, Pomiary ($\text{m}^2$) i Adnotacje
* **Inteligentne Wymiarowanie (`D`):**
  * `[1] Auto` — automatyczne rozpoznawanie odcinków, pełnych okręgów (`Ø`) oraz łuków i półokręgów fasolki (`R`),
  * `[2] Liniowy` — wymiary poziome, pionowe i wyrównane (także błyskawiczne wymiarowanie całego odcinka klawiszem `Enter / Spacja`),
  * `[3] Średnica (Ø)` oraz `[4] Promień (R)` — działa na okręgach, łukach, zaokrągleniach i półokręgach fasolek,
  * `[5] Kątowy (°)` — wymiar kąta między dwiema prostymi,
  * `[6] Długość łuku (⌒)` — pomiar rzeczywistej długości łuku $L = R \cdot \Delta\alpha$.
* **Odnośnik strzałkowy z półką (`Leader / Callout` — `N`):** Grot strzałki wskazujący detal, łamana linia odnośnika i pozioma półka z tekstem warsztatowym oraz gotowymi szablonami (*„Fazować 2x45°”*, *„Spaw a=4”*, *„Szlifować Ra 1.6”* itd.).
* **Szybki Pomiar Odległości i Pola Powierzchni (`Zmierz` — `Q`):**
  * `[1] Odległość` — dystans, $\Delta X, \Delta Y$ i kąt nachylenia,
  * `[2] Pole figury` — natychmiastowy odczyt pola powierzchni (w aktywnej jednostce oraz w $\text{m}^2$) i obwodu klikniętej figury zamkniętej,
  * `[3] Pole wielokąta` — pomiar powierzchni i obwodu dowolnej strefy/pomieszczenia przez obkliknięcie narożników.

### 5. Podkład rastrowy, Biblioteka Bloków i Automatyczny BOM
* **Podkład rastrowy + Kalibracja 2 punktami (`Podkład`):** Wczytywanie rzutów architektonicznych i skanów (`PNG`, `JPG`, `WEBP`, `SVG`) na dolną warstwę z regulacją przezroczystości, blokadą warstwy oraz interaktywną kalibracją skali przez kliknięcie 2 punktów o znanym wymiarze rzeczywistym.
* **Biblioteka Bloków (`B`):** Gotowe komponenty przemysłowe i halowe (stół montażowy, paleta EUR, regał magazynowy, wózek widłowy, robot przemysłowy, przenośnik rolkowy, słup HEB, rozdzielnica, drzwi $90^\circ$) oraz możliwość zapisywania własnych bloków w pamięci przeglądarki.
* **Zestawienie Materiałowe (`BOM`):** Automatyczne zliczanie wszystkich bloków, szyków i nazwanych grup oraz sumowanie długości konturów na warstwach, filtrowanie tabeli na żywo, **wstawianie sformatowanej tabeli BOM bezpośrednio na rysunek CAD** oraz **eksport do pliku `.csv` (UTF-8 z BOM dla programu Excel)**.

### 6. Eksport, integracja z AutoCAD i Wydruk PDF
* **Zapis projektu (`.nanodraft`):** Natywny zapis i odczyt pełnej struktury rysunku wraz z **Auto-Zapisem (`Auto-Save`)** w `localStorage` i automatycznym przywracaniem sesji po odświeżeniu karty.
* **Import i Eksport DXF (`AutoCAD 2000+ / AC1015`):** Dwukierunkowa wymiana rysunków z programami AutoCAD, ZWCAD, BricsCAD, LibreCAD.
* **Generator i Konsola AutoLISP (`.lsp`):** Eksport skryptu `.lsp` odtwarzającego rysunek w AutoCAD poleceniem `NANODRAFT_IMPORT` oraz wbudowana konsola wykonująca polecenia LISP.
* **Tabliczka Rysunkowa ISO (`PN-ISO 7200`) i Wydruk PDF (`A4`–`A0`):**
  * Konfigurator tabliczki firmowej z wgrywaniem własnego **logo (`PNG/JPG/SVG`)** oraz **własnym edytorem graficznym tabliczki na płótnie CAD**,
  * Wydruk w skalach technicznych (`1:1`, `1:2`, `1:5`, `1:10`, `1:20`, `1:50`, `1:100`, `1:200`, `Dopasuj`) z podglądem arkusza na żywo,
  * Wybór obszaru wydruku: *Cały rysunek (Extents)*, ***Okno — wskazany prostokąt (Window)*** lub *Aktualny widok (Display)*.

---

## ⌨️ Skróty klawiszowe, klawisze funkcyjne i komendy `POLECENIE:`

Wszystkie narzędzia posiadają jednoliterowe skróty (gotowe pod **Elgato Stream Deck**) oraz aliasy w dolnym wierszu poleceń **`POLECENIE:`**:

| Narzędzie / Akcja | Skrót | Komenda w wierszu `POLECENIE:` | Opis |
|---|:---:|---|---|
| **Zaznacz / Uchwyty Grips** | `S` | `SELECT`, `S` | Kliknięcie, okno Window (`L→P`) / Crossing (`P→L`), edycja uchwytami |
| **Szybki pomiar (Dystans / Pole $\text{m}^2$)** | `Q` | `DIST`, `MEASURE`, `AREA` | `[1]` Odległość, `[2]` Pole figury, `[3]` Pole wielokąta ($\text{m}^2$ i obwód) |
| **Linia** | `L` | `LINE`, `L` | Rysowanie odcinków z wprowadzaniem długości i kąta w HUD |
| **Polilinia** | `W` | `PLINE`, `PL`, `W` | Wielosegmentowa polilinia (`C` zamyka obwód, `Enter` kończy) |
| **Prostokąt** | `R` | `RECT`, `REC`, `R` | Dwa narożniki lub szerokość $W$ i wysokość $H$ w HUD |
| **Okrąg** | `C` | `CIRCLE`, `C` | Środek + promień $R$ |
| **Łuk** | `A` | `ARC`, `A` | Łuk 3-punktowy (`[1]`) lub Środek–Początek–Koniec (`[2]`) |
| **Fasolka / Wielokąt foremny** | `U` | `SLOT`, `POLYGON`, `U` | Otwór podłużny (`Slot`) z osiami oraz wielokąt `3–24` boków |
| **Punkt** | `P` | `POINT`, `P` | Punkt referencyjny |
| **Kreskowanie (Hatch)** | `H` | `HATCH`, `H` | Szrafowanie przekrojów (`45° ANSI31`, kratka, pasy) |
| **Przesuń** | `M` | `MOVE`, `M` | Przesuwanie o wektor $\Delta X, \Delta Y$ z podglądem na żywo |
| **Kopiuj** | `K` | `COPY`, `CO`, `K` | Wielokrotne kopiowanie wektorowe (`Ctrl+C` / `Ctrl+V` dla schowka) |
| **Obróć** | `O` | `ROTATE`, `RO`, `O` | Obrót wokół punktu bazowego o zadany kąt |
| **Lustro** | `I` | `MIRROR`, `MI`, `I` | Odbicie lustrzane względem 2-punktowej osi symetrii |
| **Skaluj** | `V` | `SCALE`, `SC`, `V` | Skalowanie obiektów względem punktu bazowego |
| **Odsuń równolegle (Offset)** | `F` | `OFFSET`, `F` | Równoległe odsunięcie linii, polilinii i okręgów o dystans |
| **Szyk Prostokątny / Kołowy** | `Y` | `ARRAY`, `AR`, `Y` | Siatka kolumn × wierszy lub szyk kołowy z auto-grupowaniem |
| **Zaokrąglij / Fazuj** | `G` | `FILLET`, `CHAMFER`, `G` | Zaokrąglanie promieniem $R$, fazowanie $D$ oraz ostry narożnik |
| **Przytnij / Wydłuż** | `X` | `TRIM`, `EXTEND`, `X` | Przycinanie do przecięć (`Shift` przełącza na wydłużanie) |
| **Pędzel właściwości** | `J` | `MATCHPROP`, `MA`, `J` | Kopiowanie warstwy, koloru, stylu linii i czcionki (`Shift+klik` = grupa) |
| **Rozbij (Explode)** | `E` | `EXPLODE`, `E` | Rozbijanie polilinii, prostokątów i grup na pojedyncze odcinki |
| **Wymiarowanie** | `D` | `DIM`, `D` | `1` Auto, `2` Liniowy, `3` Średnica Ø, `4` Promień R, `5` Kąt °, `6` Łuk ⌒ |
| **Odnośnik z półką (Leader)** | `N` | `LEADER`, `LE`, `N` | Strzałka z półką tekstową i szablonami opisów warsztatowych |
| **Tekst techniczny** | `T` | `TEXT`, `MTEXT`, `T` | Tekst z ramką, wyrównaniem i kątem obrotu |
| **Biblioteka Bloków** | `B` | — | Wstawianie i tworzenie bloków oraz symboli CAD |
| **Zestawienie BOM / Warstwy / Druk** | — | `BOM`, `LAYER`, `PRINT` | Szybkie otwieranie modali z wiersza poleceń |
| **Grupuj / Rozgrupuj** | `Ctrl+G` / `Ctrl+U` | — | Łączenie zaznaczonych obiektów w nazwaną grupę / rozgrupowanie |
| **Cofnij / Ponów** | `Ctrl+Z` / `Ctrl+Y` | `UNDO`, `REDO` | Pełna historia operacji |
| **Dopasuj widok / Punkt (0,0)** | `Z` / `Home` | `ZOOM`, `FIT`, `Z` | Zoom Extents (`Z` lub `2× ŚPM`) oraz powrót do `(0, 0)` |
| **Przełączniki precyzji** | `F3` / `F8` / `F7` / `F12` | — | `F3` OSNAP, `F8` (lub `Shift`) ORTHO, `F7` GRID, `F12` Dynamic HUD |

---

## 📁 Projekty demonstracyjne (`/Projects`)

W katalogu [`Projects/`](./Projects) (oraz pod przyciskiem **`📁 Projekty`** w górnym pasku aplikacji) znajdują się gotowe rysunki inżynierskie wraz z wygenerowanymi arkuszami PDF:

* **`Pokaz_mozliwosci.nanodraft`** ([PDF](./Projects/Pokaz_mozliwosci.pdf)) — przekrój i rzut kołnierza korpusu z kreskowaniem, szykiem kołowym otworów, zaokrągleniami, wymiarowaniem liniowym, kątowym, promieniowym i długością łuku.
* **`Linia_montazowa_hali.nanodraft`** ([PDF](./Projects/Linia_montazowa_hali.pdf)) — kompletny layout hali produkcyjnej i linii montażowej (zrobotyzowane cele spawalnicze, przenośnik rolkowy, gniazda montażowe, strefy buforowe EUR, wózki widłowe i drogi transportowe).
* **`Przekladnia_planetarna.nanodraft`** ([PDF](./Projects/Przekladnia_planetarna.pdf)) — szczegółowy rysunek złożeniowy przekładni planetarnej z trzema satelitami i tabliczką rysunkową.

---

## 🚀 Uruchomienie lokalne i budowanie

```bash
# Instalacja zależności
npm install

# Uruchomienie serwera deweloperskiego (http://localhost:5173/)
npm run dev

# Zbudowanie wersji produkcyjnej (dist/) + wygenerowanie paczki NanoDraft_Portable.html i ZIP (release/)
npm run build
```

# NanoDraft 2D 📐

Lekki, szybki i precyzyjny program typu **2D CAD** działający w przeglądarce (online oraz w 100% offline jako pojedynczy plik przenośny). Umożliwia rysowanie techniczne z dokładnym wprowadzaniem wymiarów (Dynamic HUD), przyciąganiem obiektowym (OSNAP — w tym prostopadłość `∟` i styczność `TAN`), wymiarowaniem (`Auto`, `Liniowy`, `Ø`, `R`, `∠`, `⌒ Długość łuku`), odnośnikami warsztatowymi (`Leader`), fasolkami montażowymi i wielokątami, podkładem rastrowym z kalibracją 2 punktami, pomiarem pola powierzchni ($\text{m}^2$), automatycznym zestawieniem materiałów **BOM (CSV / Excel)**, eksportem do **DXF (AutoCAD)** oraz wydrukiem do **PDF** w skali ISO (`A4`–`A0`) z edytorem własnej tabliczki rysunkowej.

---

## 📦 Pobierz i uruchom bez instalacji (Wersja Portable Offline)

Użytkownik może pobrać i uruchomić program bez instalowania Node.js ani żadnych bibliotek:
1. **Bezpośrednio z aplikacji:** kliknij przycisk **`📦 Pobierz apkę`** w górnym pasku programu — pobierze się pojedynczy plik **`NanoDraft_Portable.html`**.
2. **Z katalogu `release/`:** pobierz plik **`release/NanoDraft_Portable.html`** lub paczkę **`release/NanoDraft_2D_Portable.zip`**.
3. **Uruchomienie:** kliknij dwukrotnie `NanoDraft_Portable.html` na dowolnym komputerze (Windows / macOS / Linux) — program działa w 100% lokalnie i offline!

---

## 🚀 Uruchomienie deweloperskie i budowanie

```bash
# Uruchomienie serwera deweloperskiego (http://localhost:5173/)
npm run dev

# Zbudowanie wersji produkcyjnej (Vercel) + wygenerowanie paczki NanoDraft_Portable.html
npm run build
```

---

## ☁️ Publikacja na GitHub i Vercel

1. Utwórz nowe repozytorium **NanoDraft** na swoim koncie GitHub.
2. Wypchnij kod z folderu projektu:
   ```bash
   git init
   git add .
   git commit -m "Initial release of NanoDraft 2D v1.4"
   git branch -M main
   git remote add origin https://github.com/Petretto/NanoDraft.git
   git push -u origin main
   ```
3. W panelu **Vercel** kliknij **Add New... → Project**, wybierz repozytorium `NanoDraft`:
   * **Framework Preset:** `Vite`
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
4. Kliknij **Deploy** — aplikacja będzie od razu dostępna publicznie, a przycisk **`📦 Pobierz apkę`** na stronie pozwoli każdemu odwiedzającemu pobrać wersję offline!

---

## ⌨️ Skróty klawiszowe i Stream Deck

| Narzędzie / Akcja | Klawisz | Opis |
|---|---|---|
| **Zaznacz / Edycja uchwytami** | `S` | Kliknięcie, okno Window (`L→P`) / Crossing (`P→L`), uchwyty Grips |
| **Szybki pomiar (Odległość / Pole $\text{m}^2$)** | `Q` | Tryby: `[1]` Odległość, `[2]` Pole figury, `[3]` Pole wielokąta |
| **Linia** | `L` | Rysowanie odcinków z wprowadzaniem długości i kąta w HUD |
| **Polilinia** | `W` | Wielosegmentowa polilinia (`C` zamyka obwód) |
| **Prostokąt** | `R` | Dwa narożniki lub szerokość $W$ i wysokość $H$ w HUD |
| **Okrąg** | `C` | Środek + zadany promień $R$ |
| **Łuk** | `A` | Łuk 3-punktowy lub Środek–Początek–Koniec |
| **Fasolka / Wielokąt foremny** | `U` | Otwór podłużny (`Slot`) z osiami oraz wielokąt `3–24` boków |
| **Punkt** | `P` | Punkt referencyjny |
| **Kreskowanie (Hatch)** | `H` | Szrafowanie przekrojów (`45° ANSI31`, kratka, pasy) |
| **Przesuń / Kopiuj / Obróć / Lustro** | `M` / `K` / `O` / `I` | Przekształcenia z podglądem na żywo i wektorem z HUD |
| **Skaluj / Odsuń (Offset) / Szyk** | `V` / `F` / `Y` | Skalowanie, odsunięcie równoległe, szyk prostokątny i kołowy |
| **Zaokrąglij / Fazuj** | `G` | Zaokrąglanie (`Fillet R`), fazowanie (`Chamfer D`) i ostry narożnik |
| **Przytnij / Wydłuż** | `X` | Przycinanie (`Trim`) i wydłużanie (`Shift` / `Extend`) |
| **Pędzel właściwości (Match)** | `J` | Kopiowanie warstwy, koloru, stylu linii i czcionki na inne obiekty |
| **Rozbij (Explode)** | `E` | Rozbijanie polilinii, prostokątów i grup na pojedyncze odcinki |
| **Wymiarowanie** | `D` | `1` Auto, `2` Liniowy, `3` Średnica Ø, `4` Promień R, `5` Kąt °, `6` Łuk ⌒ |
| **Odnośnik z półką (Leader)** | `N` | Strzałka z półką i tekstem warsztatowym |
| **Tekst techniczny** | `T` | Tekst z ramką, wyrównaniem i obrotem |
| **Biblioteka Bloków** | `B` | Gotowe symbole przemysłowe/halowe oraz własne bloki użytkownika |
| **Grupuj / Rozgrupuj** | `Ctrl+G` / `Ctrl+U` | Łączenie elementów w nazwane grupy (zliczane w tabeli BOM) |
| **OSNAP / ORTHO / Siatka** | `F3` / `F8` / `F7` | Przyciąganie (`Endpoint`, `Midpoint`, `Center`, `∟`, `TAN`), kąty proste, siatka |
| **Dopasuj widok / Punkt 0,0** | `Z` / `Home` | Zoom Extents (`Z` lub `2× ŚPM`) oraz powrót do początku układu |

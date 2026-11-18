import { CadDocument } from '../model/document';
import { HistoryManager } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { DxfExporter } from '../io/dxf-export';
import { DxfImporter } from '../io/dxf-import';
import { LispIntegration } from '../io/lisp-gen';
import { JsonIO } from '../io/json-io';
import { AutoSaveManager } from '../io/auto-save';
import { PrintManager } from '../io/print-pdf';
import { LayersModal } from './layers-modal';
import { TitleBlockManager } from './title-block-modal';
import { ProjectsModal } from './projects-modal';
import { UnderlayManager } from './underlay-modal';
import { BomManager } from './bom-modal';
import { i18n, tr } from '../i18n/lang';

export class TopBar {
  private element: HTMLDivElement;

  constructor(
    private doc: CadDocument,
    private history: HistoryManager,
    private transform: ViewportTransform,
    parent: HTMLElement,
    private requestRender: () => void
  ) {
    this.element = document.createElement('div');
    this.element.className = 'cad-top-bar';

    this.render();
    parent.appendChild(this.element);

    this.doc.addChangeListener(() => this.updateActiveLayerSelect());
    i18n.onChange(() => this.render());
  }

  private render() {
    this.element.innerHTML = `
      <div class="top-left">
        <span class="logo-icon">📐</span>
        <span class="logo-title">NanoDraft 2D</span>
        <span class="logo-badge">v1.4</span>

        <div class="top-separator"></div>

        <!-- Aktywna warstwa -->
        <span style="font-size:11px; color:var(--text-muted);">${tr('Warstwa:', 'Layer:')}</span>
        <select id="active-layer-select" class="status-select" style="max-width:140px;">
          ${this.doc.layers.map(l => `<option value="${l.id}" ${l.id === this.doc.activeLayerId ? 'selected' : ''}>${l.name}</option>`).join('')}
        </select>
        <button id="btn-layers" class="top-btn" title="${tr('Otwórz Menedżer Warstw (tworzenie, kolory, rodzaje linii)', 'Open Layer Manager (create, colors, linetypes)')}">🎨 ${tr('Warstwy', 'Layers')}</button>
      </div>

      <div class="top-actions">
        <!-- Nowy rysunek (Wyczyść wszystko) -->
        <button id="btn-new" class="top-btn" title="${tr('Utwórz nowy, pusty rysunek (wyczyść obecny)', 'Create a new empty drawing (clear current)')}">📄 ${tr('Nowy', 'New')}</button>

        <!-- Katalog Projektów (/Projects) -->
        <button id="btn-projects" class="top-btn highlight" title="${tr('Wczytaj projekt z katalogu Projects/', 'Load a project from the Projects/ directory')}">📁 ${tr('Projekty', 'Projects')}</button>

        <div class="top-separator"></div>

        <!-- Zapis / Wczytanie (JSON / DXF) -->
        <button id="btn-save" class="top-btn" title="${tr('Zapisz projekt do pliku .nanodraft', 'Save project to .nanodraft file')}">💾 ${tr('Zapisz', 'Save')}</button>
        <button id="btn-load" class="top-btn" title="${tr('Otwórz projekt (.nanodraft, .json lub importuj .dxf)', 'Open project (.nanodraft, .json or import .dxf)')}">📂 ${tr('Otwórz / Import', 'Open / Import')}</button>
        <input type="file" id="file-input" accept=".nanodraft,.minicad,.json,.dxf" style="display:none" />

        <div class="top-separator"></div>

        <!-- Eksport AutoCAD -->
        <button id="btn-dxf" class="top-btn highlight" title="${tr('Eksportuj do DXF zgodnego z AutoCAD', 'Export to AutoCAD-compatible DXF')}">⚡ ${tr('Eksport DXF', 'Export DXF')}</button>
        <button id="btn-lisp" class="top-btn" title="${tr('Generuj skrypt AutoLISP (.lsp) dla AutoCAD', 'Generate AutoLISP (.lsp) script for AutoCAD')}">📜 ${tr('Skrypt LISP', 'LISP Script')}</button>

        <div class="top-separator"></div>

        <!-- Podkład rastrowy, Zestawienie BOM, Tabliczka rysunkowa oraz Druk i PDF -->
        <button id="btn-underlay" class="top-btn" title="${tr('Wczytaj podkład rastrowy (PNG/JPG) i skalibruj go 2 punktami do skali 1:1', 'Load raster underlay (PNG/JPG) and calibrate scale with 2 points')}">🖼️ ${tr('Podkład', 'Underlay')}</button>
        <button id="btn-bom" class="top-btn" title="${tr('Automatyczne zestawienie bloków, grup i długości warstw (BOM / Excel CSV)', 'Automatic Bill of Materials for blocks, groups & layers (BOM / CSV)')}">📊 ${tr('BOM', 'BOM')}</button>
        <button id="btn-titleblock" class="top-btn" title="${tr('Konfiguruj firmową tabliczkę rysunkową i wstaw ją do rysunku (poziomo lub pionowo)', 'Configure company title block and insert into drawing (landscape or portrait)')}">📋 ${tr('Tabliczka', 'Title Block')}</button>
        <button id="btn-print" class="top-btn" title="${tr('Wydrukuj na drukarce lub zapisz jako PDF w wybranym formacie ISO i skali', 'Print or save as PDF in chosen ISO format and scale')}">🖨️ ${tr('Drukuj / PDF', 'Print / PDF')}</button>

        <div class="top-separator"></div>

        <!-- Konsola LISP & Stream Deck Info & Pobierz Offline -->
        <button id="btn-lisp-console" class="top-btn" title="${tr('Otwórz konsolę poleceń AutoLISP', 'Open AutoLISP command console')}">💻 ${tr('Konsola LISP', 'LISP Console')}</button>
        <button id="btn-streamdeck" class="top-btn" title="${tr('Podgląd skrótów do konfiguracji Stream Deck', 'View keyboard shortcuts for Stream Deck')}">🎮 Stream Deck</button>
        <button id="btn-download-app" class="top-btn" title="${tr('Pobierz samowystarczalną paczkę NanoDraft_Portable.html do pracy offline na komputerze (bez instalacji)', 'Download standalone NanoDraft_Portable.html package for offline desktop use (no installation needed)')}">📦 ${tr('Pobierz apkę', 'Download App')}</button>

        <div class="top-separator"></div>

        <!-- Przełącznik języka PL / EN -->
        <button id="btn-lang" class="top-btn highlight" title="${tr('Przełącz język na Angielski (Switch to English)', 'Przełącz język na Polski (Switch to Polish)')}">🌐 ${i18n.lang === 'pl' ? 'PL 🇵🇱' : 'EN 🇬🇧'}</button>
      </div>
    `;

    // Active layer select
    const layerSelect = this.element.querySelector('#active-layer-select') as HTMLSelectElement;
    layerSelect?.addEventListener('change', () => {
      this.doc.activeLayerId = layerSelect.value;
      this.doc.notifyChange();
      this.requestRender();
    });

    // Layers Manager Modal
    this.element.querySelector('#btn-layers')?.addEventListener('click', () => {
      LayersModal.open(this.doc, () => {
        this.updateActiveLayerSelect();
        this.requestRender();
      });
    });

    // New Drawing (Clear All) button
    this.element.querySelector('#btn-new')?.addEventListener('click', () => {
      if (this.doc.entities.length > 0) {
        const ok = confirm(
          tr(
            'Czy na pewno chcesz utworzyć nowy rysunek? Obecne elementy zostaną wyczyszczone.',
            'Are you sure you want to start a new drawing? Current entities will be cleared.'
          )
        );
        if (!ok) return;
      }
      this.doc.resetToNew('mm');
      this.history.clear();
      AutoSaveManager.clear();
      this.transform.resetView();
      this.updateActiveLayerSelect();
      this.requestRender();
    });

    // Projects Directory (/Projects) button
    this.element.querySelector('#btn-projects')?.addEventListener('click', () => {
      ProjectsModal.open(
        this.doc,
        this.history,
        this.transform,
        () => {
          this.updateActiveLayerSelect();
          this.requestRender();
        },
        () => {
          fileInput.click();
        }
      );
    });

    // Event listeners
    this.element.querySelector('#btn-save')?.addEventListener('click', () => {
      JsonIO.downloadProject(this.doc);
      this.doc.markClean();
    });

    const fileInput = this.element.querySelector('#file-input') as HTMLInputElement;
    this.element.querySelector('#btn-load')?.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const isDxf = file.name.toLowerCase().endsWith('.dxf');
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          if (content) {
            if (isDxf) {
              const res = DxfImporter.importDxf(content, this.doc);
              if (res.error) {
                alert(tr('Błąd importu DXF: ', 'DXF import error: ') + res.error);
              } else {
                alert(
                  tr(
                    `Pomyślnie zaimportowano ${res.count} obiektów z pliku DXF!`,
                    `Successfully imported ${res.count} entities from DXF file!`
                  )
                );
                this.requestRender();
              }
            } else {
              if (JsonIO.loadFromJson(content, this.doc)) {
                this.doc.markClean();
                this.requestRender();
              }
            }
          }
        };
        reader.readAsText(file);
      }
    });

    this.element.querySelector('#btn-dxf')?.addEventListener('click', () => {
      DxfExporter.downloadDxf(this.doc);
    });

    this.element.querySelector('#btn-lisp')?.addEventListener('click', () => {
      LispIntegration.downloadLispScript(this.doc);
    });

    this.element.querySelector('#btn-underlay')?.addEventListener('click', () => {
      UnderlayManager.openModal(this.doc, this.history, this.transform, () => {
        this.updateActiveLayerSelect();
        this.requestRender();
      });
    });

    this.element.querySelector('#btn-bom')?.addEventListener('click', () => {
      BomManager.openModal(this.doc, this.history, this.transform, () => {
        this.updateActiveLayerSelect();
        this.requestRender();
      });
    });

    this.element.querySelector('#btn-titleblock')?.addEventListener('click', () => {
      TitleBlockManager.openModal(this.doc, this.history, this.transform, () => {
        this.updateActiveLayerSelect();
        this.requestRender();
      });
    });

    this.element.querySelector('#btn-print')?.addEventListener('click', () => {
      PrintManager.openModal(this.doc, this.transform, this.history, () => {
        this.updateActiveLayerSelect();
        this.requestRender();
      });
    });

    this.element.querySelector('#btn-lisp-console')?.addEventListener('click', () => {
      this.openLispConsoleModal();
    });

    this.element.querySelector('#btn-streamdeck')?.addEventListener('click', () => {
      this.openStreamDeckModal();
    });

    this.element.querySelector('#btn-download-app')?.addEventListener('click', async () => {
      try {
        const resp = await fetch('/NanoDraft_Portable.html');
        if (resp.ok) {
          const htmlText = await resp.text();
          if (htmlText.includes('NanoDraft')) {
            const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'NanoDraft_Portable.html';
            a.click();
            URL.revokeObjectURL(url);
            return;
          }
        }
      } catch {
        // Fallback when running directly from file://
      }
      const htmlContent = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'NanoDraft_Portable.html';
      a.click();
      URL.revokeObjectURL(url);
    });

    this.element.querySelector('#btn-lang')?.addEventListener('click', () => {
      i18n.toggleLang();
    });
  }

  private updateActiveLayerSelect() {
    const select = this.element.querySelector('#active-layer-select') as HTMLSelectElement;
    if (!select) return;
    select.innerHTML = this.doc.layers
      .map(l => `<option value="${l.id}" ${l.id === this.doc.activeLayerId ? 'selected' : ''}>${l.name}</option>`)
      .join('');
  }

  private openLispConsoleModal() {
    const sample = '(command "_line" \'(0 0) \'(12 8) "")';
    const code = prompt(
      tr(
        'Konsola AutoLISP:\nWpisz polecenie LISP, np:\n(command "_line" \'(0 0) \'(10 0) "")\nlub (command "_circle" \'(5 5) 2.5)',
        'AutoLISP Console:\nEnter a LISP expression, e.g.:\n(command "_line" \'(0 0) \'(10 0) "")\nor (command "_circle" \'(5 5) 2.5)'
      ),
      sample
    );
    if (code) {
      const res = LispIntegration.runLisp(code, this.doc);
      alert(res);
      this.requestRender();
    }
  }

  private openStreamDeckModal() {
    alert(
      tr(
        'Konfiguracja klawiszy dla Elgato Stream Deck:\n\n' +
          'Skróty klawiszowe (Hotkeys):\n' +
          '• S -> Zaznacz (Select)\n' +
          '• L -> Linia (Line)\n' +
          '• W -> Polilinia (Polyline)\n' +
          '• R -> Prostokąt (Rectangle)\n' +
          '• C -> Okrąg (Circle)\n' +
          '• P -> Punkt (Point)\n' +
          '• M -> Przesuń (Move)\n' +
          '• K -> Kopiuj (Copy)\n' +
          '• O -> Obróć (Rotate)\n' +
          '• I -> Lustro (Mirror)\n' +
          '• F -> Odsunięcie (Offset)\n' +
          '• G -> Zaokrąglij / Fazuj (Fillet / Chamfer)\n' +
          '• X -> Przytnij / Wydłuż (Trim / Extend)\n' +
          '• J -> Pędzel właściwości (Match Properties)\n' +
          '• A -> Łuk (Arc) | U -> Fasolka / Wielokąt\n' +
          '• Y -> Szyk (Array) | H -> Kreskuj (Hatch) | V -> Skaluj | E -> Rozbij\n' +
          '• B -> Biblioteka Bloków (Blocks) | N -> Odnośnik (Leader)\n' +
          '• D -> Wymiarowanie (Dimension: 1-Auto, 2-Lin, 3-Ø, 4-R, 5-∠, 6-⌒)\n' +
          '• Q -> Zmierz (Measure)\n' +
          '• T -> Tekst (Text)\n' +
          '• Z / 2x ŚPM -> Dopasuj widok (Zoom to Fit)\n' +
          '• Esc / PPM -> Anuluj / Wyczyść zaznaczenie\n' +
          '• Ctrl+C / Ctrl+V -> Kopiuj / Wklej\n' +
          '• Ctrl+Z / Ctrl+Y -> Cofnij / Ponów\n' +
          '• F3 -> Przełącz OSNAP (Przyciąganie)\n' +
          '• F8 / Shift -> Tryb ORTHO (Kąty proste)\n' +
          '• F7 -> Przełącz Siatkę (Grid)',
        'Elgato Stream Deck Hotkey Reference:\n\n' +
          'Keyboard Shortcuts:\n' +
          '• S -> Select\n' +
          '• L -> Line\n' +
          '• W -> Polyline\n' +
          '• R -> Rectangle\n' +
          '• C -> Circle\n' +
          '• P -> Point\n' +
          '• M -> Move\n' +
          '• K -> Copy\n' +
          '• O -> Rotate\n' +
          '• I -> Mirror\n' +
          '• F -> Offset\n' +
          '• G -> Fillet / Chamfer | X -> Trim / Extend\n' +
          '• J -> Match Properties\n' +
          '• A -> Arc | U -> Slot / Polygon\n' +
          '• Y -> Array | H -> Hatch | V -> Scale | E -> Explode\n' +
          '• B -> Blocks Library | N -> Leader Callout\n' +
          '• D -> Dimension (1-Smart, 2-Linear, 3-Ø, 4-R, 5-∠, 6-⌒)\n' +
          '• Q -> Measure\n' +
          '• T -> Text\n' +
          '• Z / Double MMB -> Zoom to Fit\n' +
          '• Esc / RMB -> Cancel / Clear Selection\n' +
          '• Ctrl+C / Ctrl+V -> Copy / Paste\n' +
          '• Ctrl+Z / Ctrl+Y -> Undo / Redo\n' +
          '• F3 -> Toggle OSNAP\n' +
          '• F8 / Shift -> Toggle ORTHO\n' +
          '• F7 -> Toggle Grid'
      )
    );
  }
}

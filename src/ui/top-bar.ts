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
import { svgIcon } from './icons';
import { i18n, tr } from '../i18n/lang';

export class TopBar {
  private element: HTMLDivElement;
  private currentFileName: string = 'Projekt_CAD.nanodraft';

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

    this.doc.addChangeListener(() => {
      this.updateActiveLayerSelect();
      this.updateSaveStatusDot();
    });
    i18n.onChange(() => this.render());

    // Close file dropdown on outside click
    window.addEventListener('click', (e) => {
      const wrapper = this.element.querySelector('.file-menu-wrapper');
      const menu = this.element.querySelector('#file-dropdown-menu');
      if (menu && wrapper && !wrapper.contains(e.target as Node)) {
        menu.classList.remove('open');
      }
    });
  }

  private getActiveLayerColor(): string {
    const layer = this.doc.layers.find(l => l.id === this.doc.activeLayerId);
    return layer?.color || '#00E5FF';
  }

  private render() {
    const activeColor = this.getActiveLayerColor();
    const isDirty = this.doc.isDirty && this.doc.entities.length > 0;

    this.element.innerHTML = `
      <!-- LEFT SECTION: Brand, Document Menu & Quick Layer Selector -->
      <div class="top-left">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="brand-mark">📐</span>
          <span class="logo-title">NanoDraft <span class="logo-title-sub">2D</span></span>
          <span class="logo-badge">v2.0</span>
        </div>

        <div class="top-separator"></div>

        <!-- File Name Dropdown & Save Status Dot -->
        <div class="file-menu-wrapper">
          <button id="btn-file-menu" type="button" class="file-menu-trigger" title="${tr('Menu pliku (Nowy, Zapisz, Otwórz, AutoLISP)', 'File menu (New, Save, Open, AutoLISP)')}">
            <span id="current-file-label">${this.currentFileName}</span>
            ${svgIcon('expand_more', 14)}
          </button>
          <span id="save-status-dot" class="save-status-dot ${isDirty ? 'dirty' : ''}" title="${
            isDirty
              ? tr('Zmiany robocze (chronione przez Auto-Zapis)', 'Unsaved changes (protected by Auto-Save)')
              : tr('Zapisano automatycznie lokalnie', 'Saved locally')
          }"></span>

          <!-- Quick File Action Icons -->
          <button id="btn-new" class="top-icon-btn" title="${tr('Nowy rysunek (Wyczyść arkusz)', 'New drawing (Clear canvas)')}">
            ${svgIcon('note_add', 15)}
          </button>
          <button id="btn-save" class="top-icon-btn" title="${tr('Zapisz projekt (.nanodraft)', 'Save project (.nanodraft)')}">
            ${svgIcon('save', 15)}
          </button>
          <button id="btn-load" class="top-icon-btn" title="${tr('Otwórz projekt (.nanodraft, .json, .dxf)', 'Open project (.nanodraft, .json, .dxf)')}">
            ${svgIcon('folder_open', 15)}
          </button>

          <!-- Dropdown Menu -->
          <div id="file-dropdown-menu" class="file-dropdown-menu">
            <button id="menu-new" class="file-dropdown-item">
              <span style="display:flex; align-items:center; gap:7px;">${svgIcon('note_add', 15)} ${tr('Nowy rysunek', 'New Drawing')}</span>
              <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);">Clean</span>
            </button>
            <button id="menu-save" class="file-dropdown-item">
              <span style="display:flex; align-items:center; gap:7px;">${svgIcon('save', 15)} ${tr('Zapisz projekt (.nanodraft)', 'Save Project (.nanodraft)')}</span>
              <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);">JSON</span>
            </button>
            <button id="menu-load" class="file-dropdown-item">
              <span style="display:flex; align-items:center; gap:7px;">${svgIcon('folder_open', 15)} ${tr('Otwórz / Importuj (.dxf)', 'Open / Import (.dxf)')}</span>
              <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);">DXF</span>
            </button>
            <div class="file-dropdown-divider"></div>
            <button id="btn-lisp" class="file-dropdown-item">
              <span style="display:flex; align-items:center; gap:7px;">${svgIcon('terminal', 15)} ${tr('Generuj skrypt AutoLISP (.lsp)', 'Generate AutoLISP Script (.lsp)')}</span>
              <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-muted);">.LSP</span>
            </button>
          </div>
        </div>

        <input type="file" id="file-input" accept=".nanodraft,.minicad,.json,.dxf" style="display:none" />

        <div class="top-separator"></div>

        <!-- Quick Layer Selector with Color Dot -->
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:11px; color:var(--text-muted);">${tr('Warstwa:', 'Layer:')}</span>
          <div class="header-layer-picker">
            <span id="header-layer-dot" class="header-layer-dot" style="background:${activeColor};"></span>
            <select id="active-layer-select" class="header-layer-select">
              ${this.doc.layers.map(l => `<option value="${l.id}" ${l.id === this.doc.activeLayerId ? 'selected' : ''}>${l.name}</option>`).join('')}
            </select>
          </div>
          <button id="btn-layers" class="top-btn" title="${tr('Menedżer warstw (kolory, grubości, blokady, ukrywanie)', 'Layer Manager (colors, lineweights, locks, visibility)')}">
            <span style="color:#00E5FF; display:inline-flex;">${svgIcon('layers', 15)}</span>
            <span>${tr('Warstwy', 'Layers')}</span>
          </button>
        </div>
      </div>

      <!-- CENTER SECTION: Operational CAD Modules (Projekty, Podkład, BOM, Tabliczka ISO) -->
      <div class="top-center">
        <button id="btn-projects" class="top-btn" title="${tr('Wczytaj projekt z katalogu Projects/', 'Load a project from the Projects/ directory')}">
          <span style="color:#FBBF24; display:inline-flex;">${svgIcon('folder_open', 15)}</span>
          <span>${tr('Projekty', 'Projects')}</span>
        </button>

        <button id="btn-underlay" class="top-btn" title="${tr('Wczytaj podkład rastrowy (PNG/JPG) i skalibruj go 2 punktami do skali 1:1', 'Load raster underlay (PNG/JPG) and calibrate scale with 2 points')}">
          <span style="color:#38BDF8; display:inline-flex;">${svgIcon('image', 15)}</span>
          <span>${tr('Podkład', 'Underlay')}</span>
        </button>

        <button id="btn-bom" class="top-btn" title="${tr('Automatyczne zestawienie bloków, grup i długości warstw (BOM / Excel CSV)', 'Automatic Bill of Materials for blocks, groups & layers (BOM / CSV)')}">
          <span style="color:#818CF8; display:inline-flex;">${svgIcon('table_chart', 15)}</span>
          <span>BOM</span>
        </button>

        <button id="btn-titleblock" class="top-btn" title="${tr('Konfigurator tabliczki rysunkowej PN-ISO 7200 i arkusza (A4–A0)', 'ISO Title Block Configurator (A4–A0)')}">
          <span style="color:#2DD4BF; display:inline-flex;">${svgIcon('article', 15)}</span>
          <span>${tr('Tabliczka', 'Title Block')}</span>
        </button>
      </div>

      <!-- RIGHT SECTION: Export DXF, Print PDF, Offline Portable, LISP, Stream Deck, Lang -->
      <div class="top-actions">
        <button id="btn-dxf" class="top-btn cta-dxf" title="${tr('Eksportuj do pliku DXF zgodnego z AutoCAD / ZWCAD', 'Export to AutoCAD / ZWCAD compatible DXF')}">
          ${svgIcon('download', 15)}
          <span>DXF</span>
        </button>

        <button id="btn-print" class="top-btn" title="${tr('Drukuj lub generuj wektorowy PDF w wybranym formacie ISO i skali', 'Print or generate scaled ISO PDF')}">
          <span style="color:#CBD5E1; display:inline-flex;">${svgIcon('print', 15)}</span>
          <span>PDF</span>
        </button>

        <button id="btn-download-app" class="top-btn btn-portable" title="${tr('Pobierz samowystarczalny plik NanoDraft_Portable.html i pracuj w 100% offline bez instalacji', 'Download standalone NanoDraft_Portable.html for 100% offline use')}">
          ${svgIcon('package_2', 15)}
          <span>Portable</span>
        </button>

        <div class="top-separator"></div>

        <button id="btn-lisp-console" class="top-icon-btn" title="${tr('Konsola poleceń AutoLISP', 'AutoLISP Command Console')}">
          ${svgIcon('terminal', 17)}
        </button>

        <button id="btn-streamdeck" class="top-icon-btn" title="${tr('Skróty klawiszowe i konfiguracja Elgato Stream Deck', 'Keyboard Shortcuts & Elgato Stream Deck')}">
          ${svgIcon('sports_esports', 17)}
        </button>

        <button id="btn-lang" class="top-btn" style="font-family:var(--font-mono); font-size:10px; padding:4px 8px;" title="${tr('Przełącz język na Angielski (Switch to English)', 'Przełącz język na Polski (Switch to Polish)')}">
          ${i18n.lang === 'pl' ? 'PL' : 'EN'}
        </button>
      </div>
    `;

    // File Dropdown Toggle
    const fileMenuBtn = this.element.querySelector('#btn-file-menu');
    const fileDropdown = this.element.querySelector('#file-dropdown-menu');
    fileMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileDropdown?.classList.toggle('open');
    });

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

    const handleNew = () => {
      fileDropdown?.classList.remove('open');
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
      this.currentFileName = 'Nowy_Projekt.nanodraft';
      this.transform.resetView();
      this.render();
      this.requestRender();
    };

    this.element.querySelector('#btn-new')?.addEventListener('click', handleNew);
    this.element.querySelector('#menu-new')?.addEventListener('click', handleNew);

    const handleSave = () => {
      fileDropdown?.classList.remove('open');
      JsonIO.downloadProject(this.doc, this.currentFileName);
      this.doc.markClean();
      this.updateSaveStatusDot();
    };

    this.element.querySelector('#btn-save')?.addEventListener('click', handleSave);
    this.element.querySelector('#menu-save')?.addEventListener('click', handleSave);

    const fileInput = this.element.querySelector('#file-input') as HTMLInputElement;
    const handleLoadClick = () => {
      fileDropdown?.classList.remove('open');
      fileInput?.click();
    };

    this.element.querySelector('#btn-load')?.addEventListener('click', handleLoadClick);
    this.element.querySelector('#menu-load')?.addEventListener('click', handleLoadClick);

    // Projects Directory (/Projects) button
    this.element.querySelector('#btn-projects')?.addEventListener('click', () => {
      ProjectsModal.open(
        this.doc,
        this.history,
        this.transform,
        (loadedName?: string) => {
          if (loadedName) this.currentFileName = loadedName;
          this.render();
          this.requestRender();
        },
        () => {
          fileInput.click();
        }
      );
    });

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        this.currentFileName = file.name;
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
                this.render();
                this.requestRender();
              }
            } else {
              if (JsonIO.loadFromJson(content, this.doc)) {
                this.doc.markClean();
                this.render();
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
      fileDropdown?.classList.remove('open');
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

  private updateSaveStatusDot() {
    const dot = this.element.querySelector('#save-status-dot') as HTMLElement | null;
    if (!dot) return;
    const isDirty = this.doc.isDirty && this.doc.entities.length > 0;
    dot.classList.toggle('dirty', isDirty);
  }

  private updateActiveLayerSelect() {
    const select = this.element.querySelector('#active-layer-select') as HTMLSelectElement;
    if (select) {
      select.innerHTML = this.doc.layers
        .map(l => `<option value="${l.id}" ${l.id === this.doc.activeLayerId ? 'selected' : ''}>${l.name}</option>`)
        .join('');
    }
    const dot = this.element.querySelector('#header-layer-dot') as HTMLElement | null;
    if (dot) {
      dot.style.background = this.getActiveLayerColor();
    }
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
        'Konfiguracja klawiszy dla Elgato Stream Deck (NanoDraft Studio v2.0):\n\n' +
          'Skróty klawiszowe (Hotkeys):\n' +
          '• S -> Zaznacz (Select) | Q -> Zmierz (Odległość / Pole m²)\n' +
          '• L -> Linia | W -> Polilinia | R -> Prostokąt\n' +
          '• C -> Okrąg | A -> Łuk | U -> Fasolka / Wielokąt\n' +
          '• P -> Punkt | H -> Kreskuj (Hatch)\n' +
          '• M -> Przesuń | K -> Kopiuj | O -> Obróć | I -> Lustro\n' +
          '• V -> Skaluj | F -> Odsuń (Offset) | Y -> Szyk (Array)\n' +
          '• G -> Zaokrąglij / Fazuj | X -> Przytnij / Wydłuż\n' +
          '• J -> Pędzel właściwości | E -> Rozbij (Explode)\n' +
          '• D -> Wymiarowanie (1-Auto, 2-Lin, 3-Ø, 4-R, 5-∠, 6-⌒)\n' +
          '• N -> Odnośnik (Leader) | T -> Tekst | B -> Biblioteka Bloków\n' +
          '• Z / 2x ŚPM -> Dopasuj widok | Home -> Punkt (0,0)\n' +
          '• F3 -> OSNAP | F8 / Shift -> ORTHO | F7 -> GRID | F12 -> HUD',
        'Elgato Stream Deck Hotkey Reference (NanoDraft Studio v2.0):\n\n' +
          'Keyboard Shortcuts:\n' +
          '• S -> Select | Q -> Measure (Distance / Area m²)\n' +
          '• L -> Line | W -> Polyline | R -> Rectangle\n' +
          '• C -> Circle | A -> Arc | U -> Slot / Polygon\n' +
          '• P -> Point | H -> Hatch\n' +
          '• M -> Move | K -> Copy | O -> Rotate | I -> Mirror\n' +
          '• V -> Scale | F -> Offset | Y -> Array\n' +
          '• G -> Fillet / Chamfer | X -> Trim / Extend\n' +
          '• J -> Match Properties | E -> Explode\n' +
          '• D -> Dimension (1-Smart, 2-Linear, 3-Ø, 4-R, 5-∠, 6-⌒)\n' +
          '• N -> Leader Callout | T -> Text | B -> Blocks Library\n' +
          '• Z / Double MMB -> Zoom to Fit | Home -> Origin (0,0)\n' +
          '• F3 -> OSNAP | F8 / Shift -> ORTHO | F7 -> GRID | F12 -> HUD'
      )
    );
  }
}

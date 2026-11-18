import { CadDocument } from '../model/document';
import { ViewportTransform } from '../math/transform';
import { SnapEngine } from '../engine/snap';
import { CadGrid } from '../engine/grid';
import { DynamicHud } from './hud';
import { Point2D, UnitType } from '../types/cad';
import { VectorMath } from '../math/vector';
import { AutoSaveManager, AutoSaveStatusInfo } from '../io/auto-save';
import { i18n, tr } from '../i18n/lang';

export class StatusBar {
  private element: HTMLDivElement;
  private hintSpan: HTMLSpanElement;
  private autoSaveSpan: HTMLSpanElement;
  private coordsSpan: HTMLSpanElement;
  private zoomSpan: HTMLSpanElement;
  private unitLabel: HTMLSpanElement;
  private unitSelect: HTMLSelectElement;
  private snapBtn: HTMLButtonElement;
  private orthoBtn: HTMLButtonElement;
  private gridBtn: HTMLButtonElement;
  private hudBtn: HTMLButtonElement;
  private lastAutoSaveInfo: AutoSaveStatusInfo | null = null;
  private hud?: DynamicHud;

  constructor(
    private doc: CadDocument,
    private transform: ViewportTransform,
    private snapEngine: SnapEngine,
    private grid: CadGrid,
    parent: HTMLElement,
    private requestRender: () => void,
    hud?: DynamicHud
  ) {
    this.hud = hud;
    this.element = document.createElement('div');
    this.element.className = 'cad-status-bar';

    // Left side: status dot + hint
    const leftSide = document.createElement('div');
    leftSide.className = 'status-left';

    const dot = document.createElement('span');
    dot.className = 'status-ready-dot';
    leftSide.appendChild(dot);

    this.hintSpan = document.createElement('span');
    this.hintSpan.className = 'status-hint';
    this.hintSpan.textContent = tr('Gotowy. Wskaż obiekt lub wybierz narzędzie kreślarskie.', 'Ready. Click an object or select a drafting tool.');
    leftSide.appendChild(this.hintSpan);

    this.element.appendChild(leftSide);

    // Right side: controls & coords
    const rightSide = document.createElement('div');
    rightSide.className = 'status-right';

    // Auto-Save subtle indicator
    this.autoSaveSpan = document.createElement('span');
    this.autoSaveSpan.className = 'status-autosave';
    this.autoSaveSpan.style.cssText = 'font-size:10px; color:var(--text-muted); margin-right:4px; white-space:nowrap;';
    rightSide.appendChild(this.autoSaveSpan);

    // Coords pill
    this.coordsSpan = document.createElement('span');
    this.coordsSpan.className = 'status-coords';
    this.coordsSpan.innerHTML = `X: <b>0.00</b>  Y: <b>0.00</b> ${this.doc.unit}`;
    rightSide.appendChild(this.coordsSpan);

    const sep1 = document.createElement('div');
    sep1.style.cssText = 'width:1px; height:14px; background:var(--border-subtle);';
    rightSide.appendChild(sep1);

    // Unit selector
    const unitContainer = document.createElement('div');
    unitContainer.className = 'status-unit-container';
    this.unitLabel = document.createElement('span');
    this.unitLabel.className = 'status-label';
    this.unitLabel.style.color = '#94A3B8';
    this.unitLabel.textContent = tr('Jednostka:', 'Unit:');
    unitContainer.appendChild(this.unitLabel);

    this.unitSelect = document.createElement('select');
    this.unitSelect.className = 'status-select';
    ['mm', 'cm', 'm', 'in'].forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === this.doc.unit) opt.selected = true;
      this.unitSelect.appendChild(opt);
    });
    this.unitSelect.addEventListener('change', () => {
      const newUnit = this.unitSelect.value as UnitType;
      this.doc.convertUnits(newUnit);
      this.requestRender();
    });
    unitContainer.appendChild(this.unitSelect);
    rightSide.appendChild(unitContainer);

    const sep2 = document.createElement('div');
    sep2.style.cssText = 'width:1px; height:14px; background:var(--border-subtle);';
    rightSide.appendChild(sep2);

    // Function Key Toggle Buttons: OSNAP (F3), ORTHO (F8), GRID (F7), HUD (F12)
    this.snapBtn = document.createElement('button');
    this.snapBtn.className = `status-toggle-btn ${this.snapEngine.enabled ? 'active' : ''}`;
    this.snapBtn.textContent = 'OSNAP (F3)';
    this.snapBtn.addEventListener('click', () => {
      this.snapEngine.enabled = !this.snapEngine.enabled;
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.snapBtn);

    this.orthoBtn = document.createElement('button');
    this.orthoBtn.className = `status-toggle-btn ${this.snapEngine.orthoEnabled ? 'active' : ''}`;
    this.orthoBtn.textContent = 'ORTHO (F8)';
    this.orthoBtn.addEventListener('click', () => {
      this.snapEngine.orthoEnabled = !this.snapEngine.orthoEnabled;
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.orthoBtn);

    this.gridBtn = document.createElement('button');
    this.gridBtn.className = `status-toggle-btn ${this.grid.visible ? 'active' : ''}`;
    this.gridBtn.textContent = 'GRID (F7)';
    this.gridBtn.addEventListener('click', () => {
      this.grid.visible = !this.grid.visible;
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.gridBtn);

    this.hudBtn = document.createElement('button');
    this.hudBtn.className = `status-toggle-btn ${this.hud ? (this.hud.enabled ? 'active' : '') : 'active'}`;
    this.hudBtn.textContent = 'HUD (F12)';
    this.hudBtn.addEventListener('click', () => {
      if (this.hud) {
        this.hud.setEnabled(!this.hud.enabled);
      }
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.hudBtn);

    const sep3 = document.createElement('div');
    sep3.style.cssText = 'width:1px; height:14px; background:var(--border-subtle);';
    rightSide.appendChild(sep3);

    // Zoom
    this.zoomSpan = document.createElement('span');
    this.zoomSpan.className = 'status-zoom';
    this.zoomSpan.innerHTML = 'Zoom: <b>100%</b>';
    rightSide.appendChild(this.zoomSpan);

    this.element.appendChild(rightSide);
    parent.appendChild(this.element);

    this.updateLabels();

    this.doc.addChangeListener(() => {
      if (this.unitSelect.value !== this.doc.unit) {
        this.unitSelect.value = this.doc.unit;
      }
    });

    i18n.onChange(() => this.updateLabels());
  }

  public attachHud(hud: DynamicHud) {
    this.hud = hud;
    this.updateToggles();
  }

  private updateLabels() {
    this.unitLabel.textContent = tr('Jednostka:', 'Unit:');
    this.snapBtn.title = tr(
      'Przyciąganie obiektowe OSNAP (F3): Koniec, Środek, Przecięcie, Prostopadłość (∟), Styczność (TAN)',
      'Object Snap OSNAP (F3): Endpoint, Midpoint, Intersection, Perpendicular (∟), Tangent (TAN)'
    );
    this.orthoBtn.title = tr('Tryb ortogonalny 90° (F8 lub Shift)', 'Orthogonal mode 90° (F8 or Shift)');
    this.gridBtn.textContent = 'GRID (F7)';
    this.gridBtn.title = tr('Siatka techniczna (F7)', 'Technical grid (F7)');
    this.hudBtn.textContent = 'HUD (F12)';
    this.hudBtn.title = tr('Wprowadzanie dynamiczne HUD przy kursorze (F12)', 'Dynamic input HUD near cursor (F12)');
    if (this.lastAutoSaveInfo) {
      this.updateAutoSaveStatus(this.lastAutoSaveInfo);
    }
  }

  updateAutoSaveStatus(info: AutoSaveStatusInfo) {
    this.lastAutoSaveInfo = info;
    if (info.status === 'saved' && info.savedAt) {
      const t = AutoSaveManager.formatTime(info.savedAt);
      this.autoSaveSpan.textContent = tr(`Auto-zapis ${t}`, `Auto-saved ${t}`);
      this.autoSaveSpan.style.color = '#10B981';
      this.autoSaveSpan.title = tr(
        'Stan rysunku jest automatycznie zapisywany w pamięci przeglądarki (localStorage)',
        'Drawing state is automatically saved in browser storage (localStorage)'
      );
    } else if (info.status === 'restored' && info.savedAt) {
      const t = AutoSaveManager.formatTime(info.savedAt);
      this.autoSaveSpan.textContent = tr(`Przywrócono (${t})`, `Restored (${t})`);
      this.autoSaveSpan.style.color = '#00E5FF';
    } else if (info.status === 'quota-exceeded') {
      this.autoSaveSpan.textContent = tr('⚠️ Limit pamięci', '⚠️ Storage full');
      this.autoSaveSpan.style.color = '#F59E0B';
    } else {
      this.autoSaveSpan.textContent = '';
    }
  }

  setHint(text: string) {
    this.hintSpan.textContent =
      text || tr('Gotowy. Wskaż obiekt lub wybierz narzędzie kreślarskie.', 'Ready. Click an object or select a drafting tool.');
  }

  updateCursorCoords(worldPt: Point2D) {
    const xStr = VectorMath.round(worldPt.x).toFixed(2);
    const yStr = VectorMath.round(worldPt.y).toFixed(2);
    this.coordsSpan.innerHTML = `X: <b>${xStr}</b> &nbsp; Y: <b>${yStr}</b> ${this.doc.unit}`;
    const zoomPct = Math.round(this.transform.zoom * 50);
    this.zoomSpan.innerHTML = `Zoom: <b>${zoomPct}%</b>`;
  }

  updateToggles() {
    this.snapBtn.className = `status-toggle-btn ${this.snapEngine.enabled ? 'active' : ''}`;
    this.orthoBtn.className = `status-toggle-btn ${this.snapEngine.isOrthoActive() ? 'active' : ''}`;
    this.gridBtn.className = `status-toggle-btn ${this.grid.visible ? 'active' : ''}`;
    const hudActive = this.hud ? this.hud.enabled : true;
    this.hudBtn.className = `status-toggle-btn ${hudActive ? 'active' : ''}`;
  }
}

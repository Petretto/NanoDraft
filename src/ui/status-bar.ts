import { CadDocument } from '../model/document';
import { ViewportTransform } from '../math/transform';
import { SnapEngine } from '../engine/snap';
import { CadGrid } from '../engine/grid';
import { Point2D, UnitType } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
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
  private fitBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private lastAutoSaveInfo: AutoSaveStatusInfo | null = null;

  constructor(
    private doc: CadDocument,
    private transform: ViewportTransform,
    private snapEngine: SnapEngine,
    private grid: CadGrid,
    parent: HTMLElement,
    private requestRender: () => void
  ) {
    this.element = document.createElement('div');
    this.element.className = 'cad-status-bar';

    // Left side: hint
    this.hintSpan = document.createElement('span');
    this.hintSpan.className = 'status-hint';
    this.hintSpan.textContent = tr('Gotowy.', 'Ready.');
    this.element.appendChild(this.hintSpan);

    // Right side: controls & coords
    const rightSide = document.createElement('div');
    rightSide.className = 'status-right';

    // Auto-Save subtle indicator
    this.autoSaveSpan = document.createElement('span');
    this.autoSaveSpan.className = 'status-autosave';
    this.autoSaveSpan.style.cssText = 'font-size:11px; color:var(--text-muted); margin-right:6px; white-space:nowrap;';
    rightSide.appendChild(this.autoSaveSpan);

    // Coords
    this.coordsSpan = document.createElement('span');
    this.coordsSpan.className = 'status-coords';
    this.coordsSpan.textContent = `X: 0.00 ${this.doc.unit}  Y: 0.00 ${this.doc.unit}`;
    rightSide.appendChild(this.coordsSpan);

    // Zoom
    this.zoomSpan = document.createElement('span');
    this.zoomSpan.className = 'status-zoom';
    this.zoomSpan.textContent = 'Zoom: 100%';
    rightSide.appendChild(this.zoomSpan);

    // Unit selector
    const unitContainer = document.createElement('div');
    unitContainer.className = 'status-unit-container';
    this.unitLabel = document.createElement('span');
    this.unitLabel.className = 'status-label';
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

    // Snap button (F3)
    this.snapBtn = document.createElement('button');
    this.snapBtn.className = `status-toggle-btn ${this.snapEngine.enabled ? 'active' : ''}`;
    this.snapBtn.textContent = 'OSNAP (F3)';
    this.snapBtn.addEventListener('click', () => {
      this.snapEngine.enabled = !this.snapEngine.enabled;
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.snapBtn);

    // Ortho button (F8)
    this.orthoBtn = document.createElement('button');
    this.orthoBtn.className = `status-toggle-btn ${this.snapEngine.orthoEnabled ? 'active' : ''}`;
    this.orthoBtn.textContent = 'ORTHO (F8)';
    this.orthoBtn.addEventListener('click', () => {
      this.snapEngine.orthoEnabled = !this.snapEngine.orthoEnabled;
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.orthoBtn);

    // Grid button (F7)
    this.gridBtn = document.createElement('button');
    this.gridBtn.className = `status-toggle-btn ${this.grid.visible ? 'active' : ''}`;
    this.gridBtn.addEventListener('click', () => {
      this.grid.visible = !this.grid.visible;
      this.updateToggles();
      this.requestRender();
    });
    rightSide.appendChild(this.gridBtn);

    // Fit view (Zoom Extents - Z)
    this.fitBtn = document.createElement('button');
    this.fitBtn.className = 'status-toggle-btn';
    this.fitBtn.addEventListener('click', () => {
      const bounds = Geometry.unionBounds(this.doc.entities);
      if (bounds) {
        this.transform.zoomToFit(bounds);
      } else {
        this.transform.resetView();
      }
      this.requestRender();
    });
    rightSide.appendChild(this.fitBtn);

    // Reset view (Home)
    this.resetBtn = document.createElement('button');
    this.resetBtn.className = 'status-toggle-btn';
    this.resetBtn.textContent = '0,0 (Home)';
    this.resetBtn.addEventListener('click', () => {
      this.transform.resetView();
      this.requestRender();
    });
    rightSide.appendChild(this.resetBtn);

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

  private updateLabels() {
    this.unitLabel.textContent = tr('Jednostka:', 'Unit:');
    this.snapBtn.title = tr(
      'Przełącz przyciąganie obiektowe OSNAP (F3): Końce, Środki, Przecięcia, Prostopadłość (∟) i Styczność (TAN)',
      'Toggle Object Snap OSNAP (F3): Endpoints, Midpoints, Intersections, Perpendicular (∟) & Tangent (TAN)'
    );
    this.orthoBtn.title = tr('Blokuj kąty proste 0°/90° (F8 lub Shift)', 'Lock Ortho angles 0°/90° (F8 or Shift)');
    this.gridBtn.textContent = tr('SIATKA (F7)', 'GRID (F7)');
    this.gridBtn.title = tr('Przełącz widoczność siatki (F7)', 'Toggle grid visibility (F7)');
    this.fitBtn.textContent = tr('Dopasuj (Z)', 'Fit View (Z)');
    this.fitBtn.title = tr('Dopasuj widok do wszystkich obiektów (Z lub 2x ŚPM)', 'Zoom to fit all objects (Z or Double MMB)');
    this.resetBtn.title = tr('Wyśrodkuj widok na punkt 0,0 (Home)', 'Reset view to origin 0,0 (Home)');
    if (this.hintSpan.textContent === 'Gotowy.' || this.hintSpan.textContent === 'Ready.') {
      this.hintSpan.textContent = tr('Gotowy.', 'Ready.');
    }
    if (this.lastAutoSaveInfo) {
      this.updateAutoSaveStatus(this.lastAutoSaveInfo);
    }
  }

  updateAutoSaveStatus(info: AutoSaveStatusInfo) {
    this.lastAutoSaveInfo = info;
    if (info.status === 'saved' && info.savedAt) {
      const t = AutoSaveManager.formatTime(info.savedAt);
      this.autoSaveSpan.textContent = tr(`💾 Auto-zapis ${t}`, `💾 Auto-saved ${t}`);
      this.autoSaveSpan.style.color = '#66bb6a';
      this.autoSaveSpan.title = tr(
        'Stan rysunku jest automatycznie zapisywany w pamięci przeglądarki (localStorage)',
        'Drawing state is automatically saved in browser storage (localStorage)'
      );
    } else if (info.status === 'restored' && info.savedAt) {
      const t = AutoSaveManager.formatTime(info.savedAt);
      this.autoSaveSpan.textContent = tr(`💾 Przywrócono (${t})`, `💾 Restored (${t})`);
      this.autoSaveSpan.style.color = '#00e5ff';
    } else if (info.status === 'quota-exceeded') {
      this.autoSaveSpan.textContent = tr('⚠️ Auto-zapis: limit pamięci', '⚠️ Auto-save: storage full');
      this.autoSaveSpan.style.color = '#ffb74d';
    } else {
      this.autoSaveSpan.textContent = '';
    }
  }

  setHint(text: string) {
    this.hintSpan.textContent = text || tr('Gotowy.', 'Ready.');
  }

  updateCursorCoords(worldPt: Point2D) {
    this.coordsSpan.textContent = `X: ${VectorMath.round(worldPt.x)} ${this.doc.unit}  Y: ${VectorMath.round(worldPt.y)} ${this.doc.unit}`;
    const zoomPct = Math.round(this.transform.zoom * 50);
    this.zoomSpan.textContent = `Zoom: ${zoomPct}%`;
  }

  updateToggles() {
    this.snapBtn.className = `status-toggle-btn ${this.snapEngine.enabled ? 'active' : ''}`;
    this.orthoBtn.className = `status-toggle-btn ${this.snapEngine.isOrthoActive() ? 'active' : ''}`;
    this.gridBtn.className = `status-toggle-btn ${this.grid.visible ? 'active' : ''}`;
  }
}

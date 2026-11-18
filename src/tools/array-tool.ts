import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity, CircleEntity, PointEntity } from '../types/cad';
import { Geometry } from '../math/geometry';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type ArrayMode = 'rect' | 'polar';

export class ArrayTool extends BaseTool {
  readonly id = 'array';
  readonly name = 'Szyk (Array)';
  readonly shortcut = 'Y';

  private mode: ArrayMode = 'rect';
  private cols: number = 3;
  private rows: number = 2;
  private spacingX: number = 20;
  private spacingY: number = 20;

  private polarCount: number = 6;
  private polarAngleDeg: number = 360;
  private rotateItems: boolean = true;
  private polarCenter: Point2D | null = null; // Locked center point after user clicks on canvas
  private isPickingPolarCenter: boolean = true; // True when waiting for user to click the center point
  private currentPt: Point2D | null = null;

  private modeBarEl: HTMLDivElement | null = null;
  private lastContext: ToolContext | null = null;

  constructor() {
    super();
    i18n.onChange(() => {
      if (this.modeBarEl && this.modeBarEl.style.display !== 'none' && this.lastContext) {
        this.ensureModeBar(this.lastContext);
        this.updateHint(this.lastContext);
      }
    });
  }

  activate(context: ToolContext) {
    this.lastContext = context;
    this.polarCenter = null;
    this.isPickingPolarCenter = true;

    // Auto-estimate default spacing from selection bounds if available
    const sel = context.doc.getSelectedEntities();
    if (sel.length > 0) {
      const b = Geometry.unionBounds(sel);
      if (b) {
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        if (w > 0) this.spacingX = Math.round(w * 1.5 * 100) / 100;
        if (h > 0) this.spacingY = Math.round(h * 1.5 * 100) / 100;
      }
    }

    this.ensureModeBar(context);
    this.updateHint(context);
    context.requestRender();
  }

  deactivate(context: ToolContext) {
    this.polarCenter = null;
    this.isPickingPolarCenter = true;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
    context.requestRender();
  }

  cancel(context: ToolContext) {
    this.polarCenter = null;
    this.isPickingPolarCenter = true;
    this.ensureModeBar(context);
    this.updateHint(context);
    context.requestRender();
  }

  private ensureModeBar(context: ToolContext) {
    const viewport = document.querySelector('.cad-viewport-container') as HTMLElement;
    if (!viewport) return;

    if (!this.modeBarEl) {
      this.modeBarEl = document.createElement('div');
      this.modeBarEl.className = 'cad-dim-mode-bar';
      this.modeBarEl.addEventListener('mousedown', e => e.stopPropagation());
      viewport.appendChild(this.modeBarEl);
    }

    this.modeBarEl.style.display = 'flex';

    if (this.mode === 'rect') {
      this.modeBarEl.innerHTML = `
        <span class="dim-bar-title">▦ ${tr('Szyk:', 'Array:')}</span>
        <button class="dim-mode-btn active" data-mode="rect">▦ ${tr('Prostokątny', 'Rectangular')}</button>
        <button class="dim-mode-btn" data-mode="polar">❂ ${tr('Kołowy', 'Polar')}</button>

        <span style="font-size:11px; color:var(--text-muted); margin-left:4px;">${tr('Kol.:', 'Cols:')}</span>
        <input id="arr-cols" type="number" min="1" max="50" value="${this.cols}" class="prop-input" style="width:46px; height:24px; padding:2px 4px;" />

        <span style="font-size:11px; color:var(--text-muted);">${tr('Wiersze:', 'Rows:')}</span>
        <input id="arr-rows" type="number" min="1" max="50" value="${this.rows}" class="prop-input" style="width:46px; height:24px; padding:2px 4px;" />

        <span style="font-size:11px; color:var(--text-muted);">ΔX [${context.doc.unit}]:</span>
        <input id="arr-dx" type="number" step="1" value="${this.spacingX}" class="prop-input" style="width:62px; height:24px; padding:2px 4px;" />

        <span style="font-size:11px; color:var(--text-muted);">ΔY [${context.doc.unit}]:</span>
        <input id="arr-dy" type="number" step="1" value="${this.spacingY}" class="prop-input" style="width:62px; height:24px; padding:2px 4px;" />

        <button id="arr-apply-btn" class="top-btn highlight" style="height:24px; padding:0 10px; font-size:11px;">
          ✅ ${tr('Utwórz szyk', 'Create Array')}
        </button>
      `;
    } else {
      const centerText = this.polarCenter
        ? `(${VectorMath.round(this.polarCenter.x, 1)}, ${VectorMath.round(this.polarCenter.y, 1)})`
        : tr('Kliknij na rysunku...', 'Click on drawing...');

      this.modeBarEl.innerHTML = `
        <span class="dim-bar-title">❂ ${tr('Szyk:', 'Array:')}</span>
        <button class="dim-mode-btn" data-mode="rect">▦ ${tr('Prostokątny', 'Rectangular')}</button>
        <button class="dim-mode-btn active" data-mode="polar">❂ ${tr('Kołowy', 'Polar')}</button>

        <button id="arr-pick-center-btn" class="dim-mode-btn ${this.isPickingPolarCenter ? 'active' : ''}" title="${tr('Kliknij, aby wskazać środek obrotu na płótnie', 'Click to pick center of rotation on canvas')}">
          🎯 ${tr('Środek:', 'Center:')} ${centerText}
        </button>

        <span style="font-size:11px; color:var(--text-muted); margin-left:4px;">${tr('Kąt [°]:', 'Angle [°]:')}</span>
        <input id="arr-pangle" type="number" min="-360" max="360" step="15" value="${this.polarAngleDeg}" class="prop-input" style="width:56px; height:24px; padding:2px 4px;" />

        <span style="font-size:11px; color:var(--text-muted);">${tr('Ilość (N):', 'Count (N):')}</span>
        <input id="arr-pcount" type="number" min="2" max="72" value="${this.polarCount}" class="prop-input" style="width:48px; height:24px; padding:2px 4px;" />

        <label style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:3px; cursor:pointer;" title="${tr('Obracaj kopie obiektów wokół środka szyku', 'Rotate copied items around array center')}">
          <input id="arr-protate" type="checkbox" ${this.rotateItems ? 'checked' : ''} />
          ${tr('Obracaj', 'Rotate')}
        </label>

        <button id="arr-polar-apply-btn" class="top-btn highlight" ${!this.polarCenter ? 'disabled' : ''} style="height:24px; padding:0 10px; font-size:11px;">
          ✅ ${tr('Utwórz szyk', 'Create Array')}
        </button>
      `;
    }

    this.modeBarEl.querySelectorAll('.dim-mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = (btn as HTMLElement).getAttribute('data-mode') as ArrayMode;
        if (m && m !== this.mode) {
          this.mode = m;
          this.polarCenter = null;
          this.isPickingPolarCenter = true;
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });

    this.modeBarEl.querySelector('#arr-pick-center-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      this.isPickingPolarCenter = true;
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
    });

    this.modeBarEl.querySelector('#arr-protate')?.addEventListener('change', e => {
      this.rotateItems = (e.target as HTMLInputElement).checked;
      context.requestRender();
    });

    this.modeBarEl.querySelectorAll('input[type="number"]').forEach(inp => {
      inp.addEventListener('keydown', (ev: Event) => {
        const e = ev as KeyboardEvent;
        e.stopPropagation();
        if (e.key === 'Enter') {
          if (this.mode === 'rect') {
            this.commitRectArray(context);
          } else if (this.polarCenter) {
            this.commitPolarArray(this.polarCenter, context);
          }
        }
      });
      inp.addEventListener('input', () => {
        if (this.mode === 'rect') {
          this.cols = Math.max(1, Math.min(50, parseInt((this.modeBarEl!.querySelector('#arr-cols') as HTMLInputElement).value) || 1));
          this.rows = Math.max(1, Math.min(50, parseInt((this.modeBarEl!.querySelector('#arr-rows') as HTMLInputElement).value) || 1));
          this.spacingX = parseFloat((this.modeBarEl!.querySelector('#arr-dx') as HTMLInputElement).value) || 0;
          this.spacingY = parseFloat((this.modeBarEl!.querySelector('#arr-dy') as HTMLInputElement).value) || 0;
        } else {
          this.polarCount = Math.max(2, Math.min(72, parseInt((this.modeBarEl!.querySelector('#arr-pcount') as HTMLInputElement).value) || 6));
          this.polarAngleDeg = parseFloat((this.modeBarEl!.querySelector('#arr-pangle') as HTMLInputElement).value) || 360;
        }
        this.updateHint(context);
        context.requestRender();
      });
    });

    this.modeBarEl.querySelector('#arr-apply-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      this.commitRectArray(context);
    });

    this.modeBarEl.querySelector('#arr-polar-apply-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      if (this.polarCenter) {
        this.commitPolarArray(this.polarCenter, context);
      }
    });
  }

  private updateHint(context: ToolContext) {
    const sel = context.doc.getSelectedEntities();
    if (sel.length === 0) {
      context.setHint(
        tr(
          'SZYK (Array): Krok 1 — Kliknij na obiekt (lub grupę) na rysunku, który chcesz powielić w szyku!',
          'ARRAY: Step 1 — Click on the object (or group) on the drawing that you want to array!'
        )
      );
      return;
    }

    if (this.mode === 'rect') {
      context.setHint(
        tr(
          `SZYK PROSTOKĄTNY: Ustaw kolumny (${this.cols}), wiersze (${this.rows}), odstęp ΔX/ΔY na pasku u góry i kliknij „Utwórz szyk” (lub Enter)`,
          `RECTANGULAR ARRAY: Set columns (${this.cols}), rows (${this.rows}), ΔX/ΔY on the top bar and click "Create Array" (or Enter)`
        )
      );
    } else {
      if (!this.polarCenter || this.isPickingPolarCenter) {
        context.setHint(
          tr(
            'SZYK KOŁOWY: Krok 2 — Kliknij na rysunku punkt ŚRODKA OBROTU (możesz użyć przyciągania OSNAP, np. do środka okręgu)',
            'POLAR ARRAY: Step 2 — Click the CENTER OF ROTATION point on the drawing (OSNAP supported)'
          )
        );
      } else {
        context.setHint(
          tr(
            `SZYK KOŁOWY: Krok 3 — Sprawdź Kąt (${this.polarAngleDeg}°) i Ilość elementów (${this.polarCount}) na pasku u góry, a następnie kliknij „Utwórz szyk” (lub Enter)`,
            `POLAR ARRAY: Step 3 — Adjust Angle (${this.polarAngleDeg}°) and Count (${this.polarCount}) on the top bar, then click "Create Array" (or Enter)`
          )
        );
      }
    }
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    const sel = context.doc.getSelectedEntities();
    if (sel.length === 0) {
      // Step 1: Allow clicking an entity directly to select it
      const tol = 8 / context.transform.zoom;
      for (let i = context.doc.entities.length - 1; i >= 0; i--) {
        const ent = context.doc.entities[i];
        const b = Geometry.entityBounds(ent);
        if (b && worldPt.x >= b.minX - tol && worldPt.x <= b.maxX + tol && worldPt.y >= b.minY - tol && worldPt.y <= b.maxY + tol) {
          context.doc.selectEntity(ent.id, false);
          const bounds = Geometry.unionBounds(context.doc.getSelectedEntities());
          if (bounds) {
            const w = bounds.maxX - bounds.minX;
            const h = bounds.maxY - bounds.minY;
            if (w > 0) this.spacingX = Math.round(w * 1.5 * 100) / 100;
            if (h > 0) this.spacingY = Math.round(h * 1.5 * 100) / 100;
          }
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
          return;
        }
      }
      return;
    }

    if (this.mode === 'polar') {
      // Step 2: Pick and lock the center of rotation!
      const center = snapPt ? { ...snapPt.point } : { ...worldPt };
      this.polarCenter = center;
      this.isPickingPolarCenter = false;
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
    }
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    this.currentPt = snapPt ? { ...snapPt.point } : { ...worldPt };
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    if (e.key === 'Enter') {
      if (this.mode === 'rect') {
        this.commitRectArray(context);
        return true;
      } else if (this.mode === 'polar' && this.polarCenter) {
        this.commitPolarArray(this.polarCenter, context);
        return true;
      }
    }
    return false;
  }

  private getSourceCentroid(source: CadEntity[]): Point2D {
    const b = Geometry.unionBounds(source);
    if (!b) return { x: 0, y: 0 };
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  private generateRectClones(source: CadEntity[]): CadEntity[] {
    const clones: CadEntity[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 && c === 0) continue; // skip original cell
        const dx = c * this.spacingX;
        const dy = r * this.spacingY;
        const cellClones = source.map(ent => {
          const copy = Geometry.transformEntity(ent, p => ({ x: p.x + dx, y: p.y + dy }));
          copy.selected = false;
          return copy;
        });
        clones.push(...cellClones);
      }
    }
    return clones;
  }

  private generatePolarClones(source: CadEntity[], center: Point2D): CadEntity[] {
    const clones: CadEntity[] = [];
    const isFullCircle = Math.abs(Math.abs(this.polarAngleDeg) - 360) < 1e-4;
    const stepDeg = isFullCircle
      ? this.polarAngleDeg / this.polarCount
      : this.polarAngleDeg / Math.max(1, this.polarCount - 1);

    const srcCentroid = this.getSourceCentroid(source);

    for (let i = 1; i < this.polarCount; i++) {
      const angDeg = i * stepDeg;

      const cellClones = source.map(ent => {
        if (this.rotateItems) {
          const copy = Geometry.transformEntity(
            ent,
            p => Geometry.rotatePoint(p, center, angDeg),
            { angleDeltaDeg: angDeg }
          );
          copy.selected = false;
          return copy;
        } else {
          // Translate item so its centroid orbits `center` without rotating the item itself
          const rotatedCentroid = Geometry.rotatePoint(srcCentroid, center, angDeg);
          const dx = rotatedCentroid.x - srcCentroid.x;
          const dy = rotatedCentroid.y - srcCentroid.y;
          const copy = Geometry.transformEntity(ent, p => ({ x: p.x + dx, y: p.y + dy }));
          copy.selected = false;
          return copy;
        }
      });
      clones.push(...cellClones);
    }
    return clones;
  }

  /**
   * Commits Rectangular Array and automatically groups ALL array elements (including source!)
   * into one group that can be ungrouped at any time (Ctrl+U).
   */
  private commitRectArray(context: ToolContext) {
    const sel = context.doc.getSelectedEntities();
    if (sel.length === 0) return;

    const clones = this.generateRectClones(sel);
    if (clones.length === 0) return;

    const arrayGroupId = `grp_arr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const arrayGroupName = tr(
      `Szyk prostokątny (${this.cols}×${this.rows})`,
      `Rectangular Array (${this.cols}×${this.rows})`
    );
    const prevSourceGroups = sel.map(e => ({ id: e.id, groupId: e.groupId, groupName: e.groupName }));

    for (const c of clones) {
      c.groupId = arrayGroupId;
      c.groupName = arrayGroupName;
    }

    const cmd: Command = {
      description: arrayGroupName,
      execute: () => {
        for (const src of sel) {
          src.groupId = arrayGroupId;
          src.groupName = arrayGroupName;
          src.selected = true;
          context.doc.selectedEntityIds.add(src.id);
        }
        for (const c of clones) {
          c.selected = true;
          context.doc.addEntity(c);
          context.doc.selectedEntityIds.add(c.id);
        }
        context.doc.notifyChange();
      },
      undo: () => {
        for (const c of clones) {
          context.doc.removeEntity(c.id);
        }
        for (const pg of prevSourceGroups) {
          const ent = context.doc.getEntity(pg.id);
          if (ent) {
            ent.groupId = pg.groupId;
            ent.groupName = pg.groupName;
          }
        }
        context.doc.notifyChange();
      },
    };
    context.history.execute(cmd);
    context.requestRender();
  }

  /**
   * Commits Polar Array and automatically groups ALL array elements (including source!)
   * into one group that can be ungrouped at any time (Ctrl+U).
   */
  private commitPolarArray(center: Point2D, context: ToolContext) {
    const sel = context.doc.getSelectedEntities();
    if (sel.length === 0) return;

    const clones = this.generatePolarClones(sel, center);
    if (clones.length === 0) return;

    const arrayGroupId = `grp_arr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const arrayGroupName = tr(
      `Szyk kołowy (${this.polarCount} el.)`,
      `Polar Array (${this.polarCount} items)`
    );
    const prevSourceGroups = sel.map(e => ({ id: e.id, groupId: e.groupId, groupName: e.groupName }));

    for (const c of clones) {
      c.groupId = arrayGroupId;
      c.groupName = arrayGroupName;
    }

    const cmd: Command = {
      description: arrayGroupName,
      execute: () => {
        for (const src of sel) {
          src.groupId = arrayGroupId;
          src.groupName = arrayGroupName;
          src.selected = true;
          context.doc.selectedEntityIds.add(src.id);
        }
        for (const c of clones) {
          c.selected = true;
          context.doc.addEntity(c);
          context.doc.selectedEntityIds.add(c.id);
        }
        context.doc.notifyChange();
      },
      undo: () => {
        for (const c of clones) {
          context.doc.removeEntity(c.id);
        }
        for (const pg of prevSourceGroups) {
          const ent = context.doc.getEntity(pg.id);
          if (ent) {
            ent.groupId = pg.groupId;
            ent.groupName = pg.groupName;
          }
        }
        context.doc.notifyChange();
      },
    };
    context.history.execute(cmd);
    this.polarCenter = null;
    this.isPickingPolarCenter = true;
    this.ensureModeBar(context);
    this.updateHint(context);
    context.requestRender();
  }

  getPreview(): RenderPreview | null {
    if (!this.lastContext) return null;
    const sel = this.lastContext.doc.getSelectedEntities();
    if (sel.length === 0) return null;

    if (this.mode === 'rect') {
      const ghosts = this.generateRectClones(sel);
      if (ghosts.length === 0) return null;
      return {
        type: 'ghost',
        data: {
          entities: ghosts,
          label: `${this.cols} × ${this.rows}`,
        },
      };
    }

    if (this.mode === 'polar') {
      const activeCenter = this.polarCenter || this.currentPt;
      if (!activeCenter) return null;

      const ghosts = this.generatePolarClones(sel, activeCenter);
      const srcCentroid = this.getSourceCentroid(sel);
      const orbitRadius = VectorMath.distance(activeCenter, srcCentroid);

      if (orbitRadius > 1e-3) {
        const orbitCircle: CircleEntity = {
          id: '__preview_polar_orbit',
          type: 'circle',
          layerId: '0',
          lineType: 'dashdot',
          selected: false,
          cx: activeCenter.x,
          cy: activeCenter.y,
          radius: orbitRadius,
        };
        ghosts.push(orbitCircle);
      }

      const centerPtMarker: PointEntity = {
        id: '__preview_polar_center',
        type: 'point',
        layerId: '0',
        selected: false,
        x: activeCenter.x,
        y: activeCenter.y,
      };
      ghosts.push(centerPtMarker);

      return {
        type: 'ghost',
        data: {
          entities: ghosts,
          guideLine: { p1: activeCenter, p2: srcCentroid },
          label: `❂ N=${this.polarCount} (${this.polarAngleDeg}°)`,
        },
      };
    }

    return null;
  }
}

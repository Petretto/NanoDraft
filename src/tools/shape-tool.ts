import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity, PolylineEntity, LineEntity, CircleEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type ShapeToolMode = 'slot' | 'polygon';
export type PolygonCircleMode = 'inscribed' | 'circumscribed';

export class ShapeTool extends BaseTool {
  readonly id = 'polygon';
  readonly name = 'Wielokąt / Fasolka';
  readonly shortcut = 'U';

  private mode: ShapeToolMode = 'slot';

  // Slot state
  private slotP1: Point2D | null = null;
  private slotP2: Point2D | null = null;
  private slotWidth: number = 12; // W = 2*R
  private slotAddAxes: boolean = true;

  // Polygon state
  private polyCenter: Point2D | null = null;
  private polySides: number = 6;
  private polyMode: PolygonCircleMode = 'circumscribed'; // S/2 across flats by default for hex nuts/bolts!
  private polyRadius: number = 10;

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
    this.resetStepState(context);
    if (context.doc.unit === 'm' && this.slotWidth > 2) {
      this.slotWidth = 0.4;
      this.polyRadius = 0.5;
    } else if (context.doc.unit === 'mm' && this.slotWidth < 1) {
      this.slotWidth = 12;
      this.polyRadius = 10;
    }
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.resetStepState(context);
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.resetStepState(context);
    this.updateHint(context);
    context.requestRender();
  }

  private resetStepState(context: ToolContext) {
    this.slotP1 = null;
    this.slotP2 = null;
    this.polyCenter = null;
    this.currentPt = null;
    context.hud.hide();
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

    if (this.mode === 'slot') {
      this.modeBarEl.innerHTML = `
        <span class="dim-bar-title">⬭ ${tr('Kształt:', 'Shape:')}</span>
        <button class="dim-mode-btn active" data-mode="slot" title="${tr('Otwór podłużny — Fasolka montażowa [1]', 'Mounting Slot [1]')}">
          ⬭ ${tr('Fasolka (Slot)', 'Slot')}
        </button>
        <button class="dim-mode-btn" data-mode="polygon" title="${tr('Wielokąt foremny 3–24 boków (np. sześciokąt pod śrubę) [2]', 'Regular Polygon 3–24 sides (e.g. Hex bolt) [2]')}">
          ⬡ ${tr('Wielokąt (Polygon)', 'Polygon')}
        </button>

        <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${tr('Szerokość W=2R', 'Width W=2R')} [${context.doc.unit}]:</span>
        <input id="shp-slot-w" type="number" min="0.1" step="1" value="${this.slotWidth}" class="prop-input" style="width:62px; height:24px; padding:2px 4px;" />

        <label style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:3px; cursor:pointer; margin-left:4px;" title="${tr('Automatycznie dodaj osie symetrii fasolki na warstwie Osie', 'Automatically add centerlines on Axes layer')}">
          <input id="shp-slot-axes" type="checkbox" ${this.slotAddAxes ? 'checked' : ''} />
          ➕ ${tr('Osie', 'Axes')}
        </label>
      `;
    } else {
      this.modeBarEl.innerHTML = `
        <span class="dim-bar-title">⬡ ${tr('Kształt:', 'Shape:')}</span>
        <button class="dim-mode-btn" data-mode="slot">
          ⬭ ${tr('Fasolka (Slot)', 'Slot')}
        </button>
        <button class="dim-mode-btn active" data-mode="polygon">
          ⬡ ${tr('Wielokąt (Polygon)', 'Polygon')}
        </button>

        <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${tr('Boki (N):', 'Sides (N):')}</span>
        <input id="shp-poly-n" type="number" min="3" max="24" step="1" value="${this.polySides}" class="prop-input" style="width:46px; height:24px; padding:2px 4px;" />

        <button class="dim-mode-btn ${this.polySides === 6 ? 'active' : ''}" data-sides="6" title="${tr('Sześciokąt pod śrubę/nakrętkę (N=6)', 'Hexagon for bolt/nut (N=6)')}">6 ⬡</button>
        <button class="dim-mode-btn ${this.polySides === 8 ? 'active' : ''}" data-sides="8" title="${tr('Ośmiokąt (N=8)', 'Octagon (N=8)')}">8 ⯃</button>

        <button class="dim-mode-btn ${this.polyMode === 'circumscribed' ? 'active' : ''}" data-pmode="circumscribed" title="${tr('Opisany na okręgu (promień = połowa rozmiaru pod klucz S/2)', 'Circumscribed about circle (radius = half across-flats S/2)')}">
          🔧 ${tr('Pod klucz (Opisany)', 'Across Flats (Circum.)')}
        </button>
        <button class="dim-mode-btn ${this.polyMode === 'inscribed' ? 'active' : ''}" data-pmode="inscribed" title="${tr('Wpisany w okrąg (promień do narożników)', 'Inscribed in circle (radius to corners)')}">
          ⭕ ${tr('Wpisany (Do rogów)', 'Inscribed (Corners)')}
        </button>
      `;
    }

    this.modeBarEl.querySelectorAll('.dim-mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = (btn as HTMLElement).getAttribute('data-mode') as ShapeToolMode;
        if (m && m !== this.mode) {
          this.mode = m;
          this.resetStepState(context);
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });

    this.modeBarEl.querySelectorAll('.dim-mode-btn[data-sides]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const s = parseInt((btn as HTMLElement).getAttribute('data-sides') || '6', 10);
        this.polySides = s;
        this.ensureModeBar(context);
        this.updateHint(context);
        context.requestRender();
      });
    });

    this.modeBarEl.querySelectorAll('.dim-mode-btn[data-pmode]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pm = (btn as HTMLElement).getAttribute('data-pmode') as PolygonCircleMode;
        if (pm) {
          this.polyMode = pm;
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });

    const slotWInp = this.modeBarEl.querySelector('#shp-slot-w') as HTMLInputElement | null;
    slotWInp?.addEventListener('keydown', e => e.stopPropagation());
    slotWInp?.addEventListener('input', () => {
      const v = parseFloat(slotWInp.value);
      if (!isNaN(v) && v > 0.05) {
        this.slotWidth = v;
        context.requestRender();
      }
    });

    const slotAxesChk = this.modeBarEl.querySelector('#shp-slot-axes') as HTMLInputElement | null;
    slotAxesChk?.addEventListener('change', () => {
      this.slotAddAxes = slotAxesChk.checked;
      context.requestRender();
    });

    const polyNInp = this.modeBarEl.querySelector('#shp-poly-n') as HTMLInputElement | null;
    polyNInp?.addEventListener('keydown', e => e.stopPropagation());
    polyNInp?.addEventListener('input', () => {
      const v = parseInt(polyNInp.value, 10);
      if (!isNaN(v) && v >= 3 && v <= 24) {
        this.polySides = v;
        this.updateHint(context);
        context.requestRender();
      }
    });
  }

  private updateHint(context: ToolContext) {
    if (this.mode === 'slot') {
      if (!this.slotP1) {
        context.setHint(
          tr(
            `FASOLKA (Slot): Krok 1 — Kliknij środek pierwszego łuku fasolki (szerokość W=${this.slotWidth} ${context.doc.unit})`,
            `SLOT: Step 1 — Click the center of the first slot arc (width W=${this.slotWidth} ${context.doc.unit})`
          )
        );
      } else if (!this.slotP2) {
        context.setHint(
          tr(
            'FASOLKA (Slot): Krok 2 — Kliknij środek drugiego łuku fasolki (lub wpisz rozstaw osi L w HUD [Enter])',
            'SLOT: Step 2 — Click the center of the second slot arc (or type center-to-center length L in HUD [Enter])'
          )
        );
      } else {
        context.setHint(
          tr(
            'FASOLKA (Slot): Krok 3 — Przesuń mysz, aby dobrać szerokość W=2R i kliknij (lub wpisz W w HUD [Enter])',
            'SLOT: Step 3 — Move mouse to adjust width W=2R and click (or type W in HUD [Enter])'
          )
        );
      }
    } else {
      if (!this.polyCenter) {
        context.setHint(
          tr(
            `WIELOKĄT FOREMNY (N=${this.polySides}): Krok 1 — Kliknij środek wielokąta`,
            `REGULAR POLYGON (N=${this.polySides}): Step 1 — Click polygon center point`
          )
        );
      } else {
        const rLabel =
          this.polyMode === 'circumscribed'
            ? tr('promień pod klucz S/2', 'across-flats radius S/2')
            : tr('promień opisany R', 'corner radius R');
        context.setHint(
          tr(
            `WIELOKĄT FOREMNY (N=${this.polySides}): Krok 2 — Wskaż ${rLabel} myszką lub wpisz w HUD [Enter]`,
            `REGULAR POLYGON (N=${this.polySides}): Step 2 — Click ${rLabel} or type in HUD [Enter]`
          )
        );
      }
    }
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    let pt = snapPt ? snapPt.point : worldPt;

    if (this.mode === 'slot') {
      if (!this.slotP1) {
        this.slotP1 = { ...pt };
        this.currentPt = { ...pt };
        this.updateHint(context);
        const screenPt = context.transform.worldToScreen(pt);
        context.hud.showSingleField(
          screenPt,
          tr('Rozstaw osi L:', 'Span L:'),
          20,
          len => {
            if (len > 0 && this.slotP1) {
              const ang = this.currentPt ? VectorMath.angleDeg(this.slotP1, this.currentPt) : 0;
              this.slotP2 = VectorMath.pointFromPolar(this.slotP1, len, ang);
              this.openSlotWidthHud(this.slotP2, context);
              context.requestRender();
            }
          },
          () => this.cancel(context)
        );
        context.requestRender();
        return;
      }

      if (!this.slotP2) {
        if (!snapPt && context.snapEngine.isOrthoActive()) {
          pt = context.snapEngine.applyOrtho(this.slotP1, pt);
        }
        if (VectorMath.distance(this.slotP1, pt) < 1e-4) return;
        this.slotP2 = { ...pt };
        this.openSlotWidthHud(pt, context);
        context.requestRender();
        return;
      }

      // Step 3: Commit slot with current width
      const r = this.computeSlotRadiusFromCursor(this.slotP1, this.slotP2, pt);
      this.slotWidth = VectorMath.round(r * 2, 2);
      this.commitSlot(this.slotP1, this.slotP2, r, context);
      return;
    }

    // Polygon mode
    if (!this.polyCenter) {
      this.polyCenter = { ...pt };
      this.currentPt = { ...pt };
      this.updateHint(context);
      const screenPt = context.transform.worldToScreen(pt);
      const fieldLabel =
        this.polyMode === 'circumscribed'
          ? tr('Promień S/2:', 'Radius S/2:')
          : tr('Promień R:', 'Radius R:');
      context.hud.showSingleField(
        screenPt,
        fieldLabel,
        this.polyRadius,
        val => {
          if (val > 0 && this.polyCenter) {
            this.polyRadius = val;
            const rotRad =
              this.currentPt && VectorMath.distance(this.polyCenter, this.currentPt) > 1e-3
                ? Math.atan2(this.currentPt.y - this.polyCenter.y, this.currentPt.x - this.polyCenter.x)
                : 0;
            this.commitPolygon(this.polyCenter, val, rotRad, context);
          }
        },
        () => this.cancel(context)
      );
      context.requestRender();
      return;
    }

    const r = VectorMath.distance(this.polyCenter, pt);
    if (r < 1e-4) return;
    const rotRad = Math.atan2(pt.y - this.polyCenter.y, pt.x - this.polyCenter.x);
    this.polyRadius = VectorMath.round(r, 2);
    this.commitPolygon(this.polyCenter, r, rotRad, context);
  }

  private openSlotWidthHud(worldPt: Point2D, context: ToolContext) {
    this.updateHint(context);
    const screenPt = context.transform.worldToScreen(worldPt);
    context.hud.showSingleField(
      screenPt,
      tr('Szerokość W=2R:', 'Width W=2R:'),
      this.slotWidth,
      wVal => {
        if (wVal > 0 && this.slotP1 && this.slotP2) {
          this.slotWidth = wVal;
          this.commitSlot(this.slotP1, this.slotP2, wVal / 2, context);
        }
      },
      () => this.cancel(context)
    );
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    let pt = snapPt ? snapPt.point : worldPt;
    if (this.mode === 'slot' && this.slotP1 && !this.slotP2 && !snapPt && context.snapEngine.isOrthoActive()) {
      pt = context.snapEngine.applyOrtho(this.slotP1, pt);
    }
    this.currentPt = { ...pt };

    const screenPt = context.transform.worldToScreen(pt);
    context.hud.updatePosition(screenPt);

    if (this.mode === 'slot') {
      if (this.slotP1 && !this.slotP2) {
        context.hud.updateLiveValues(VectorMath.round(VectorMath.distance(this.slotP1, pt), 2));
      } else if (this.slotP1 && this.slotP2) {
        const r = this.computeSlotRadiusFromCursor(this.slotP1, this.slotP2, pt);
        context.hud.updateLiveValues(VectorMath.round(r * 2, 2));
      }
    } else if (this.polyCenter) {
      context.hud.updateLiveValues(VectorMath.round(VectorMath.distance(this.polyCenter, pt), 2));
    }

    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    if (!context.hud.isActive()) {
      if (e.key === '1') {
        this.mode = 'slot';
        this.resetStepState(context);
        this.ensureModeBar(context);
        this.updateHint(context);
        context.requestRender();
        return true;
      }
      if (e.key === '2') {
        this.mode = 'polygon';
        this.resetStepState(context);
        this.ensureModeBar(context);
        this.updateHint(context);
        context.requestRender();
        return true;
      }
    }
    return false;
  }

  private computeSlotRadiusFromCursor(p1: Point2D, p2: Point2D, cursor: Point2D): number {
    const d = VectorMath.pointToSegmentDistance(cursor, p1, p2);
    return d > 1e-3 ? d : this.slotWidth / 2;
  }

  private buildSlotPoints(p1: Point2D, p2: Point2D, r: number): Point2D[] {
    const baseAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const steps = 16;
    const pts: Point2D[] = [];

    // Semicircle around p2 from baseAngle - PI/2 to baseAngle + PI/2
    for (let i = 0; i <= steps; i++) {
      const a = baseAngle - Math.PI / 2 + (Math.PI * i) / steps;
      pts.push({
        x: VectorMath.round(p2.x + Math.cos(a) * r, 3),
        y: VectorMath.round(p2.y + Math.sin(a) * r, 3),
      });
    }

    // Semicircle around p1 from baseAngle + PI/2 to baseAngle + 3*PI/2
    for (let i = 0; i <= steps; i++) {
      const a = baseAngle + Math.PI / 2 + (Math.PI * i) / steps;
      pts.push({
        x: VectorMath.round(p1.x + Math.cos(a) * r, 3),
        y: VectorMath.round(p1.y + Math.sin(a) * r, 3),
      });
    }

    return pts;
  }

  private buildPolygonPoints(center: Point2D, radiusInput: number, startAngleRad: number): Point2D[] {
    const n = Math.max(3, Math.min(24, this.polySides));
    // If circumscribed (across flats S/2), corner radius R = radiusInput / cos(PI / n)
    const cornerR =
      this.polyMode === 'circumscribed'
        ? radiusInput / Math.cos(Math.PI / n)
        : radiusInput;

    const pts: Point2D[] = [];
    for (let i = 0; i < n; i++) {
      const a = startAngleRad + (i * Math.PI * 2) / n;
      pts.push({
        x: VectorMath.round(center.x + Math.cos(a) * cornerR, 3),
        y: VectorMath.round(center.y + Math.sin(a) * cornerR, 3),
      });
    }
    return pts;
  }

  private commitSlot(p1: Point2D, p2: Point2D, r: number, context: ToolContext) {
    const pts = this.buildSlotPoints(p1, p2, r);
    const activeLayer = context.doc.getActiveLayer();
    const created: CadEntity[] = [];

    const groupId = this.slotAddAxes ? `grp_slot_${Date.now()}` : undefined;
    const groupName = this.slotAddAxes
      ? tr(`Fasolka ${VectorMath.round(r * 2)}×${VectorMath.round(VectorMath.distance(p1, p2) + r * 2)}`, `Slot ${VectorMath.round(r * 2)}×${VectorMath.round(VectorMath.distance(p1, p2) + r * 2)}`)
      : undefined;

    const slotPoly: PolylineEntity = {
      id: `slot_${Date.now()}`,
      type: 'polyline',
      layerId: activeLayer.id,
      groupId,
      groupName,
      selected: false,
      closed: true,
      points: pts,
    };
    created.push(slotPoly);

    if (this.slotAddAxes) {
      const axesLayerId = context.doc.layers.some(l => l.id === 'axes') ? 'axes' : activeLayer.id;
      const dir = VectorMath.normalize({ x: p2.x - p1.x, y: p2.y - p1.y });
      const norm = { x: -dir.y, y: dir.x };
      const ext = r * 1.25;

      // Longitudinal axis
      const axLong: LineEntity = {
        id: `slot_ax_l_${Date.now()}_1`,
        type: 'line',
        layerId: axesLayerId,
        lineType: 'dashdot',
        groupId,
        groupName,
        selected: false,
        x1: VectorMath.round(p1.x - dir.x * ext, 3),
        y1: VectorMath.round(p1.y - dir.y * ext, 3),
        x2: VectorMath.round(p2.x + dir.x * ext, 3),
        y2: VectorMath.round(p2.y + dir.y * ext, 3),
      };
      // Cross axes at p1 and p2
      const axC1: LineEntity = {
        id: `slot_ax_c1_${Date.now()}_2`,
        type: 'line',
        layerId: axesLayerId,
        lineType: 'dashdot',
        groupId,
        groupName,
        selected: false,
        x1: VectorMath.round(p1.x - norm.x * ext, 3),
        y1: VectorMath.round(p1.y - norm.y * ext, 3),
        x2: VectorMath.round(p1.x + norm.x * ext, 3),
        y2: VectorMath.round(p1.y + norm.y * ext, 3),
      };
      const axC2: LineEntity = {
        id: `slot_ax_c2_${Date.now()}_3`,
        type: 'line',
        layerId: axesLayerId,
        lineType: 'dashdot',
        groupId,
        groupName,
        selected: false,
        x1: VectorMath.round(p2.x - norm.x * ext, 3),
        y1: VectorMath.round(p2.y - norm.y * ext, 3),
        x2: VectorMath.round(p2.x + norm.x * ext, 3),
        y2: VectorMath.round(p2.y + norm.y * ext, 3),
      };
      created.push(axLong, axC1, axC2);
    }

    const cmd: Command = {
      description: tr('Rysuj otwór podłużny (Fasolkę)', 'Draw mounting slot'),
      execute: () => created.forEach(e => context.doc.addEntity(e)),
      undo: () => created.forEach(e => context.doc.removeEntity(e.id)),
    };
    context.history.execute(cmd);
    this.ensureModeBar(context);
    this.cancel(context);
  }

  private commitPolygon(center: Point2D, r: number, startAngleRad: number, context: ToolContext) {
    const pts = this.buildPolygonPoints(center, r, startAngleRad);
    const activeLayer = context.doc.getActiveLayer();

    const poly: PolylineEntity = {
      id: `polygon_${Date.now()}`,
      type: 'polyline',
      layerId: activeLayer.id,
      selected: false,
      closed: true,
      points: pts,
    };

    const cmd: Command = {
      description: tr(`Rysuj wielokąt foremny (${this.polySides} boków)`, `Draw regular polygon (${this.polySides} sides)`),
      execute: () => context.doc.addEntity(poly),
      undo: () => context.doc.removeEntity(poly.id),
    };
    context.history.execute(cmd);
    this.cancel(context);
  }

  getPreview(): RenderPreview | null {
    if (!this.currentPt) return null;

    if (this.mode === 'slot') {
      if (!this.slotP1) return null;
      if (!this.slotP2) {
        const pts = this.buildSlotPoints(this.slotP1, this.currentPt, this.slotWidth / 2);
        const ghostSlot: PolylineEntity = {
          id: '__preview_slot',
          type: 'polyline',
          layerId: '0',
          selected: false,
          closed: true,
          points: pts,
        };
        return {
          type: 'ghost',
          data: {
            entities: [ghostSlot],
            guideLine: { p1: this.slotP1, p2: this.currentPt },
          },
        };
      }

      const r = this.computeSlotRadiusFromCursor(this.slotP1, this.slotP2, this.currentPt);
      const pts = this.buildSlotPoints(this.slotP1, this.slotP2, r);
      const ghostSlot: PolylineEntity = {
        id: '__preview_slot',
        type: 'polyline',
        layerId: '0',
        selected: false,
        closed: true,
        points: pts,
      };
      return {
        type: 'ghost',
        data: {
          entities: [ghostSlot],
          guideLine: { p1: this.slotP1, p2: this.slotP2 },
          label: `W = ${VectorMath.round(r * 2, 2)}`,
        },
      };
    }

    // Polygon preview
    if (!this.polyCenter) return null;
    const r = Math.max(VectorMath.distance(this.polyCenter, this.currentPt), 0.1);
    const startAngleRad = Math.atan2(this.currentPt.y - this.polyCenter.y, this.currentPt.x - this.polyCenter.x);
    const pts = this.buildPolygonPoints(this.polyCenter, r, startAngleRad);

    const ghostPoly: PolylineEntity = {
      id: '__preview_poly',
      type: 'polyline',
      layerId: '0',
      selected: false,
      closed: true,
      points: pts,
    };
    const guideCircle: CircleEntity = {
      id: '__preview_poly_circle',
      type: 'circle',
      layerId: '0',
      lineType: 'dashdot',
      selected: false,
      cx: this.polyCenter.x,
      cy: this.polyCenter.y,
      radius: r,
    };

    return {
      type: 'ghost',
      data: {
        entities: [ghostPoly, guideCircle],
        guideLine: { p1: this.polyCenter, p2: this.currentPt },
      },
    };
  }
}

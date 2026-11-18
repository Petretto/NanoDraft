import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity, PolylineEntity, CircleEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { UNIT_SCALE_TO_MM } from '../math/transform';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { i18n, tr } from '../i18n/lang';

export type MeasureMode = 'distance' | 'entity-area' | 'poly-area';

export class MeasureTool extends BaseTool {
  readonly id = 'measure';
  readonly name = 'Zmierz';
  readonly shortcut = 'Q';

  private mode: MeasureMode = 'distance';
  private p1: Point2D | null = null;
  private polyPts: Point2D[] = [];
  private measuredEntity: PolylineEntity | CircleEntity | null = null;
  private currentPt: Point2D | null = null;
  private lastResultText: string = '';

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
    this.resetStepState();
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.resetStepState();
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.hud.hide();
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.resetStepState();
    this.lastResultText = '';
    this.ensureModeBar(context);
    this.updateHint(context);
    context.requestRender();
  }

  getBasePoint(): Point2D | null {
    if (this.mode === 'distance') return this.p1;
    if (this.mode === 'poly-area' && this.polyPts.length > 0) {
      return this.polyPts[this.polyPts.length - 1];
    }
    return null;
  }

  private resetStepState() {
    this.p1 = null;
    this.polyPts = [];
    this.measuredEntity = null;
    this.currentPt = null;
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
    this.modeBarEl.innerHTML = `
      <span class="dim-bar-title">📏 ${tr('Pomiar:', 'Measure:')}</span>
      <button class="dim-mode-btn ${this.mode === 'distance' ? 'active' : ''}" data-mode="distance" title="${tr('Zmierz odległość, ΔX, ΔY i kąt między 2 punktami [1]', 'Measure distance, ΔX, ΔY and angle [1]')}">
        📏 ${tr('Odległość', 'Distance')}
      </button>
      <button class="dim-mode-btn ${this.mode === 'entity-area' ? 'active' : ''}" data-mode="entity-area" title="${tr('Kliknij zamkniętą figurę (prostokąt, wielokąt, okrąg), aby odczytać Pole i Obwód [2]', 'Click a closed shape to read Area & Perimeter [2]')}">
        📐 ${tr('Pole figury', 'Object Area')}
      </button>
      <button class="dim-mode-btn ${this.mode === 'poly-area' ? 'active' : ''}" data-mode="poly-area" title="${tr('Obklikaj narożniki strefy/pomieszczenia, aby zmierzyć Pole powierzchni i Obwód [3]', 'Click polygon vertices to measure Area & Perimeter [3]')}">
        ⬟ ${tr('Pole wielokąta', 'Polygon Area')}
      </button>
      ${
        this.lastResultText
          ? `<span id="measure-result-badge" style="margin-left:6px; padding:2px 8px; border-radius:4px; background:rgba(0,229,255,0.14); border:1px solid var(--accent-color); color:var(--accent-color); font-family:var(--font-mono); font-size:11px; font-weight:600;">${this.lastResultText}</span>`
          : ''
      }
    `;

    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = (btn as HTMLElement).getAttribute('data-mode') as MeasureMode;
        if (m && m !== this.mode) {
          this.mode = m;
          this.resetStepState();
          this.lastResultText = '';
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });
  }

  private updateResultBadge(text: string) {
    this.lastResultText = text;
    if (!this.modeBarEl) return;
    let badge = this.modeBarEl.querySelector('#measure-result-badge') as HTMLSpanElement | null;
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'measure-result-badge';
      badge.style.cssText =
        'margin-left:6px; padding:2px 8px; border-radius:4px; background:rgba(0,229,255,0.14); border:1px solid var(--accent-color); color:var(--accent-color); font-family:var(--font-mono); font-size:11px; font-weight:600;';
      this.modeBarEl.appendChild(badge);
    }
    badge.textContent = text;
  }

  private updateHint(context: ToolContext) {
    if (this.mode === 'distance') {
      context.setHint(
        this.p1
          ? tr('ZMIERZ ODLEGŁOŚĆ: Wskaż drugi punkt pomiarowy', 'MEASURE DISTANCE: Click second point')
          : tr('ZMIERZ ODLEGŁOŚĆ: Wskaż pierwszy punkt pomiarowy (OSNAP aktywny)', 'MEASURE DISTANCE: Click first point (OSNAP active)')
      );
    } else if (this.mode === 'entity-area') {
      context.setHint(
        tr(
          'POLE FIGURY: Kliknij wewnątrz lub na krawędź zamkniętego prostokąta, wielokąta, fasolki lub okręgu',
          'OBJECT AREA: Click inside or on the edge of a closed rectangle, polygon, slot or circle'
        )
      );
    } else {
      context.setHint(
        this.polyPts.length === 0
          ? tr('POLE WIELOKĄTA: Klikaj kolejne narożniki strefy/pomieszczenia (Enter kończy pomiar)', 'POLYGON AREA: Click consecutive corners of the zone/room (Enter finishes)')
          : tr(`POLE WIELOKĄTA (${this.polyPts.length} pkt): Kliknij kolejny narożnik lub naciśnij [Enter], aby zakończyć`, `POLYGON AREA (${this.polyPts.length} pts): Click next corner or press [Enter] to finish`)
      );
    }
  }

  private formatAreaAndPerimeter(areaUnits2: number, perimUnits: number, unit: string): string {
    const u = unit;
    const areaRound = VectorMath.round(areaUnits2, 2);
    const perimRound = VectorMath.round(perimUnits, 2);
    const mmPerUnit = UNIT_SCALE_TO_MM[unit as keyof typeof UNIT_SCALE_TO_MM] || 1;
    const areaM2 = areaUnits2 * (mmPerUnit / 1000) * (mmPerUnit / 1000);

    if (u === 'm') {
      return `${tr('Pole', 'Area')} = ${areaRound} m² | ${tr('Obwód', 'Perim')} = ${perimRound} m`;
    }
    const m2Str = areaM2 >= 0.0001 ? ` (${VectorMath.round(areaM2, 4)} m²)` : '';
    return `${tr('Pole', 'Area')} = ${areaRound} ${u}²${m2Str} | ${tr('Obwód', 'Perim')} = ${perimRound} ${u}`;
  }

  private computePolygonAreaAndPerimeter(pts: Point2D[]): { area: number; perimeter: number } {
    if (pts.length < 3) {
      let p = 0;
      for (let i = 0; i < pts.length - 1; i++) p += VectorMath.distance(pts[i], pts[i + 1]);
      return { area: 0, perimeter: p };
    }
    let sum = 0;
    let perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      sum += a.x * b.y - b.x * a.y;
      perim += VectorMath.distance(a, b);
    }
    return { area: Math.abs(sum) / 2, perimeter: perim };
  }

  private findClosedEntityAt(pt: Point2D, context: ToolContext): PolylineEntity | CircleEntity | null {
    const tol = 9 / context.transform.zoom;

    // 1. Smallest closed entity containing pt
    let best: PolylineEntity | CircleEntity | null = null;
    let bestArea = Infinity;
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && !layer.visible) continue;
      if (ent.layerId === 'title_block') continue;

      if (ent.type === 'circle') {
        if (VectorMath.distance(pt, { x: ent.cx, y: ent.cy }) <= ent.radius) {
          const area = Math.PI * ent.radius * ent.radius;
          if (area < bestArea) { bestArea = area; best = ent; }
        }
      } else if (ent.type === 'polyline' && ent.closed && ent.points.length >= 3) {
        if (Geometry.pointInPolygon(pt, ent.points)) {
          const { area } = this.computePolygonAreaAndPerimeter(ent.points);
          if (area < bestArea) { bestArea = area; best = ent; }
        }
      }
    }
    if (best) return best;

    // 2. Fallback: edge click
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && !layer.visible) continue;
      if (ent.layerId === 'title_block') continue;

      if (ent.type === 'circle') {
        if (Math.abs(VectorMath.distance(pt, { x: ent.cx, y: ent.cy }) - ent.radius) <= tol) return ent;
      } else if (ent.type === 'polyline' && ent.closed && ent.points.length >= 3) {
        for (let s = 0; s < ent.points.length; s++) {
          if (VectorMath.pointToSegmentDistance(pt, ent.points[s], ent.points[(s + 1) % ent.points.length]) <= tol) {
            return ent;
          }
        }
      }
    }
    return null;
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;
    const u = context.doc.unit;

    if (this.mode === 'distance') {
      if (!this.p1) {
        this.p1 = { ...pt };
        this.currentPt = { ...pt };
        this.updateHint(context);
      } else {
        const d = VectorMath.round(VectorMath.distance(this.p1, pt), 2);
        const dx = VectorMath.round(pt.x - this.p1.x, 2);
        const dy = VectorMath.round(pt.y - this.p1.y, 2);
        const ang = VectorMath.round(VectorMath.angleDeg(this.p1, pt), 1);
        const txt = `L = ${d} ${u} | ΔX = ${dx} | ΔY = ${dy} | ∠ = ${ang}°`;
        this.updateResultBadge(txt);
        context.setHint(`${tr('POMIAR', 'RESULT')}: ${txt}`);
        this.p1 = null;
        this.currentPt = null;
      }
      context.requestRender();
      return;
    }

    if (this.mode === 'entity-area') {
      const target = this.findClosedEntityAt(worldPt, context);
      if (!target) {
        context.setHint(tr('POLE FIGURY: Kliknij wewnątrz zamkniętego prostokąta, wielokąta lub okręgu!', 'OBJECT AREA: Click inside a closed rectangle, polygon or circle!'));
        return;
      }
      this.measuredEntity = target;
      let area = 0;
      let perim = 0;
      if (target.type === 'circle') {
        area = Math.PI * target.radius * target.radius;
        perim = 2 * Math.PI * target.radius;
      } else {
        const res = this.computePolygonAreaAndPerimeter(target.points);
        area = res.area;
        perim = res.perimeter;
      }
      const txt = this.formatAreaAndPerimeter(area, perim, u);
      this.updateResultBadge(txt);
      context.setHint(`${tr('POLE FIGURY', 'OBJECT AREA')}: ${txt}`);
      context.requestRender();
      return;
    }

    // Polygon Area mode
    if (this.polyPts.length >= 3 && VectorMath.distance(this.polyPts[0], pt) <= context.transform.screenDistToWorld(10)) {
      // Closing click near start point -> finish measurement
      const { area, perimeter } = this.computePolygonAreaAndPerimeter(this.polyPts);
      const txt = this.formatAreaAndPerimeter(area, perimeter, u);
      this.updateResultBadge(txt);
      context.setHint(`${tr('POLE WIELOKĄTA', 'POLYGON AREA')}: ${txt}`);
      this.polyPts = [];
      context.requestRender();
      return;
    }

    this.polyPts.push({ ...pt });
    if (this.polyPts.length >= 3) {
      const { area, perimeter } = this.computePolygonAreaAndPerimeter(this.polyPts);
      const txt = this.formatAreaAndPerimeter(area, perimeter, u);
      this.updateResultBadge(txt);
    }
    this.updateHint(context);
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    this.currentPt = { ...pt };
    const u = context.doc.unit;

    if (this.mode === 'distance' && this.p1) {
      const d = VectorMath.round(VectorMath.distance(this.p1, pt), 2);
      const dx = VectorMath.round(pt.x - this.p1.x, 2);
      const dy = VectorMath.round(pt.y - this.p1.y, 2);
      const ang = VectorMath.round(VectorMath.angleDeg(this.p1, pt), 1);
      const txt = `L = ${d} ${u} | ΔX = ${dx} | ΔY = ${dy} | ∠ = ${ang}°`;
      this.updateResultBadge(txt);
      context.setHint(`${tr('POMIAR NA ŻYWO', 'LIVE MEASURE')}: ${txt}`);
      context.requestRender();
    } else if (this.mode === 'poly-area' && this.polyPts.length >= 2) {
      const previewPts = [...this.polyPts, pt];
      const { area, perimeter } = this.computePolygonAreaAndPerimeter(previewPts);
      this.updateResultBadge(this.formatAreaAndPerimeter(area, perimeter, u));
      context.requestRender();
    } else if (this.mode === 'poly-area' && this.polyPts.length === 1) {
      context.requestRender();
    }
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    if (e.key === '1') {
      this.mode = 'distance';
      this.resetStepState();
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    if (e.key === '2') {
      this.mode = 'entity-area';
      this.resetStepState();
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    if (e.key === '3') {
      this.mode = 'poly-area';
      this.resetStepState();
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    if (e.key === 'Enter' && this.mode === 'poly-area' && this.polyPts.length >= 3) {
      const { area, perimeter } = this.computePolygonAreaAndPerimeter(this.polyPts);
      const txt = this.formatAreaAndPerimeter(area, perimeter, context.doc.unit);
      this.updateResultBadge(txt);
      context.setHint(`${tr('POLE WIELOKĄTA', 'POLYGON AREA')}: ${txt}`);
      this.polyPts = [];
      context.requestRender();
      return true;
    }
    return false;
  }

  getPreview(): RenderPreview | null {
    if (this.mode === 'distance' && this.p1 && this.currentPt) {
      return {
        type: 'line',
        data: { p1: this.p1, p2: this.currentPt },
      };
    }

    if (this.mode === 'entity-area' && this.measuredEntity) {
      const ghost = Geometry.cloneEntity(this.measuredEntity);
      ghost.color = '#00e5ff';
      return {
        type: 'ghost',
        data: {
          entities: [ghost as CadEntity],
          label: this.lastResultText,
        },
      };
    }

    if (this.mode === 'poly-area' && this.polyPts.length > 0 && this.currentPt) {
      const pts = [...this.polyPts, this.currentPt];
      const ghostPoly: PolylineEntity = {
        id: '__preview_area_poly',
        type: 'polyline',
        layerId: '0',
        color: '#00e5ff',
        selected: false,
        closed: pts.length >= 3,
        points: pts,
      };
      return {
        type: 'ghost',
        data: {
          entities: [ghostPoly],
          label: this.lastResultText,
        },
      };
    }

    return null;
  }
}

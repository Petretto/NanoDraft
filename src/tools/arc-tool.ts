import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, PolylineEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type ArcMode = '3point' | 'center';

export class ArcTool extends BaseTool {
  readonly id = 'arc';
  readonly name = 'Łuk';
  readonly shortcut = 'A';

  private mode: ArcMode = '3point';
  private p1: Point2D | null = null;
  private p2: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private clockwise: boolean = false;
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
    this.p1 = null;
    this.p2 = null;
    this.currentPt = null;
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.p1 = null;
    this.p2 = null;
    this.currentPt = null;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.p1 = null;
    this.p2 = null;
    this.currentPt = null;
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
    this.modeBarEl.innerHTML = `
      <span class="dim-bar-title">⌒ ${tr('Tryb łuku:', 'Arc Mode:')}</span>
      <button class="dim-mode-btn ${this.mode === '3point' ? 'active' : ''}" data-mode="3point" title="${tr('Łuk przez 3 punkty: Początek -> Punkt na łuku -> Koniec [1]', '3-Point Arc: Start -> Point on Arc -> End [1]')}">
        ⌒ ${tr('3 Punkty (3-Point)', '3-Point')}
      </button>
      <button class="dim-mode-btn ${this.mode === 'center' ? 'active' : ''}" data-mode="center" title="${tr('Łuk ze środka: Środek -> Początek -> Koniec [2]', 'Center Arc: Center -> Start -> End [2]')}">
        🎯 ${tr('Środek-Początek-Koniec', 'Center-Start-End')}
      </button>
    `;

    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = (btn as HTMLElement).getAttribute('data-mode') as ArcMode;
        if (m) {
          this.mode = m;
          this.p1 = null;
          this.p2 = null;
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });
  }

  private updateHint(context: ToolContext) {
    if (this.mode === '3point') {
      if (!this.p1) {
        context.setHint(tr('ŁUK (3 Punkty): Wskaż 1. punkt (początek łuku)', 'ARC (3-Point): Click 1st point (arc start)'));
      } else if (!this.p2) {
        context.setHint(tr('ŁUK (3 Punkty): Wskaż 2. punkt (przez który przechodzi łuk)', 'ARC (3-Point): Click 2nd point (on arc)'));
      } else {
        context.setHint(tr('ŁUK (3 Punkty): Wskaż 3. punkt (koniec łuku)', 'ARC (3-Point): Click 3rd point (arc end)'));
      }
    } else {
      if (!this.p1) {
        context.setHint(tr('ŁUK (Ze środka): Wskaż środek łuku', 'ARC (Center): Click arc center point'));
      } else if (!this.p2) {
        context.setHint(tr('ŁUK (Ze środka): Wskaż punkt początkowy łuku (promień)', 'ARC (Center): Click arc start point (radius)'));
      } else {
        context.setHint(tr('ŁUK (Ze środka): Wskaż kąt końcowy łuku (przytrzymaj [Shift], aby odwrócić kierunek)', 'ARC (Center): Click end angle (hold [Shift] to reverse direction)'));
      }
    }
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;
    this.clockwise = e.shiftKey;

    if (!this.p1) {
      this.p1 = { ...pt };
      this.currentPt = { ...pt };
      this.updateHint(context);
      context.requestRender();
      return;
    }

    if (!this.p2) {
      if (VectorMath.distance(this.p1, pt) < 1e-4) return;
      this.p2 = { ...pt };
      this.currentPt = { ...pt };
      this.updateHint(context);
      context.requestRender();
      return;
    }

    const arcPts = this.computeArcPoints(this.p1, this.p2, pt, this.clockwise);
    if (!arcPts || arcPts.length < 2) {
      this.cancel(context);
      return;
    }

    const activeLayer = context.doc.getActiveLayer();
    const poly: PolylineEntity = {
      id: `arc_${Date.now()}`,
      type: 'polyline',
      layerId: activeLayer.id,
      selected: false,
      closed: false,
      points: arcPts,
    };

    const cmd: Command = {
      description: tr('Rysuj łuk', 'Draw arc'),
      execute: () => context.doc.addEntity(poly),
      undo: () => context.doc.removeEntity(poly.id),
    };
    context.history.execute(cmd);

    this.p1 = null;
    this.p2 = null;
    this.currentPt = null;
    this.updateHint(context);
    context.requestRender();
  }

  onMouseMove(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    this.currentPt = snapPt ? { ...snapPt.point } : { ...worldPt };
    this.clockwise = e.shiftKey;
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    if (e.key === '1') {
      this.mode = '3point';
      this.p1 = null;
      this.p2 = null;
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    if (e.key === '2') {
      this.mode = 'center';
      this.p1 = null;
      this.p2 = null;
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    return false;
  }

  private computeArcPoints(p1: Point2D, p2: Point2D, p3: Point2D, cw: boolean): Point2D[] | null {
    if (this.mode === 'center') {
      // p1 = center, p2 = start point, p3 = direction of end angle
      const r = VectorMath.distance(p1, p2);
      if (r < 1e-5) return null;
      const aStart = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const aEnd = Math.atan2(p3.y - p1.y, p3.x - p1.x);
      let sweep = aEnd - aStart;
      if (!cw) {
        while (sweep <= 0) sweep += Math.PI * 2;
      } else {
        while (sweep >= 0) sweep -= Math.PI * 2;
      }
      const steps = Math.max(12, Math.round((Math.abs(sweep) / (Math.PI * 2)) * 48));
      const pts: Point2D[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = aStart + (sweep * i) / steps;
        pts.push({
          x: p1.x + Math.cos(a) * r,
          y: p1.y + Math.sin(a) * r,
        });
      }
      return pts;
    }

    // 3-Point Arc through p1 -> p2 -> p3
    const ax = p1.x, ay = p1.y;
    const bx = p2.x, by = p2.y;
    const cx = p3.x, cy = p3.y;

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-7) {
      // Collinear fallback -> straight 2-segment polyline
      return [{ ...p1 }, { ...p2 }, { ...p3 }];
    }

    const ux =
      ((ax * ax + ay * ay) * (by - cy) +
        (bx * bx + by * by) * (cy - ay) +
        (cx * cx + cy * cy) * (ay - by)) /
      d;
    const uy =
      ((ax * ax + ay * ay) * (cx - bx) +
        (bx * bx + by * by) * (ax - cx) +
        (cx * cx + cy * cy) * (bx - ax)) /
      d;

    const center = { x: ux, y: uy };
    const r = VectorMath.distance(center, p1);

    const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
    const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
    const a3 = Math.atan2(p3.y - center.y, p3.x - center.x);

    // Normalize angles relative to a1 in [0, 2*PI)
    const normCCW = (ang: number) => {
      let diff = ang - a1;
      while (diff < 0) diff += Math.PI * 2;
      while (diff >= Math.PI * 2) diff -= Math.PI * 2;
      return diff;
    };

    const d2 = normCCW(a2);
    const d3 = normCCW(a3);

    // If d2 < d3, going CCW from a1 to a3 passes through a2; otherwise go CW (d3 - 2*PI)
    const sweep = d2 <= d3 ? d3 : d3 - Math.PI * 2;
    const steps = Math.max(12, Math.round((Math.abs(sweep) / (Math.PI * 2)) * 48));
    const pts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a1 + (sweep * i) / steps;
      pts.push({
        x: center.x + Math.cos(a) * r,
        y: center.y + Math.sin(a) * r,
      });
    }
    return pts;
  }

  getPreview(): RenderPreview | null {
    if (!this.p1 || !this.currentPt) return null;

    if (!this.p2) {
      return {
        type: 'line',
        data: { p1: this.p1, p2: this.currentPt },
      };
    }

    const pts = this.computeArcPoints(this.p1, this.p2, this.currentPt, this.clockwise);
    if (!pts || pts.length < 2) return null;

    const ghostArc: PolylineEntity = {
      id: '__preview_arc',
      type: 'polyline',
      layerId: '0',
      selected: false,
      closed: false,
      points: pts,
    };

    return {
      type: 'ghost',
      data: {
        entities: [ghostArc],
        guideLine: this.mode === 'center' ? { p1: this.p1, p2: this.currentPt } : undefined,
      },
    };
  }
}


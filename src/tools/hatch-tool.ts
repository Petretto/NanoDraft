import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity, LineEntity, PolylineEntity, CircleEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry, Segment, CircleGeom } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type HatchPattern = 'diagonal' | 'cross' | 'orthogonal';

export class HatchTool extends BaseTool {
  readonly id = 'hatch';
  readonly name = 'Kreskowanie';
  readonly shortcut = 'H';

  private pattern: HatchPattern = 'diagonal';
  private spacing: number = 6;
  private angleDeg: number = 45;
  private hoverTarget: PolylineEntity | CircleEntity | null = null;
  private cursorWorldPt: Point2D | null = null;
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
    this.hoverTarget = null;
    this.cursorWorldPt = null;
    if (context.doc.unit === 'm' && this.spacing > 2) this.spacing = 0.25;
    if (context.doc.unit === 'mm' && this.spacing < 1) this.spacing = 6;
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.hoverTarget = null;
    this.cursorWorldPt = null;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.hoverTarget = null;
    this.cursorWorldPt = null;
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
      <span class="dim-bar-title">▧ ${tr('Kreskowanie (Hatch):', 'Hatch:')}</span>
      <button class="dim-mode-btn ${this.pattern === 'diagonal' ? 'active' : ''}" data-pat="diagonal" title="${tr('Linie równoległe pod kątem (ANSI31 - Przekrój)', 'Parallel lines at angle (ANSI31 - Section)')}">
        ╱ ${tr('Skośne (Przekrój)', 'Diagonal')}
      </button>
      <button class="dim-mode-btn ${this.pattern === 'cross' ? 'active' : ''}" data-pat="cross" title="${tr('Kratka krzyżowa (ANSI37)', 'Cross-hatch grid (ANSI37)')}">
        ╳ ${tr('Kratka (Krzyżowe)', 'Cross-hatch')}
      </button>
      <button class="dim-mode-btn ${this.pattern === 'orthogonal' ? 'active' : ''}" data-pat="orthogonal" title="${tr('Pasy poziome/pionowe', 'Horizontal/Vertical stripes')}">
        ═ ${tr('Pasy 0°', 'Stripes 0°')}
      </button>

      <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${tr('Odstęp', 'Step')} [${context.doc.unit}]:</span>
      <input id="hatch-spacing" type="number" min="0.05" step="0.5" value="${this.spacing}" class="prop-input" style="width:58px; height:24px; padding:2px 4px;" />

      <span style="font-size:11px; color:var(--text-muted);">${tr('Kąt [°]:', 'Angle [°]:')}</span>
      <input id="hatch-angle" type="number" step="15" value="${this.angleDeg}" class="prop-input" style="width:54px; height:24px; padding:2px 4px;" />
    `;

    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pat = (btn as HTMLElement).getAttribute('data-pat') as HatchPattern;
        if (pat) {
          this.pattern = pat;
          if (pat === 'orthogonal') this.angleDeg = 0;
          else if (this.angleDeg === 0) this.angleDeg = 45;
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });

    this.modeBarEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', e => e.stopPropagation());
      inp.addEventListener('input', () => {
        const sp = parseFloat((this.modeBarEl!.querySelector('#hatch-spacing') as HTMLInputElement).value);
        const ang = parseFloat((this.modeBarEl!.querySelector('#hatch-angle') as HTMLInputElement).value);
        if (!isNaN(sp) && sp > 0.02) this.spacing = sp;
        if (!isNaN(ang)) this.angleDeg = ang;
        context.requestRender();
      });
    });
  }

  private updateHint(context: ToolContext) {
    context.setHint(
      tr(
        `KRESKOWANIE (Hatch): Kliknij wewnątrz obszaru, który chcesz zakreskować — linie zatrzymają się na wszystkich granicach (odstęp: ${this.spacing} ${context.doc.unit})`,
        `HATCH: Click inside the region to hatch — lines automatically stop at all internal boundaries (step: ${this.spacing} ${context.doc.unit})`
      )
    );
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    this.cursorWorldPt = { ...worldPt };
    this.hoverTarget = this.findClosedTargetAt(worldPt, context);
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    this.cursorWorldPt = { ...worldPt };
    const target = this.findClosedTargetAt(worldPt, context);
    if (!target) {
      context.setHint(
        tr(
          'KRESKOWANIE: Kliknij wewnątrz lub na krawędź ZAMKNIĘTEGO prostokąta, polilinii lub okręgu!',
          'HATCH: Click inside or on the edge of a CLOSED rectangle, polyline or circle!'
        )
      );
      return;
    }

    const hatchLines = this.generateHatchLinesForEntity(target, worldPt, context);
    if (hatchLines.length === 0) return;

    // Ensure 'hatch' layer exists or use active layer
    let hatchLayer = context.doc.layers.find(l => l.id === 'hatch');
    const layerId = hatchLayer ? hatchLayer.id : context.doc.activeLayerId;

    const groupId = `grp_hatch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const groupName = tr(`Kreskowanie (${hatchLines.length} linii)`, `Hatch (${hatchLines.length} lines)`);
    for (const l of hatchLines) {
      l.layerId = layerId;
      l.groupId = groupId;
      l.groupName = groupName;
    }

    const cmd: Command = {
      description: groupName,
      execute: () => {
        for (const l of hatchLines) context.doc.addEntity(l);
      },
      undo: () => {
        for (const l of hatchLines) context.doc.removeEntity(l.id);
      },
    };
    context.history.execute(cmd);
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  private findClosedTargetAt(pt: Point2D, context: ToolContext): PolylineEntity | CircleEntity | null {
    const tol = 9 / context.transform.zoom;

    // 1. First check smallest-area closed entity strictly containing `pt`
    let bestEnt: PolylineEntity | CircleEntity | null = null;
    let bestArea = Infinity;

    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;
      if (ent.layerId === 'title_block' || ent.layerId === 'axes' || ent.layerId === 'dimensions') continue;

      if (ent.type === 'circle') {
        const d = VectorMath.distance(pt, { x: ent.cx, y: ent.cy });
        if (d <= ent.radius) {
          const area = Math.PI * ent.radius * ent.radius;
          if (area < bestArea) {
            bestArea = area;
            bestEnt = ent;
          }
        }
      } else if (ent.type === 'polyline' && ent.closed && ent.points.length >= 3) {
        if (Geometry.pointInPolygon(pt, ent.points)) {
          const b = Geometry.entityBounds(ent);
          const area = b ? (b.maxX - b.minX) * (b.maxY - b.minY) : Infinity;
          if (area < bestArea) {
            bestArea = area;
            bestEnt = ent;
          }
        }
      }
    }

    if (bestEnt) return bestEnt;

    // 2. Fallback: check if cursor is directly on the boundary edge of a closed entity
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;
      if (ent.layerId === 'title_block' || ent.layerId === 'axes' || ent.layerId === 'dimensions') continue;

      if (ent.type === 'circle') {
        const d = VectorMath.distance(pt, { x: ent.cx, y: ent.cy });
        if (Math.abs(d - ent.radius) <= tol) return ent;
      } else if (ent.type === 'polyline' && ent.closed && ent.points.length >= 3) {
        const pts = ent.points;
        for (let s = 0; s < pts.length; s++) {
          if (VectorMath.pointToSegmentDistance(pt, pts[s], pts[(s + 1) % pts.length]) <= tol) {
            return ent;
          }
        }
      }
    }

    return null;
  }

  private generateHatchLinesForEntity(
    target: PolylineEntity | CircleEntity,
    seedPt: Point2D,
    context: ToolContext
  ): LineEntity[] {
    const angles: number[] =
      this.pattern === 'cross'
        ? [this.angleDeg, this.angleDeg + 90]
        : this.pattern === 'orthogonal'
        ? [0]
        : [this.angleDeg];

    const lines: LineEntity[] = [];
    const layerId = context.doc.activeLayerId;
    let seq = 1;

    for (const angDeg of angles) {
      const segs = this.computeClippedParallelSegments(target, seedPt, angDeg, this.spacing, context);
      for (const s of segs) {
        lines.push({
          id: `hatch_${Date.now()}_${seq++}`,
          type: 'line',
          layerId,
          lineWidth: 0.6,
          lineType: 'continuous',
          selected: false,
          x1: VectorMath.round(s.a.x, 3),
          y1: VectorMath.round(s.a.y, 3),
          x2: VectorMath.round(s.b.x, 3),
          y2: VectorMath.round(s.b.y, 3),
        });
      }
    }
    return lines;
  }

  /**
   * Clips parallel hatch lines against:
   * 1. The outer boundary of `target`,
   * 2. Any inner closed holes (circles/polygons) inside `target`,
   * 3. Any internal dividing lines (`LineEntity` / `PolylineEntity` segments) inside `target`,
   * so hatch lines NEVER cross over any geometry line and only fill the connected sub-region of `seedPt`!
   */
  private computeClippedParallelSegments(
    target: PolylineEntity | CircleEntity,
    seedPt: Point2D,
    angleDeg: number,
    spacing: number,
    context: ToolContext
  ): { a: Point2D; b: Point2D }[] {
    const b = Geometry.entityBounds(target);
    if (!b) return [];

    // Collect internal obstacles (dividing segments, inner closed polygons, inner circles)
    const internalSegments: Segment[] = [];
    const innerHoles: (PolylineEntity | CircleEntity)[] = [];

    for (const other of context.doc.entities) {
      if (other.id === target.id) continue;
      if (
        other.layerId === 'axes' ||
        other.layerId === 'dimensions' ||
        other.layerId === 'hatch' ||
        other.layerId === 'title_block' ||
        other.id.startsWith('hatch_') ||
        (other.groupId && other.groupId.startsWith('grp_hatch_'))
      ) {
        continue;
      }
      const layer = context.doc.layers.find(l => l.id === other.layerId);
      if (layer && !layer.visible) continue;
      if (other.lineType === 'dashdot') continue; // ignore centerlines

      const ob = Geometry.entityBounds(other);
      if (!ob) continue;
      if (ob.maxX < b.minX - 1e-3 || ob.minX > b.maxX + 1e-3 || ob.maxY < b.minY - 1e-3 || ob.minY > b.maxY + 1e-3) {
        continue;
      }

      if (other.type === 'line') {
        internalSegments.push({ a: { x: other.x1, y: other.y1 }, b: { x: other.x2, y: other.y2 } });
      } else if (other.type === 'polyline') {
        const pts = other.points;
        const count = other.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < count; i++) {
          internalSegments.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
        }
        if (other.closed && pts.length >= 3) {
          innerHoles.push(other);
        }
      } else if (other.type === 'circle') {
        innerHoles.push(other);
      }
    }

    const isInsideTarget = (pt: Point2D): boolean => {
      if (target.type === 'circle') {
        return VectorMath.distance(pt, { x: target.cx, y: target.cy }) <= target.radius - 1e-5;
      }
      return Geometry.pointInPolygon(pt, target.points);
    };

    const isInsideAnyHole = (pt: Point2D): boolean => {
      for (const h of innerHoles) {
        if (h.type === 'circle') {
          if (VectorMath.distance(pt, { x: h.cx, y: h.cy }) < h.radius - 1e-4) return true;
        } else if (Geometry.pointInPolygon(pt, h.points)) {
          return true;
        }
      }
      return false;
    };

    // Determine if `seedPt` is strictly inside `target` (and not inside an inner hole)
    const seedStrictlyInside = isInsideTarget(seedPt) && !isInsideAnyHole(seedPt);

    // Check if `pt` is in the same sub-cell of `target` as `seedPt` without crossing internalSegments
    const isSameSubRegionAsSeed = (pt: Point2D): boolean => {
      if (!seedStrictlyInside || internalSegments.length === 0) return true;

      const pathClear = (pA: Point2D, pB: Point2D): boolean => {
        if (!isInsideTarget(VectorMath.midpoint(pA, pB))) return false;
        for (const seg of internalSegments) {
          if (VectorMath.segmentIntersection(pA, pB, seg.a, seg.b)) return false;
        }
        return true;
      };

      // 1. Direct line from seedPt to pt
      if (pathClear(seedPt, pt)) return true;

      // 2. 1-bend L-paths via (seedPt.x, pt.y) or (pt.x, seedPt.y)
      const bend1 = { x: seedPt.x, y: pt.y };
      if (isInsideTarget(bend1) && pathClear(seedPt, bend1) && pathClear(bend1, pt)) return true;

      const bend2 = { x: pt.x, y: seedPt.y };
      if (isInsideTarget(bend2) && pathClear(seedPt, bend2) && pathClear(bend2, pt)) return true;

      return false;
    };

    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + spacing;

    const step = Math.max(spacing, diag / 140);
    const rad = (angleDeg * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    const norm = { x: -Math.sin(rad), y: Math.cos(rad) };

    const result: { a: Point2D; b: Point2D }[] = [];
    const numSteps = Math.floor(diag / step);

    for (let k = -numSteps; k <= numSteps; k++) {
      const d = k * step;
      const lineCenter = { x: cx + norm.x * d, y: cy + norm.y * d };
      const r1 = { x: lineCenter.x - dir.x * diag * 1.5, y: lineCenter.y - dir.y * diag * 1.5 };
      const r2 = { x: lineCenter.x + dir.x * diag * 1.5, y: lineCenter.y + dir.y * diag * 1.5 };

      // Collect all cut points along ray r1 -> r2 (from target boundary, internal segments, and inner circles)
      const cutProjections: number[] = [];
      const addCutPt = (pt: Point2D) => {
        const proj = (pt.x - r1.x) * dir.x + (pt.y - r1.y) * dir.y;
        cutProjections.push(proj);
      };

      // 1. Target boundary intersections
      if (target.type === 'circle') {
        const hits = Geometry.intersectSegmentCircle(
          { a: r1, b: r2 },
          { c: { x: target.cx, y: target.cy }, r: target.radius }
        );
        hits.forEach(addCutPt);
      } else {
        const pts = target.points;
        for (let i = 0; i < pts.length; i++) {
          const hit = VectorMath.segmentIntersection(r1, r2, pts[i], pts[(i + 1) % pts.length]);
          if (hit) addCutPt(hit);
        }
      }

      // 2. Internal segments intersections (so hatch lines stop at every internal line!)
      for (const seg of internalSegments) {
        const hit = VectorMath.segmentIntersection(r1, r2, seg.a, seg.b);
        if (hit) addCutPt(hit);
      }

      // 3. Inner circle holes intersections
      for (const h of innerHoles) {
        if (h.type === 'circle') {
          const cGeom: CircleGeom = { c: { x: h.cx, y: h.cy }, r: h.radius };
          const hits = Geometry.intersectSegmentCircle({ a: r1, b: r2 }, cGeom);
          hits.forEach(addCutPt);
        }
      }

      if (cutProjections.length < 2) continue;
      cutProjections.sort((u, v) => u - v);

      // Deduplicate close projections
      const uniqueProj: number[] = [cutProjections[0]];
      for (let i = 1; i < cutProjections.length; i++) {
        if (cutProjections[i] - uniqueProj[uniqueProj.length - 1] > 1e-4) {
          uniqueProj.push(cutProjections[i]);
        }
      }

      // Test every elementary interval [uniqueProj[i], uniqueProj[i+1]]
      for (let i = 0; i < uniqueProj.length - 1; i++) {
        const pA = { x: r1.x + dir.x * uniqueProj[i], y: r1.y + dir.y * uniqueProj[i] };
        const pB = { x: r1.x + dir.x * uniqueProj[i + 1], y: r1.y + dir.y * uniqueProj[i + 1] };
        if (VectorMath.distance(pA, pB) < 1e-3) continue;

        const mid = VectorMath.midpoint(pA, pB);
        if (!isInsideTarget(mid)) continue;
        if (isInsideAnyHole(mid)) continue;
        if (!isSameSubRegionAsSeed(mid)) continue;

        result.push({ a: pA, b: pB });
      }
    }

    return result;
  }

  getPreview(): RenderPreview | null {
    if (!this.hoverTarget || !this.lastContext || !this.cursorWorldPt) return null;
    const ghosts = this.generateHatchLinesForEntity(this.hoverTarget, this.cursorWorldPt, this.lastContext);
    if (ghosts.length === 0) return null;
    return {
      type: 'ghost',
      data: {
        entities: ghosts as CadEntity[],
        label: `▧ Hatch (${ghosts.length})`,
      },
    };
  }
}

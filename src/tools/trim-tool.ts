import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, LineEntity, PolylineEntity, CircleEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type TrimExtendMode = 'trim' | 'extend';

interface LineTrimCandidate {
  action: 'trim-line';
  entity: LineEntity;
  cutStart: Point2D;
  cutEnd: Point2D;
  tA: number;
  tB: number;
}

interface CircleTrimCandidate {
  action: 'trim-circle';
  entity: CircleEntity;
  cutArcPts: Point2D[];
  keepArcPts: Point2D[];
}

interface PolylineTrimCandidate {
  action: 'trim-polyline';
  entity: PolylineEntity;
  cutPathPts: Point2D[];
  keptChains: Point2D[][];
}

interface ExtendCandidate {
  action: 'extend';
  entity: LineEntity | PolylineEntity;
  extendStartEndpoint: boolean; // true -> extend p1, false -> extend p2
  fromPt: Point2D;
  targetPt: Point2D;
}

type ActiveCandidate =
  | LineTrimCandidate
  | CircleTrimCandidate
  | PolylineTrimCandidate
  | ExtendCandidate;

export class TrimTool extends BaseTool {
  readonly id = 'trim';
  readonly name = 'Przytnij / Wydłuż';
  readonly shortcut = 'X';

  private mode: TrimExtendMode = 'trim';
  private candidate: ActiveCandidate | null = null;
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
    this.candidate = null;
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.candidate = null;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.candidate = null;
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
      <span class="dim-bar-title">✂️ ${tr('Edycja odcinków i okręgów:', 'Trim / Extend:')}</span>
      <button class="dim-mode-btn ${this.mode === 'trim' ? 'active' : ''}" data-mode="trim" title="${tr('Przytnij fragment linii, okręgu lub polilinii między przecięciami', 'Trim line, circle or polyline portion between intersections')}">
        ✂️ ${tr('Przytnij (Trim)', 'Trim')}
      </button>
      <button class="dim-mode-btn ${this.mode === 'extend' ? 'active' : ''}" data-mode="extend" title="${tr('Wydłuż odcinek do najbliższej krawędzi przecięcia (lub przytrzymaj Shift)', 'Extend segment to nearest boundary edge (or hold Shift)')}">
        ↗️ ${tr('Wydłuż (Extend)', 'Extend')}
      </button>
    `;

    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.stopPropagation());
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = (btn as HTMLElement).getAttribute('data-mode') as TrimExtendMode;
        if (m) {
          this.mode = m;
          this.candidate = null;
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });
  }

  private updateHint(context: ToolContext) {
    if (this.mode === 'trim') {
      context.setHint(
        tr(
          'PRZYTNIJ (Trim): Najedź i kliknij na fragment linii, okręgu lub polilinii do wycięcia ([Shift] = Wydłuż)',
          'TRIM: Hover and click the line, circle or polyline portion to cut away ([Shift] = Extend)'
        )
      );
    } else {
      context.setHint(
        tr(
          'WYDŁUŻ (Extend): Najedź blisko końca odcinka, aby przedłużyć go do najbliższej krawędzi ([Shift] = Przytnij)',
          'EXTEND: Hover near a segment end to extend it to the nearest boundary edge ([Shift] = Trim)'
        )
      );
    }
  }

  private getEffectiveMode(e: MouseEvent): TrimExtendMode {
    if (e.shiftKey) {
      return this.mode === 'trim' ? 'extend' : 'trim';
    }
    return this.mode;
  }

  onMouseMove(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    const effMode = this.getEffectiveMode(e);
    if (effMode === 'trim') {
      this.candidate = this.findTrimCandidate(worldPt, context);
    } else {
      this.candidate = this.findExtendCandidate(worldPt, context);
    }
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    const effMode = this.getEffectiveMode(e);
    const cand =
      effMode === 'trim'
        ? this.findTrimCandidate(worldPt, context)
        : this.findExtendCandidate(worldPt, context);

    if (!cand) {
      context.setHint(
        effMode === 'trim'
          ? tr('PRZYTNIJ: Wskazany obiekt nie ma wystarczającej liczby przecięć (okrąg wymaga min. 2 punktów przecięcia)!', 'TRIM: Object does not have enough intersections (circle requires at least 2 intersections)!')
          : tr('WYDŁUŻ: Na przedłużeniu tego odcinka nie znaleziono żadnej krawędzi granicznej!', 'EXTEND: No boundary edge found along the extension of this segment!')
      );
      return;
    }

    if (cand.action === 'trim-line') {
      this.applyLineTrim(cand, context);
    } else if (cand.action === 'trim-circle') {
      this.applyCircleTrim(cand, context);
    } else if (cand.action === 'trim-polyline') {
      this.applyPolylineTrim(cand, context);
    } else {
      this.applyExtend(cand, context);
    }

    this.candidate = null;
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

  /**
   * Finds the line, circle, or polyline under the cursor and computes the trimmable interval
   * bounded by intersections with all other visible entities.
   */
  private findTrimCandidate(pt: Point2D, context: ToolContext): ActiveCandidate | null {
    const tol = 9 / context.transform.zoom;

    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;

      if (ent.type === 'line') {
        const p1 = { x: ent.x1, y: ent.y1 };
        const p2 = { x: ent.x2, y: ent.y2 };
        if (VectorMath.pointToSegmentDistance(pt, p1, p2) <= tol) {
          const interval = this.computeTrimIntervalOnSegment(p1, p2, pt, ent.id, -1, context);
          if (interval) {
            return {
              action: 'trim-line',
              entity: ent,
              cutStart: interval.cutStart,
              cutEnd: interval.cutEnd,
              tA: interval.tA,
              tB: interval.tB,
            };
          }
        }
      } else if (ent.type === 'circle') {
        const distToCenter = VectorMath.distance(pt, { x: ent.cx, y: ent.cy });
        if (Math.abs(distToCenter - ent.radius) <= tol) {
          const circleTrim = this.computeCircleTrimCandidate(ent, pt, context);
          if (circleTrim) return circleTrim;
        }
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        const segCount = ent.closed ? pts.length : pts.length - 1;
        let hitSeg = -1;
        for (let s = 0; s < segCount; s++) {
          const p1 = pts[s];
          const p2 = pts[(s + 1) % pts.length];
          if (VectorMath.pointToSegmentDistance(pt, p1, p2) <= tol) {
            hitSeg = s;
            break;
          }
        }
        if (hitSeg !== -1) {
          const polyTrim = this.computePolylineTrimCandidate(ent, pt, context);
          if (polyTrim) return polyTrim;
        }
      }
    }
    return null;
  }

  /**
   * Computes trim candidate for a CircleEntity intersected by >= 2 lines, polylines, or circles.
   */
  private computeCircleTrimCandidate(
    circle: CircleEntity,
    cursorPt: Point2D,
    context: ToolContext
  ): CircleTrimCandidate | null {
    const cGeom = { c: { x: circle.cx, y: circle.cy }, r: circle.radius };
    const interPts: Point2D[] = [];

    for (const other of context.doc.entities) {
      if (other.id === circle.id) continue;
      const layer = context.doc.layers.find(l => l.id === other.layerId);
      if (layer && !layer.visible) continue;

      const prims = Geometry.entityPrimitives(other);
      for (const seg of prims.segments) {
        interPts.push(...Geometry.intersectSegmentCircle(seg, cGeom));
      }
      for (const cir of prims.circles) {
        interPts.push(...Geometry.intersectCircles(cGeom, cir));
      }
    }

    if (interPts.length < 2) return null;

    const TWO_PI = Math.PI * 2;
    const normAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

    const rawAngles = interPts
      .map(p => normAngle(Math.atan2(p.y - circle.cy, p.x - circle.cx)))
      .sort((a, b) => a - b);

    // Deduplicate angles closer than ~0.001 rad
    const angles: number[] = [rawAngles[0]];
    for (let i = 1; i < rawAngles.length; i++) {
      if (rawAngles[i] - angles[angles.length - 1] > 1e-3) {
        angles.push(rawAngles[i]);
      }
    }
    if (angles.length > 1 && TWO_PI - angles[angles.length - 1] + angles[0] <= 1e-3) {
      angles.pop();
    }
    if (angles.length < 2) return null;

    const cursorAngle = normAngle(Math.atan2(cursorPt.y - circle.cy, cursorPt.x - circle.cx));

    // Find which CCW sector [angles[i], angles[(i+1)%k]] contains cursorAngle
    let sectorIdx = angles.length - 1;
    for (let i = 0; i < angles.length - 1; i++) {
      if (cursorAngle >= angles[i] && cursorAngle <= angles[i + 1]) {
        sectorIdx = i;
        break;
      }
    }

    const aStart = angles[sectorIdx];
    let aEnd = angles[(sectorIdx + 1) % angles.length];
    if (aEnd <= aStart) aEnd += TWO_PI;

    // Cut arc: from aStart CCW to aEnd
    const cutSweep = aEnd - aStart;
    const cutSteps = Math.max(12, Math.round((cutSweep / TWO_PI) * 64));
    const cutArcPts: Point2D[] = [];
    for (let i = 0; i <= cutSteps; i++) {
      const a = aStart + (cutSweep * i) / cutSteps;
      cutArcPts.push({
        x: circle.cx + Math.cos(a) * circle.radius,
        y: circle.cy + Math.sin(a) * circle.radius,
      });
    }

    // Kept arc: from aEnd CCW to aStart + TWO_PI
    const keepStart = aEnd;
    const keepEnd = aStart + TWO_PI;
    const keepSweep = keepEnd - keepStart;
    const keepSteps = Math.max(16, Math.round((keepSweep / TWO_PI) * 64));
    const keepArcPts: Point2D[] = [];
    for (let i = 0; i <= keepSteps; i++) {
      const a = keepStart + (keepSweep * i) / keepSteps;
      keepArcPts.push({
        x: circle.cx + Math.cos(a) * circle.radius,
        y: circle.cy + Math.sin(a) * circle.radius,
      });
    }

    return {
      action: 'trim-circle',
      entity: circle,
      cutArcPts,
      keepArcPts,
    };
  }

  /**
   * Computes trim candidate along an entire PolylineEntity (both open polylines/arcs and closed rectangles/polygons)
   * using arc-length parameterization so multi-segment curves and rectangles trim cleanly between intersections.
   */
  private computePolylineTrimCandidate(
    poly: PolylineEntity,
    cursorPt: Point2D,
    context: ToolContext
  ): PolylineTrimCandidate | null {
    const pts = poly.points;
    const segCount = poly.closed ? pts.length : pts.length - 1;
    if (segCount < 1) return null;

    const segLengths: number[] = [];
    const cumLengths: number[] = [0];
    let totalLen = 0;

    for (let s = 0; s < segCount; s++) {
      const p1 = pts[s];
      const p2 = pts[(s + 1) % pts.length];
      const len = VectorMath.distance(p1, p2);
      segLengths.push(len);
      totalLen += len;
      cumLengths.push(totalLen);
    }
    if (totalLen < 1e-8) return null;

    // Collect global arc-length parameters s in [0, totalLen] of all intersections
    const cutParams: number[] = [];

    for (let s = 0; s < segCount; s++) {
      const p1 = pts[s];
      const p2 = pts[(s + 1) % pts.length];
      const segLen = segLengths[s];
      if (segLen < 1e-9) continue;

      for (const other of context.doc.entities) {
        const layer = context.doc.layers.find(l => l.id === other.layerId);
        if (layer && !layer.visible) continue;

        if (other.id === poly.id) continue;

        const prims = Geometry.entityPrimitives(other);
        for (const oSeg of prims.segments) {
          const hit = VectorMath.segmentIntersection(p1, p2, oSeg.a, oSeg.b);
          if (hit) {
            const t = VectorMath.distance(p1, hit) / segLen;
            if (t >= -1e-5 && t <= 1 + 1e-5) {
              const sVal = cumLengths[s] + Math.max(0, Math.min(1, t)) * segLen;
              cutParams.push(sVal);
            }
          }
        }
        for (const oCir of prims.circles) {
          const hits = Geometry.intersectSegmentCircle({ a: p1, b: p2 }, oCir);
          for (const hit of hits) {
            const t = VectorMath.distance(p1, hit) / segLen;
            if (t >= -1e-5 && t <= 1 + 1e-5) {
              const sVal = cumLengths[s] + Math.max(0, Math.min(1, t)) * segLen;
              cutParams.push(sVal);
            }
          }
        }
      }
    }

    // Find cursor projection sCursor along the polyline
    let bestDist = Infinity;
    let sCursor = 0;
    for (let s = 0; s < segCount; s++) {
      const p1 = pts[s];
      const p2 = pts[(s + 1) % pts.length];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq > 1e-10 ? Math.max(0, Math.min(1, ((cursorPt.x - p1.x) * dx + (cursorPt.y - p1.y) * dy) / lenSq)) : 0;
      const proj = { x: p1.x + dx * t, y: p1.y + dy * t };
      const d = VectorMath.distance(cursorPt, proj);
      if (d < bestDist) {
        bestDist = d;
        sCursor = cumLengths[s] + t * segLengths[s];
      }
    }

    const extractSubPath = (sStart: number, sEnd: number): Point2D[] => {
      // Extracts polyline vertices from sStart to sEnd along [0, totalLen]
      const res: Point2D[] = [];
      const clampS = (v: number) => Math.max(0, Math.min(totalLen, v));
      const a = clampS(sStart);
      const b = clampS(sEnd);
      if (b - a <= 1e-6) return res;

      const pointAtS = (sVal: number): { pt: Point2D; segIdx: number } => {
        for (let i = 0; i < segCount; i++) {
          if (sVal <= cumLengths[i + 1] + 1e-7 || i === segCount - 1) {
            const localT = segLengths[i] > 1e-9 ? Math.max(0, Math.min(1, (sVal - cumLengths[i]) / segLengths[i])) : 0;
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            return {
              pt: { x: p1.x + (p2.x - p1.x) * localT, y: p1.y + (p2.y - p1.y) * localT },
              segIdx: i,
            };
          }
        }
        return { pt: { ...pts[pts.length - 1] }, segIdx: segCount - 1 };
      };

      const startInfo = pointAtS(a);
      const endInfo = pointAtS(b);
      res.push(startInfo.pt);
      for (let seg = startInfo.segIdx + 1; seg <= endInfo.segIdx; seg++) {
        const vPt = pts[seg % pts.length];
        if (VectorMath.distance(res[res.length - 1], vPt) > 1e-5) {
          res.push({ ...vPt });
        }
      }
      if (VectorMath.distance(res[res.length - 1], endInfo.pt) > 1e-5) {
        res.push(endInfo.pt);
      }
      return res;
    };

    if (!poly.closed) {
      // Open polyline (e.g. trimmed arc or multi-segment open line)
      const allS = [0, ...cutParams, totalLen].sort((a, b) => a - b);
      const uniqueS: number[] = [allS[0]];
      for (let i = 1; i < allS.length; i++) {
        if (allS[i] - uniqueS[uniqueS.length - 1] > 1e-3) {
          uniqueS.push(allS[i]);
        }
      }
      if (uniqueS.length <= 2) return null;

      for (let i = 0; i < uniqueS.length - 1; i++) {
        const sA = uniqueS[i];
        const sB = uniqueS[i + 1];
        if (sCursor >= sA - 1e-4 && sCursor <= sB + 1e-4) {
          const cutPathPts = extractSubPath(sA, sB);
          const keptChains: Point2D[][] = [];
          if (sA > 1e-3) {
            const c1 = extractSubPath(0, sA);
            if (c1.length >= 2) keptChains.push(c1);
          }
          if (totalLen - sB > 1e-3) {
            const c2 = extractSubPath(sB, totalLen);
            if (c2.length >= 2) keptChains.push(c2);
          }
          return {
            action: 'trim-polyline',
            entity: poly,
            cutPathPts,
            keptChains,
          };
        }
      }
      return null;
    }

    // Closed polyline (e.g. rectangle): needs at least 2 intersections around perimeter
    const sorted = cutParams.map(s => ((s % totalLen) + totalLen) % totalLen).sort((a, b) => a - b);
    const uniqueS: number[] = [];
    for (const s of sorted) {
      if (uniqueS.length === 0 || s - uniqueS[uniqueS.length - 1] > 1e-3) {
        uniqueS.push(s);
      }
    }
    if (uniqueS.length > 1 && totalLen - uniqueS[uniqueS.length - 1] + uniqueS[0] <= 1e-3) {
      uniqueS.pop();
    }
    if (uniqueS.length < 2) return null;

    let idx = uniqueS.length - 1;
    for (let i = 0; i < uniqueS.length - 1; i++) {
      if (sCursor >= uniqueS[i] && sCursor <= uniqueS[i + 1]) {
        idx = i;
        break;
      }
    }

    const sA = uniqueS[idx];
    const sB = uniqueS[(idx + 1) % uniqueS.length];

    if (idx < uniqueS.length - 1) {
      // Cut is strictly inside [sA, sB] without wrapping around vertex 0
      const cutPathPts = extractSubPath(sA, sB);
      // Kept chain wraps from sB -> totalLen and 0 -> sA
      const tail = extractSubPath(sB, totalLen);
      const head = extractSubPath(0, sA);
      const merged = [...tail];
      for (let i = 1; i < head.length; i++) merged.push(head[i]);
      return {
        action: 'trim-polyline',
        entity: poly,
        cutPathPts,
        keptChains: merged.length >= 2 ? [merged] : [],
      };
    } else {
      // Cut wraps around 0: [sA, totalLen] + [0, sB], kept is [sB, sA]
      const tailCut = extractSubPath(sA, totalLen);
      const headCut = extractSubPath(0, sB);
      const cutPathPts = [...tailCut];
      for (let i = 1; i < headCut.length; i++) cutPathPts.push(headCut[i]);

      const kept = extractSubPath(sB, sA);
      return {
        action: 'trim-polyline',
        entity: poly,
        cutPathPts,
        keptChains: kept.length >= 2 ? [kept] : [],
      };
    }
  }

  private computeTrimIntervalOnSegment(
    p1: Point2D,
    p2: Point2D,
    cursorPt: Point2D,
    ownerId: string,
    ownerSegIdx: number,
    context: ToolContext
  ): { tA: number; tB: number; cutStart: Point2D; cutEnd: Point2D } | null {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-10) return null;

    const tValues: number[] = [0, 1];

    // Collect intersections with all other segments & circles
    for (const other of context.doc.entities) {
      const layer = context.doc.layers.find(l => l.id === other.layerId);
      if (layer && !layer.visible) continue;

      if (other.type === 'line') {
        if (other.id === ownerId) continue;
        const inter = VectorMath.segmentIntersection(p1, p2, { x: other.x1, y: other.y1 }, { x: other.x2, y: other.y2 });
        if (inter) {
          const t = ((inter.x - p1.x) * dx + (inter.y - p1.y) * dy) / lenSq;
          if (t > 1e-4 && t < 1 - 1e-4) tValues.push(t);
        }
      } else if (other.type === 'polyline') {
        const pts = other.points;
        const segCount = other.closed ? pts.length : pts.length - 1;
        for (let s = 0; s < segCount; s++) {
          if (other.id === ownerId && s === ownerSegIdx) continue;
          const q1 = pts[s];
          const q2 = pts[(s + 1) % pts.length];
          const inter = VectorMath.segmentIntersection(p1, p2, q1, q2);
          if (inter) {
            const t = ((inter.x - p1.x) * dx + (inter.y - p1.y) * dy) / lenSq;
            if (t > 1e-4 && t < 1 - 1e-4) tValues.push(t);
          }
        }
      } else if (other.type === 'circle') {
        const inters = this.segmentCircleIntersections(p1, p2, other);
        for (const t of inters) {
          if (t > 1e-4 && t < 1 - 1e-4) tValues.push(t);
        }
      }
    }

    if (tValues.length <= 2) return null;

    tValues.sort((a, b) => a - b);
    const uniqueT: number[] = [tValues[0]];
    for (let i = 1; i < tValues.length; i++) {
      if (tValues[i] - uniqueT[uniqueT.length - 1] > 1e-4) {
        uniqueT.push(tValues[i]);
      }
    }
    if (uniqueT.length <= 2) return null;

    const tCursor = Math.max(0, Math.min(1, ((cursorPt.x - p1.x) * dx + (cursorPt.y - p1.y) * dy) / lenSq));

    for (let i = 0; i < uniqueT.length - 1; i++) {
      const tA = uniqueT[i];
      const tB = uniqueT[i + 1];
      if (tCursor >= tA - 1e-5 && tCursor <= tB + 1e-5) {
        return {
          tA,
          tB,
          cutStart: { x: p1.x + dx * tA, y: p1.y + dy * tA },
          cutEnd: { x: p1.x + dx * tB, y: p1.y + dy * tB },
        };
      }
    }
    return null;
  }

  private findExtendCandidate(pt: Point2D, context: ToolContext): ExtendCandidate | null {
    const tol = 9 / context.transform.zoom;

    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;

      if (ent.type === 'line') {
        const p1 = { x: ent.x1, y: ent.y1 };
        const p2 = { x: ent.x2, y: ent.y2 };
        if (VectorMath.pointToSegmentDistance(pt, p1, p2) <= tol) {
          const d1 = VectorMath.distance(pt, p1);
          const d2 = VectorMath.distance(pt, p2);
          const extendStart = d1 < d2;
          const fromPt = extendStart ? p1 : p2;
          const dir = VectorMath.normalize(
            extendStart ? { x: p1.x - p2.x, y: p1.y - p2.y } : { x: p2.x - p1.x, y: p2.y - p1.y }
          );

          const targetPt = this.findNearestRayIntersection(fromPt, dir, ent.id, context);
          if (targetPt) {
            return {
              action: 'extend',
              entity: ent,
              extendStartEndpoint: extendStart,
              fromPt,
              targetPt,
            };
          }
        }
      } else if (ent.type === 'polyline' && !ent.closed && ent.points.length >= 2) {
        const pts = ent.points;
        const pStart = pts[0];
        const pStartNext = pts[1];
        if (VectorMath.pointToSegmentDistance(pt, pStart, pStartNext) <= tol) {
          const dir = VectorMath.normalize({ x: pStart.x - pStartNext.x, y: pStart.y - pStartNext.y });
          const targetPt = this.findNearestRayIntersection(pStart, dir, ent.id, context);
          if (targetPt) {
            return {
              action: 'extend',
              entity: ent,
              extendStartEndpoint: true,
              fromPt: pStart,
              targetPt,
            };
          }
        }

        const pEnd = pts[pts.length - 1];
        const pEndPrev = pts[pts.length - 2];
        if (VectorMath.pointToSegmentDistance(pt, pEndPrev, pEnd) <= tol) {
          const dir = VectorMath.normalize({ x: pEnd.x - pEndPrev.x, y: pEnd.y - pEndPrev.y });
          const targetPt = this.findNearestRayIntersection(pEnd, dir, ent.id, context);
          if (targetPt) {
            return {
              action: 'extend',
              entity: ent,
              extendStartEndpoint: false,
              fromPt: pEnd,
              targetPt,
            };
          }
        }
      }
    }
    return null;
  }

  private findNearestRayIntersection(
    origin: Point2D,
    dir: Point2D,
    ignoreEntityId: string,
    context: ToolContext
  ): Point2D | null {
    const maxRayDist = 1e6;
    const rayEnd = { x: origin.x + dir.x * maxRayDist, y: origin.y + dir.y * maxRayDist };
    let bestPt: Point2D | null = null;
    let bestDist = Infinity;

    const consider = (pt: Point2D) => {
      const d = VectorMath.distance(origin, pt);
      if (d > 1e-3 && d < bestDist) {
        bestDist = d;
        bestPt = pt;
      }
    };

    for (const ent of context.doc.entities) {
      if (ent.id === ignoreEntityId) continue;
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && !layer.visible) continue;

      if (ent.type === 'line') {
        const hit = VectorMath.segmentIntersection(origin, rayEnd, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 });
        if (hit) consider(hit);
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        const segCount = ent.closed ? pts.length : pts.length - 1;
        for (let s = 0; s < segCount; s++) {
          const hit = VectorMath.segmentIntersection(origin, rayEnd, pts[s], pts[(s + 1) % pts.length]);
          if (hit) consider(hit);
        }
      } else if (ent.type === 'circle') {
        const ts = this.segmentCircleIntersections(origin, rayEnd, ent);
        for (const t of ts) {
          if (t > 0 && t <= 1) {
            consider({
              x: origin.x + (rayEnd.x - origin.x) * t,
              y: origin.y + (rayEnd.y - origin.y) * t,
            });
          }
        }
      }
    }

    return bestPt;
  }

  private segmentCircleIntersections(p1: Point2D, p2: Point2D, circle: CircleEntity): number[] {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const fx = p1.x - circle.cx;
    const fy = p1.y - circle.cy;

    const a = dx * dx + dy * dy;
    if (a < 1e-10) return [];
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circle.radius * circle.radius;

    const disc = b * b - 4 * a * c;
    if (disc < 0) return [];

    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);
    const res: number[] = [];
    if (t1 >= 0 && t1 <= 1) res.push(t1);
    if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > 1e-6) res.push(t2);
    return res;
  }

  private applyLineTrim(cand: LineTrimCandidate, context: ToolContext) {
    const line = cand.entity;
    const oldState = { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };

    // Case A: Trim start [0, tB]
    if (cand.tA <= 1e-4 && cand.tB < 1 - 1e-4) {
      const cmd: Command = {
        description: tr('Przytnij początek linii', 'Trim line start'),
        execute: () => {
          line.x1 = cand.cutEnd.x;
          line.y1 = cand.cutEnd.y;
          context.doc.notifyChange();
        },
        undo: () => {
          line.x1 = oldState.x1;
          line.y1 = oldState.y1;
          context.doc.notifyChange();
        },
      };
      context.history.execute(cmd);
      return;
    }

    // Case B: Trim end [tA, 1]
    if (cand.tA > 1e-4 && cand.tB >= 1 - 1e-4) {
      const cmd: Command = {
        description: tr('Przytnij koniec linii', 'Trim line end'),
        execute: () => {
          line.x2 = cand.cutStart.x;
          line.y2 = cand.cutStart.y;
          context.doc.notifyChange();
        },
        undo: () => {
          line.x2 = oldState.x2;
          line.y2 = oldState.y2;
          context.doc.notifyChange();
        },
      };
      context.history.execute(cmd);
      return;
    }

    // Case C: Trim middle [tA, tB] -> shorten original line to [0, tA] and add second line [tB, 1]
    const secondLine: LineEntity = {
      id: `line_trim_${Date.now()}`,
      type: 'line',
      layerId: line.layerId,
      color: line.color,
      lineType: line.lineType,
      lineWidth: line.lineWidth,
      groupId: line.groupId,
      groupName: line.groupName,
      selected: false,
      x1: cand.cutEnd.x,
      y1: cand.cutEnd.y,
      x2: oldState.x2,
      y2: oldState.y2,
    };

    const cmd: Command = {
      description: tr('Wytnij środkowy fragment linii', 'Trim middle segment of line'),
      execute: () => {
        line.x2 = cand.cutStart.x;
        line.y2 = cand.cutStart.y;
        context.doc.addEntity(secondLine);
        context.doc.notifyChange();
      },
      undo: () => {
        line.x2 = oldState.x2;
        line.y2 = oldState.y2;
        context.doc.removeEntity(secondLine.id);
        context.doc.notifyChange();
      },
    };
    context.history.execute(cmd);
  }

  private applyCircleTrim(cand: CircleTrimCandidate, context: ToolContext) {
    const circle = cand.entity;
    const keptArc: PolylineEntity = {
      id: `arc_trim_${Date.now()}`,
      type: 'polyline',
      layerId: circle.layerId,
      color: circle.color,
      lineType: circle.lineType,
      lineWidth: circle.lineWidth,
      groupId: circle.groupId,
      groupName: circle.groupName,
      selected: false,
      closed: false,
      points: cand.keepArcPts.map(p => ({ ...p })),
    };

    const cmd: Command = {
      description: tr('Przytnij łuk okręgu', 'Trim circle arc'),
      execute: () => {
        context.doc.removeEntity(circle.id);
        context.doc.addEntity(keptArc);
        context.doc.notifyChange();
      },
      undo: () => {
        context.doc.removeEntity(keptArc.id);
        context.doc.addEntity(circle);
        context.doc.notifyChange();
      },
    };
    context.history.execute(cmd);
  }

  private applyPolylineTrim(cand: PolylineTrimCandidate, context: ToolContext) {
    const poly = cand.entity;
    let seq = 1;
    const newPolys: PolylineEntity[] = cand.keptChains.map(chain => ({
      id: `poly_trim_${Date.now()}_${seq++}`,
      type: 'polyline',
      layerId: poly.layerId,
      color: poly.color,
      lineType: poly.lineType,
      lineWidth: poly.lineWidth,
      groupId: poly.groupId,
      groupName: poly.groupName,
      selected: false,
      closed: false,
      points: chain.map(p => ({ ...p })),
    }));

    const cmd: Command = {
      description: tr('Przytnij polilinię / łuk', 'Trim polyline / arc'),
      execute: () => {
        context.doc.removeEntity(poly.id);
        newPolys.forEach(np => context.doc.addEntity(np));
        context.doc.notifyChange();
      },
      undo: () => {
        newPolys.forEach(np => context.doc.removeEntity(np.id));
        context.doc.addEntity(poly);
        context.doc.notifyChange();
      },
    };
    context.history.execute(cmd);
  }

  private applyExtend(cand: ExtendCandidate, context: ToolContext) {
    if (cand.entity.type === 'line') {
      const line = cand.entity;
      const oldState = { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };
      const cmd: Command = {
        description: tr('Wydłuż linię do krawędzi', 'Extend line to boundary'),
        execute: () => {
          if (cand.extendStartEndpoint) {
            line.x1 = cand.targetPt.x;
            line.y1 = cand.targetPt.y;
          } else {
            line.x2 = cand.targetPt.x;
            line.y2 = cand.targetPt.y;
          }
          context.doc.notifyChange();
        },
        undo: () => {
          line.x1 = oldState.x1;
          line.y1 = oldState.y1;
          line.x2 = oldState.x2;
          line.y2 = oldState.y2;
          context.doc.notifyChange();
        },
      };
      context.history.execute(cmd);
    } else if (cand.entity.type === 'polyline') {
      const poly = cand.entity;
      const idx = cand.extendStartEndpoint ? 0 : poly.points.length - 1;
      const oldPt = { ...poly.points[idx] };
      const cmd: Command = {
        description: tr('Wydłuż polilinię do krawędzi', 'Extend polyline to boundary'),
        execute: () => {
          poly.points[idx] = { ...cand.targetPt };
          context.doc.notifyChange();
        },
        undo: () => {
          poly.points[idx] = { ...oldPt };
          context.doc.notifyChange();
        },
      };
      context.history.execute(cmd);
    }
  }

  getPreview(): RenderPreview | null {
    if (!this.candidate) return null;

    if (this.candidate.action === 'trim-line') {
      const ghostLine: LineEntity = {
        id: '__preview_trim_line',
        type: 'line',
        layerId: '0',
        color: '#ef4444',
        selected: false,
        x1: this.candidate.cutStart.x,
        y1: this.candidate.cutStart.y,
        x2: this.candidate.cutEnd.x,
        y2: this.candidate.cutEnd.y,
      };
      return {
        type: 'ghost',
        data: {
          entities: [ghostLine],
          line: { p1: this.candidate.cutStart, p2: this.candidate.cutEnd },
          label: `✂️ ${tr('Przytnij', 'Trim')}`,
        },
      };
    }

    if (this.candidate.action === 'trim-circle') {
      const ghostArc: PolylineEntity = {
        id: '__preview_trim_circle',
        type: 'polyline',
        layerId: '0',
        color: '#ef4444',
        selected: false,
        closed: false,
        points: this.candidate.cutArcPts,
      };
      return {
        type: 'ghost',
        data: {
          entities: [ghostArc],
          label: `✂️ ${tr('Przytnij łuk okręgu', 'Trim circle arc')}`,
        },
      };
    }

    if (this.candidate.action === 'trim-polyline') {
      const ghostPoly: PolylineEntity = {
        id: '__preview_trim_poly',
        type: 'polyline',
        layerId: '0',
        color: '#ef4444',
        selected: false,
        closed: false,
        points: this.candidate.cutPathPts,
      };
      return {
        type: 'ghost',
        data: {
          entities: [ghostPoly],
          label: `✂️ ${tr('Przytnij', 'Trim')}`,
        },
      };
    }

    const ghostExt: LineEntity = {
      id: '__preview_extend',
      type: 'line',
      layerId: '0',
      color: '#22c55e',
      selected: false,
      x1: this.candidate.fromPt.x,
      y1: this.candidate.fromPt.y,
      x2: this.candidate.targetPt.x,
      y2: this.candidate.targetPt.y,
    };
    return {
      type: 'ghost',
      data: {
        entities: [ghostExt],
        line: { p1: this.candidate.fromPt, p2: this.candidate.targetPt },
        label: `↗️ ${tr('Wydłuż', 'Extend')}`,
      },
    };
  }
}

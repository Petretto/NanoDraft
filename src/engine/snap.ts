import { CadDocument } from '../model/document';
import { ViewportTransform } from '../math/transform';
import { VectorMath } from '../math/vector';
import { Point2D, SnapPoint } from '../types/cad';
import { CadGrid } from './grid';
import {
  Segment,
  CircleGeom,
  entityPrimitives,
  intersectSegments,
  intersectSegmentCircle,
  intersectCircles,
} from '../math/geometry';

export class SnapEngine {
  public enabled: boolean = true;
  public snapRadiusPx: number = 14; // Screen distance in px for snap trigger

  public snapEndpoints: boolean = true;
  public snapMidpoints: boolean = true;
  public snapCenters: boolean = true;
  public snapIntersections: boolean = true;
  public snapPerpendicular: boolean = true;
  public snapTangent: boolean = true;
  public snapGrid: boolean = false;
  public orthoEnabled: boolean = false;
  public isShiftOrthoActive: boolean = false;

  public isOrthoActive(): boolean {
    return this.orthoEnabled || this.isShiftOrthoActive;
  }

  /**
   * Constrain target point to horizontal or vertical axis relative to origin
   */
  applyOrtho(origin: Point2D, target: Point2D): Point2D {
    if (!this.isOrthoActive()) return target;
    const dx = Math.abs(target.x - origin.x);
    const dy = Math.abs(target.y - origin.y);
    if (dx >= dy) {
      return { x: target.x, y: origin.y };
    } else {
      return { x: origin.x, y: target.y };
    }
  }

  findSnapPoint(
    screenCursor: Point2D,
    doc: CadDocument,
    transform: ViewportTransform,
    grid: CadGrid,
    fromPt: Point2D | null = null
  ): SnapPoint | null {
    if (!this.enabled) return null;

    const worldCursor = transform.screenToWorld(screenCursor);
    const maxWorldDist = transform.screenDistToWorld(this.snapRadiusPx);

    let bestSnap: SnapPoint | null = null;
    let bestDist = Infinity;

    const tryCandidate = (pt: Point2D, type: SnapPoint['type'], entityId?: string) => {
      const d = VectorMath.distance(worldCursor, pt);
      if (d >= maxWorldDist) return;
      // Precise snaps always beat 'nearest'; among precise snaps pick closest
      const beatsExisting =
        type === 'nearest'
          ? !bestSnap && d < bestDist
          : bestSnap?.type === 'nearest' || d < bestDist - 1e-9;
      if (beatsExisting) {
        bestDist = d;
        bestSnap = { point: pt, type, entityId };
      }
    };

    const tryPerpOnSegment = (pA: Point2D, pB: Point2D, entityId: string) => {
      if (!fromPt || !this.snapPerpendicular) return;
      const dx = pB.x - pA.x;
      const dy = pB.y - pA.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq <= 1e-10) return;
      const t = ((fromPt.x - pA.x) * dx + (fromPt.y - pA.y) * dy) / lenSq;
      if (t < 0 || t > 1) return;
      const foot = { x: pA.x + t * dx, y: pA.y + t * dy };
      if (VectorMath.distance(fromPt, foot) <= 1e-4) return;
      tryCandidate(foot, 'perpendicular', entityId);
    };

    // 1. Check Entities
    for (const ent of doc.entities) {
      const layer = doc.layers.find(l => l.id === ent.layerId);
      if (layer && !layer.visible) continue;

      if (ent.type === 'point') {
        tryCandidate({ x: ent.x, y: ent.y }, 'endpoint', ent.id);
      } else if (ent.type === 'line') {
        const p1 = { x: ent.x1, y: ent.y1 };
        const p2 = { x: ent.x2, y: ent.y2 };
        // Endpoints
        if (this.snapEndpoints) {
          tryCandidate(p1, 'endpoint', ent.id);
          tryCandidate(p2, 'endpoint', ent.id);
        }
        // Midpoint
        if (this.snapMidpoints) {
          tryCandidate(VectorMath.midpoint(p1, p2), 'midpoint', ent.id);
        }
        // Perpendicular foot from reference point
        tryPerpOnSegment(p1, p2, ent.id);
      } else if (ent.type === 'circle') {
        const center = { x: ent.cx, y: ent.cy };
        // 1. Center
        if (this.snapCenters) {
          tryCandidate(center, 'center', ent.id);
        }
        // 2. Quadrants (Top, Right, Bottom, Left edges)
        const quadrants = [
          { x: ent.cx + ent.radius, y: ent.cy },
          { x: ent.cx, y: ent.cy + ent.radius },
          { x: ent.cx - ent.radius, y: ent.cy },
          { x: ent.cx, y: ent.cy - ent.radius },
        ];
        for (const q of quadrants) {
          tryCandidate(q, 'quadrant', ent.id);
        }
        // 3. Tangent points from fromPt (requires fromPt strictly outside circle)
        if (fromPt && this.snapTangent && ent.radius > 1e-6) {
          const distFromCenter = VectorMath.distance(fromPt, center);
          if (distFromCenter > ent.radius + 1e-6) {
            const baseAngle = Math.atan2(fromPt.y - ent.cy, fromPt.x - ent.cx);
            const ratio = Math.min(1, Math.max(-1, ent.radius / distFromCenter));
            const alpha = Math.acos(ratio);
            const t1 = {
              x: ent.cx + ent.radius * Math.cos(baseAngle + alpha),
              y: ent.cy + ent.radius * Math.sin(baseAngle + alpha),
            };
            const t2 = {
              x: ent.cx + ent.radius * Math.cos(baseAngle - alpha),
              y: ent.cy + ent.radius * Math.sin(baseAngle - alpha),
            };
            tryCandidate(t1, 'tangent', ent.id);
            tryCandidate(t2, 'tangent', ent.id);
          }
        }
        // 4. Perpendicular points on circle along line fromPt -> center
        if (fromPt && this.snapPerpendicular && ent.radius > 1e-6) {
          const distFromCenter = VectorMath.distance(fromPt, center);
          if (distFromCenter > 1e-6) {
            const ux = (fromPt.x - ent.cx) / distFromCenter;
            const uy = (fromPt.y - ent.cy) / distFromCenter;
            const pNear = { x: ent.cx + ux * ent.radius, y: ent.cy + uy * ent.radius };
            const pFar = { x: ent.cx - ux * ent.radius, y: ent.cy - uy * ent.radius };
            if (VectorMath.distance(fromPt, pNear) > 1e-4) {
              tryCandidate(pNear, 'perpendicular', ent.id);
            }
            if (VectorMath.distance(fromPt, pFar) > 1e-4) {
              tryCandidate(pFar, 'perpendicular', ent.id);
            }
          }
        }
        // 5. Nearest point on circle perimeter (krawędź okręgu — lowest priority)
        const distToCenter = VectorMath.distance(worldCursor, center);
        const distToCircumference = Math.abs(distToCenter - ent.radius);
        if (distToCircumference < maxWorldDist && !bestSnap) {
          const angle = Math.atan2(worldCursor.y - ent.cy, worldCursor.x - ent.cx);
          const edgePt = {
            x: ent.cx + ent.radius * Math.cos(angle),
            y: ent.cy + ent.radius * Math.sin(angle),
          };
          bestDist = distToCircumference;
          bestSnap = { point: edgePt, type: 'nearest', entityId: ent.id };
        }
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        // Endpoints / vertices
        if (this.snapEndpoints) {
          for (const p of pts) {
            tryCandidate(p, 'endpoint', ent.id);
          }
        }
        // Midpoints & Perpendicular feet on segments
        const count = ent.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < count; i++) {
          const pA = pts[i];
          const pB = pts[(i + 1) % pts.length];
          if (this.snapMidpoints) {
            tryCandidate(VectorMath.midpoint(pA, pB), 'midpoint', ent.id);
          }
          tryPerpOnSegment(pA, pB, ent.id);
        }
        // Center of closed polyline (e.g. rectangle) or circular arc polyline
        if (this.snapCenters && pts.length >= 3) {
          if (ent.closed) {
            const xs = pts.map(p => p.x);
            const ys = pts.map(p => p.y);
            const center = {
              x: (Math.min(...xs) + Math.max(...xs)) / 2,
              y: (Math.min(...ys) + Math.max(...ys)) / 2,
            };
            tryCandidate(center, 'center', ent.id);

            // Also detect arc sub-path centers (e.g. Slot semicircles, Filleted corners)
            if (pts.length >= 12) {
              const n = pts.length;
              const segLens: number[] = [];
              for (let k = 0; k < n; k++) {
                segLens.push(VectorMath.distance(pts[k], pts[(k + 1) % n]));
              }
              const sortedLens = [...segLens].sort((a, b) => a - b);
              const medianLen = sortedLens[Math.floor(n / 2)];
              if (medianLen > 1e-5) {
                // Find straight-edge separators (> 1.8x median chord length)
                const breaks: number[] = [];
                for (let k = 0; k < n; k++) {
                  if (segLens[k] > medianLen * 1.8) breaks.push(k);
                }
                if (breaks.length >= 1 && breaks.length <= 8) {
                  for (let b = 0; b < breaks.length; b++) {
                    const startIdx = (breaks[b] + 1) % n;
                    const endIdx = breaks[(b + 1) % breaks.length];
                    const span = (endIdx - startIdx + n) % n;
                    if (span >= 4) {
                      const p1 = pts[startIdx];
                      const p2 = pts[(startIdx + Math.floor(span / 2)) % n];
                      const p3 = pts[endIdx];
                      const denom = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
                      if (Math.abs(denom) > 1e-6) {
                        const cx =
                          ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y) +
                            (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y) +
                            (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) /
                          denom;
                        const cy =
                          ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x) +
                            (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x) +
                            (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) /
                          denom;
                        const r = Math.hypot(p1.x - cx, p1.y - cy);
                        const qPt = pts[(startIdx + Math.floor(span / 4)) % n];
                        if (r > 1e-4 && medianLen <= r * 0.26 && Math.abs(Math.hypot(qPt.x - cx, qPt.y - cy) - r) <= r * 0.03 + 0.1) {
                          tryCandidate({ x: cx, y: cy }, 'center', ent.id);
                        }
                      }
                    }
                  }
                }
              }
            }
          } else if (pts.length >= 6) {
            // Check if open polyline is a circular arc (3-point circumcenter check)
            const p1 = pts[0];
            const p2 = pts[Math.floor(pts.length / 2)];
            const p3 = pts[pts.length - 1];
            const denom = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
            if (Math.abs(denom) > 1e-6) {
              const cx =
                ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y) +
                  (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y) +
                  (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) /
                denom;
              const cy =
                ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x) +
                  (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x) +
                  (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) /
                denom;
              const r = Math.hypot(p1.x - cx, p1.y - cy);
              const qPt = pts[Math.floor(pts.length / 4)];
              if (Math.abs(Math.hypot(qPt.x - cx, qPt.y - cy) - r) <= r * 0.02 + 0.5) {
                tryCandidate({ x: cx, y: cy }, 'center', ent.id);
              }
            }
          }
        }
      }
    }

    // 1b. Intersection snap (line/line, line/circle, circle/circle) – only entities near the cursor
    if (this.snapIntersections) {
      const nearSegs: Segment[] = [];
      const nearCircles: CircleGeom[] = [];
      for (const ent of doc.entities) {
        const layer = doc.layers.find(l => l.id === ent.layerId);
        if (layer && !layer.visible) continue;
        const prims = entityPrimitives(ent);
        for (const s of prims.segments) {
          if (VectorMath.distanceToSegment(worldCursor, s.a, s.b) <= maxWorldDist) nearSegs.push(s);
        }
        for (const c of prims.circles) {
          if (Math.abs(VectorMath.distance(worldCursor, c.c) - c.r) <= maxWorldDist) nearCircles.push(c);
        }
      }

      const candidates: Point2D[] = [];
      for (let i = 0; i < nearSegs.length; i++) {
        for (let j = i + 1; j < nearSegs.length; j++) {
          const p = intersectSegments(nearSegs[i], nearSegs[j]);
          if (p) candidates.push(p);
        }
        for (const c of nearCircles) candidates.push(...intersectSegmentCircle(nearSegs[i], c));
      }
      for (let i = 0; i < nearCircles.length; i++) {
        for (let j = i + 1; j < nearCircles.length; j++) {
          candidates.push(...intersectCircles(nearCircles[i], nearCircles[j]));
        }
      }

      for (const p of candidates) {
        const d = VectorMath.distance(worldCursor, p);
        // Intersection beats "nearest"; ties with endpoints keep the endpoint (same location anyway)
        if (d < maxWorldDist && (d < bestDist - 1e-9 || bestSnap?.type === 'nearest')) {
          bestDist = d;
          bestSnap = { point: p, type: 'intersection' };
        }
      }
    }

    // 2. Check Grid Snap if enabled and no entity snap found
    if (!bestSnap && (this.snapGrid || grid.snapToGrid)) {
      const step = grid.gridSpacing;
      const snapX = Math.round(worldCursor.x / step) * step;
      const snapY = Math.round(worldCursor.y / step) * step;
      const gridPt = { x: snapX, y: snapY };
      const d = VectorMath.distance(worldCursor, gridPt);
      if (d < maxWorldDist) {
        bestSnap = { point: gridPt, type: 'grid' };
      }
    }

    return bestSnap;
  }

  renderSnapMarker(ctx: CanvasRenderingContext2D, snap: SnapPoint, transform: ViewportTransform) {
    const screenPt = transform.worldToScreen(snap.point);
    ctx.save();
    ctx.strokeStyle = '#00e676'; // Vibrant CAD green
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(0, 230, 118, 0.2)';

    const s = 6; // Half-size

    if (snap.type === 'endpoint') {
      // Square
      ctx.strokeRect(screenPt.x - s, screenPt.y - s, s * 2, s * 2);
    } else if (snap.type === 'midpoint') {
      // Triangle
      ctx.beginPath();
      ctx.moveTo(screenPt.x, screenPt.y - s);
      ctx.lineTo(screenPt.x + s, screenPt.y + s);
      ctx.lineTo(screenPt.x - s, screenPt.y + s);
      ctx.closePath();
      ctx.stroke();
    } else if (snap.type === 'center') {
      // Circle
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y, s, 0, Math.PI * 2);
      ctx.stroke();
    } else if (snap.type === 'intersection') {
      // X cross (AutoCAD Intersection marker)
      ctx.beginPath();
      ctx.moveTo(screenPt.x - s, screenPt.y - s);
      ctx.lineTo(screenPt.x + s, screenPt.y + s);
      ctx.moveTo(screenPt.x + s, screenPt.y - s);
      ctx.lineTo(screenPt.x - s, screenPt.y + s);
      ctx.stroke();
    } else if (snap.type === 'quadrant') {
      // Rhombus / Diamond (AutoCAD Quadrant marker)
      ctx.beginPath();
      ctx.moveTo(screenPt.x, screenPt.y - s - 1);
      ctx.lineTo(screenPt.x + s + 1, screenPt.y);
      ctx.lineTo(screenPt.x, screenPt.y + s + 1);
      ctx.lineTo(screenPt.x - s - 1, screenPt.y);
      ctx.closePath();
      ctx.stroke();
    } else if (snap.type === 'perpendicular') {
      // AutoCAD Perpendicular symbol: right angle corner ∟ with small inner square
      ctx.beginPath();
      ctx.moveTo(screenPt.x - s, screenPt.y - s);
      ctx.lineTo(screenPt.x - s, screenPt.y + s);
      ctx.lineTo(screenPt.x + s, screenPt.y + s);
      // Inner right-angle tick
      ctx.moveTo(screenPt.x - s, screenPt.y);
      ctx.lineTo(screenPt.x, screenPt.y);
      ctx.lineTo(screenPt.x, screenPt.y + s);
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#00e676';
      ctx.fillText('∟', screenPt.x + s + 4, screenPt.y - 3);
    } else if (snap.type === 'tangent') {
      // AutoCAD Tangent symbol: circle with horizontal tangent line on top
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y + 1, s - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(screenPt.x - s - 1, screenPt.y - s + 1);
      ctx.lineTo(screenPt.x + s + 1, screenPt.y - s + 1);
      ctx.stroke();

      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#00e676';
      ctx.fillText('TAN', screenPt.x + s + 4, screenPt.y - 3);
    } else if (snap.type === 'nearest') {
      // Hourglass (AutoCAD Nearest marker)
      ctx.beginPath();
      ctx.moveTo(screenPt.x - s, screenPt.y - s);
      ctx.lineTo(screenPt.x + s, screenPt.y + s);
      ctx.lineTo(screenPt.x - s, screenPt.y + s);
      ctx.lineTo(screenPt.x + s, screenPt.y - s);
      ctx.closePath();
      ctx.stroke();
    } else if (snap.type === 'grid') {
      // Small cross
      ctx.beginPath();
      ctx.moveTo(screenPt.x - s, screenPt.y);
      ctx.lineTo(screenPt.x + s, screenPt.y);
      ctx.moveTo(screenPt.x, screenPt.y - s);
      ctx.lineTo(screenPt.x, screenPt.y + s);
      ctx.stroke();
    }

    ctx.restore();
  }
}


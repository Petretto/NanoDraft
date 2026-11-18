import { Point2D, UnitType } from '../types/cad';

export class VectorMath {
  static distance(p1: Point2D, p2: Point2D): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  static angleDeg(p1: Point2D, p2: Point2D): number {
    const rad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let deg = (rad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }

  static angleRad(p1: Point2D, p2: Point2D): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }

  static pointFromPolar(origin: Point2D, distance: number, angleDeg: number): Point2D {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: origin.x + distance * Math.cos(rad),
      y: origin.y + distance * Math.sin(rad),
    };
  }

  static midpoint(p1: Point2D, p2: Point2D): Point2D {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };
  }

  static distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return VectorMath.distance(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return VectorMath.distance(p, proj);
  }

  static pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
    return VectorMath.distanceToSegment(p, a, b);
  }

  static normalize(v: Point2D): Point2D {
    const len = Math.sqrt(v.x * v.x + v.y * v.y);
    if (len < 1e-12) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  static segmentIntersection(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-10) return null;

    const dx = b1.x - a1.x;
    const dy = b1.y - a1.y;
    const t = (dx * d2y - dy * d2x) / denom;
    const u = (dx * d1y - dy * d1x) / denom;

    if (t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) {
      return { x: a1.x + t * d1x, y: a1.y + t * d1y };
    }
    return null;
  }

  static round(val: number, decimals: number = 2): number {
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }

  static formatLength(val: number, unit: UnitType = 'mm', decimals: number = 2): string {
    return `${VectorMath.round(val, decimals)} ${unit}`;
  }
}


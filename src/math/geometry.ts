import { CadEntity, DimensionEntity, Point2D, TextEntity } from '../types/cad';
import { VectorMath } from './vector';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Segment {
  a: Point2D;
  b: Point2D;
}

export interface CircleGeom {
  c: Point2D;
  r: number;
}

/** Return effective frame width & height (in world units) for a TextEntity */
export function getTextFrameSize(ent: TextEntity, minHeightWorld: number = 0): { w: number; h: number } {
  const effH = Math.max(ent.height, minHeightWorld);
  const defaultW = Math.max(ent.text.length * effH * 0.62, effH * 1.5);
  const defaultH = effH * 1.35;
  const w = ent.boxWidth !== undefined && ent.boxWidth > 0 ? ent.boxWidth : defaultW;
  const h = ent.boxHeight !== undefined && ent.boxHeight > 0 ? ent.boxHeight : defaultH;
  return { w, h };
}

/**
 * Compute the 4 world-space corners [BL, BR, TR, TL] of a TextEntity's frame
 * (plus center if needed).
 */
export function textWorldCorners(ent: TextEntity, minHeightWorld: number = 0): [Point2D, Point2D, Point2D, Point2D] {
  const { w, h } = getTextFrameSize(ent, minHeightWorld);

  const rad = ((ent.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const toWorld = (lx: number, ly: number): Point2D => ({
    x: ent.x + lx * cos - ly * sin,
    y: ent.y + lx * sin + ly * cos,
  });

  return [
    toWorld(0, 0), // 0: Bottom-Left (BL)
    toWorld(w, 0), // 1: Bottom-Right (BR)
    toWorld(w, h), // 2: Top-Right (TR)
    toWorld(0, h), // 3: Top-Left (TL)
  ];
}

/** Hit-test whether world point `pt` is inside (or within `padWorld` of) a TextEntity's frame */
export function isPointInText(pt: Point2D, ent: TextEntity, padWorld: number, minHeightWorld: number = 0): boolean {
  const { w, h } = getTextFrameSize(ent, minHeightWorld);

  // Transform `pt` into the text's unrotated local frame
  const dx = pt.x - ent.x;
  const dy = pt.y - ent.y;
  const rad = (-(ent.rotation || 0) * Math.PI) / 180;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

  return lx >= -padWorld && lx <= w + padWorld && ly >= -padWorld && ly <= h + padWorld;
}

/** Computes start angle, signed sweep angle (in radians), source radius, and arc length for an arc (center, p1, p2, optional arcMidPt). */
export function computeArcSweep(
  center: Point2D,
  p1: Point2D,
  p2: Point2D,
  arcMidPt?: Point2D
): { startAngle: number; sweep: number; sourceRadius: number; arcLength: number } {
  const sourceRadius = Math.hypot(p1.x - center.x, p1.y - center.y);
  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);

  const normCCW = (ang: number) => {
    let diff = ang - a1;
    while (diff < 0) diff += Math.PI * 2;
    while (diff >= Math.PI * 2) diff -= Math.PI * 2;
    return diff;
  };

  let sweep: number;
  if (arcMidPt) {
    const aMid = Math.atan2(arcMidPt.y - center.y, arcMidPt.x - center.x);
    const dMid = normCCW(aMid);
    const d2 = normCCW(a2);
    sweep = dMid <= d2 ? d2 : d2 - Math.PI * 2;
  } else {
    sweep = a2 - a1;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
  }

  return {
    startAngle: a1,
    sweep,
    sourceRadius,
    arcLength: sourceRadius * Math.abs(sweep),
  };
}

/** Extract segments and key points of a DimensionEntity for hit-testing & Window/Crossing selection */
export function dimensionGeometry(dim: DimensionEntity): { points: Point2D[]; segments: Segment[] } {
  if (dim.dimType === 'leader') {
    const dirSign =
      dim.offset !== undefined && dim.offset !== 0
        ? Math.sign(dim.offset)
        : dim.p2.x >= dim.p1.x
        ? 1
        : -1;
    const th = dim.textHeight || 3.5;
    const textLen = (dim.customText || 'Odnośnik').length * th * 0.62;
    const shelfLen = Math.max(Math.abs(dim.offset || 0), textLen, th * 3);
    const p3 = { x: dim.p2.x + dirSign * shelfLen, y: dim.p2.y };
    return {
      points: [dim.p1, dim.p2, p3],
      segments: [
        { a: dim.p1, b: dim.p2 },
        { a: dim.p2, b: p3 },
      ],
    };
  }

  if (dim.dimType === 'arc-length') {
    const center = dim.center || { x: 0, y: 0 };
    const { startAngle, sweep, sourceRadius } = computeArcSweep(center, dim.p1, dim.p2, dim.arcMidPt);
    const dimArcRadius = dim.radius || Math.max(sourceRadius + dim.offset, 1);
    const steps = 20;
    const arcPts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = startAngle + (sweep * i) / steps;
      arcPts.push({ x: center.x + Math.cos(a) * dimArcRadius, y: center.y + Math.sin(a) * dimArcRadius });
    }
    const segments: Segment[] = [
      { a: dim.p1, b: arcPts[0] },
      { a: dim.p2, b: arcPts[arcPts.length - 1] },
    ];
    for (let i = 0; i < arcPts.length - 1; i++) {
      segments.push({ a: arcPts[i], b: arcPts[i + 1] });
    }
    return {
      points: [dim.p1, dim.p2, ...arcPts],
      segments,
    };
  }

  if (dim.dimType === 'radius' || dim.dimType === 'diameter') {
    const center = dim.center || dim.p1;
    const radius = dim.radius || VectorMath.distance(center, dim.p2);
    const dirAngle = Math.atan2(dim.p2.y - center.y, dim.p2.x - center.x);
    const dir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
    const edge1 = { x: center.x + dir.x * radius, y: center.y + dir.y * radius };
    const edge2 = { x: center.x - dir.x * radius, y: center.y - dir.y * radius };
    const start = dim.dimType === 'diameter' ? edge2 : center;
    const leaderDist = Math.max(VectorMath.distance(center, dim.p2), radius);
    const end = { x: center.x + dir.x * leaderDist, y: center.y + dir.y * leaderDist };
    return {
      points: [start, edge1, end, dim.p2],
      segments: [{ a: start, b: end }],
    };
  }

  if (dim.dimType === 'angular') {
    const center = dim.center || { x: 0, y: 0 };
    const arcRadius = dim.radius || Math.max(Math.abs(dim.offset), 5);
    const ang1 = Math.atan2(dim.p1.y - center.y, dim.p1.x - center.x);
    const ang2 = Math.atan2(dim.p2.y - center.y, dim.p2.x - center.x);
    let diff = ang2 - ang1;
    while (diff <= -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const steps = 16;
    const arcPts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = ang1 + (diff * i) / steps;
      arcPts.push({ x: center.x + Math.cos(a) * arcRadius, y: center.y + Math.sin(a) * arcRadius });
    }
    const segments: Segment[] = [
      { a: dim.p1, b: arcPts[0] },
      { a: dim.p2, b: arcPts[arcPts.length - 1] },
    ];
    for (let i = 0; i < arcPts.length - 1; i++) {
      segments.push({ a: arcPts[i], b: arcPts[i + 1] });
    }
    return {
      points: [dim.p1, dim.p2, ...arcPts],
      segments,
    };
  }

  // Linear / aligned dimension
  const dx = dim.p2.x - dim.p1.x;
  const dy = dim.p2.y - dim.p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return { points: [dim.p1, dim.p2], segments: [] };
  }
  const nx = -dy / len;
  const ny = dx / len;
  const d1 = { x: dim.p1.x + nx * dim.offset, y: dim.p1.y + ny * dim.offset };
  const d2 = { x: dim.p2.x + nx * dim.offset, y: dim.p2.y + ny * dim.offset };
  return {
    points: [dim.p1, dim.p2, d1, d2],
    segments: [
      { a: d1, b: d2 },
      { a: dim.p1, b: d1 },
      { a: dim.p2, b: d2 },
    ],
  };
}

/** Bounding box of a single entity (null for degenerate entities) */
export function entityBounds(ent: CadEntity): Bounds | null {
  switch (ent.type) {
    case 'point':
      return { minX: ent.x, maxX: ent.x, minY: ent.y, maxY: ent.y };
    case 'line':
      return {
        minX: Math.min(ent.x1, ent.x2), maxX: Math.max(ent.x1, ent.x2),
        minY: Math.min(ent.y1, ent.y2), maxY: Math.max(ent.y1, ent.y2),
      };
    case 'circle':
      return { minX: ent.cx - ent.radius, maxX: ent.cx + ent.radius, minY: ent.cy - ent.radius, maxY: ent.cy + ent.radius };
    case 'polyline': {
      if (ent.points.length === 0) return null;
      const xs = ent.points.map(p => p.x);
      const ys = ent.points.map(p => p.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    case 'text': {
      const corners = textWorldCorners(ent);
      const xs = corners.map(c => c.x);
      const ys = corners.map(c => c.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    case 'dimension': {
      const { points } = dimensionGeometry(ent);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    case 'image':
      return {
        minX: ent.x,
        maxX: ent.x + ent.width,
        minY: ent.y,
        maxY: ent.y + ent.height,
      };
  }
}

export function unionBounds(entities: CadEntity[]): Bounds | null {
  let result: Bounds | null = null;
  for (const e of entities) {
    const b = entityBounds(e);
    if (!b) continue;
    if (!result) result = { ...b };
    else {
      result.minX = Math.min(result.minX, b.minX);
      result.minY = Math.min(result.minY, b.minY);
      result.maxX = Math.max(result.maxX, b.maxX);
      result.maxY = Math.max(result.maxY, b.maxY);
    }
  }
  return result;
}

/** Decompose an entity into straight segments and circles (used by snapping/intersections) */
export function entityPrimitives(ent: CadEntity): { segments: Segment[]; circles: CircleGeom[] } {
  const segments: Segment[] = [];
  const circles: CircleGeom[] = [];
  if (ent.type === 'line') {
    segments.push({ a: { x: ent.x1, y: ent.y1 }, b: { x: ent.x2, y: ent.y2 } });
  } else if (ent.type === 'polyline') {
    const n = ent.points.length;
    const count = ent.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      segments.push({ a: ent.points[i], b: ent.points[(i + 1) % n] });
    }
  } else if (ent.type === 'circle') {
    circles.push({ c: { x: ent.cx, y: ent.cy }, r: ent.radius });
  }
  return { segments, circles };
}

const EPS = 1e-9;

export function intersectSegments(s1: Segment, s2: Segment): Point2D | null {
  const d1x = s1.b.x - s1.a.x, d1y = s1.b.y - s1.a.y;
  const d2x = s2.b.x - s2.a.x, d2y = s2.b.y - s2.a.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null; // parallel
  const t = ((s2.a.x - s1.a.x) * d2y - (s2.a.y - s1.a.y) * d2x) / denom;
  const u = ((s2.a.x - s1.a.x) * d1y - (s2.a.y - s1.a.y) * d1x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: s1.a.x + t * d1x, y: s1.a.y + t * d1y };
}

/** Intersection of two infinite lines (used for angular dimensions & polyline offset mitering) */
export function intersectInfiniteLines(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

export function intersectSegmentCircle(s: Segment, c: CircleGeom): Point2D[] {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const fx = s.a.x - c.c.x, fy = s.a.y - c.c.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - c.r * c.r;
  const disc = b * b - 4 * a * cc;
  if (a < EPS || disc < 0) return [];
  const sq = Math.sqrt(disc);
  const result: Point2D[] = [];
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t >= -EPS && t <= 1 + EPS) result.push({ x: s.a.x + t * dx, y: s.a.y + t * dy });
  }
  return result;
}

export function intersectCircles(c1: CircleGeom, c2: CircleGeom): Point2D[] {
  const d = Math.hypot(c2.c.x - c1.c.x, c2.c.y - c1.c.y);
  if (d < EPS || d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const mx = c1.c.x + (a * (c2.c.x - c1.c.x)) / d;
  const my = c1.c.y + (a * (c2.c.y - c1.c.y)) / d;
  const ox = (h * (c2.c.y - c1.c.y)) / d;
  const oy = (h * (c2.c.x - c1.c.x)) / d;
  return [{ x: mx + ox, y: my - oy }, { x: mx - ox, y: my + oy }];
}

// ---------- Window (Left->Right) & Crossing (Right->Left) Selection Helpers ----------

export function pointInBox(p: Point2D, box: Bounds): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

export function segmentIntersectsOrInsideBox(s: Segment, box: Bounds): boolean {
  if (pointInBox(s.a, box) || pointInBox(s.b, box)) return true;
  // Quick AABB reject
  if (Math.max(s.a.x, s.b.x) < box.minX || Math.min(s.a.x, s.b.x) > box.maxX) return false;
  if (Math.max(s.a.y, s.b.y) < box.minY || Math.min(s.a.y, s.b.y) > box.maxY) return false;

  const bl = { x: box.minX, y: box.minY };
  const br = { x: box.maxX, y: box.minY };
  const tr = { x: box.maxX, y: box.maxY };
  const tl = { x: box.minX, y: box.maxY };

  return (
    intersectSegments(s, { a: bl, b: br }) !== null ||
    intersectSegments(s, { a: br, b: tr }) !== null ||
    intersectSegments(s, { a: tr, b: tl }) !== null ||
    intersectSegments(s, { a: tl, b: bl }) !== null
  );
}

/**
 * Window Selection (Left-to-Right):
 * Returns true if and only if the ENTIRE entity lies within `box`.
 */
export function entityInsideBox(ent: CadEntity, box: Bounds, minTextHeightWorld: number = 0): boolean {
  switch (ent.type) {
    case 'point':
      return pointInBox({ x: ent.x, y: ent.y }, box);
    case 'line':
      return pointInBox({ x: ent.x1, y: ent.y1 }, box) && pointInBox({ x: ent.x2, y: ent.y2 }, box);
    case 'circle':
      return (
        ent.cx - ent.radius >= box.minX &&
        ent.cx + ent.radius <= box.maxX &&
        ent.cy - ent.radius >= box.minY &&
        ent.cy + ent.radius <= box.maxY
      );
    case 'polyline':
      return ent.points.length > 0 && ent.points.every(p => pointInBox(p, box));
    case 'text': {
      const corners = textWorldCorners(ent, minTextHeightWorld);
      return corners.every(c => pointInBox(c, box));
    }
    case 'dimension': {
      const { points } = dimensionGeometry(ent);
      return points.length > 0 && points.every(p => pointInBox(p, box));
    }
    case 'image':
      return (
        pointInBox({ x: ent.x, y: ent.y }, box) &&
        pointInBox({ x: ent.x + ent.width, y: ent.y + ent.height }, box)
      );
  }
}

/**
 * Crossing Selection (Right-to-Left):
 * Returns true if ANY part of the entity is inside `box` OR intersects `box`.
 */
export function entityIntersectsOrInsideBox(ent: CadEntity, box: Bounds, minTextHeightWorld: number = 0): boolean {
  if (entityInsideBox(ent, box, minTextHeightWorld)) return true;

  switch (ent.type) {
    case 'point':
      return pointInBox({ x: ent.x, y: ent.y }, box);
    case 'line':
      return segmentIntersectsOrInsideBox({ a: { x: ent.x1, y: ent.y1 }, b: { x: ent.x2, y: ent.y2 } }, box);
    case 'circle': {
      // Closest point on box to circle center
      const closestX = Math.max(box.minX, Math.min(ent.cx, box.maxX));
      const closestY = Math.max(box.minY, Math.min(ent.cy, box.maxY));
      const minDist = Math.hypot(ent.cx - closestX, ent.cy - closestY);
      if (minDist > ent.radius) return false;
      // Also check furthest corner of box so a tiny box deep inside a huge circle only selects if it touches center or rim
      const furthestX = Math.max(Math.abs(ent.cx - box.minX), Math.abs(ent.cx - box.maxX));
      const furthestY = Math.max(Math.abs(ent.cy - box.minY), Math.abs(ent.cy - box.maxY));
      const maxDist = Math.hypot(furthestX, furthestY);
      const centerInBox = pointInBox({ x: ent.cx, y: ent.cy }, box);
      return centerInBox || maxDist >= ent.radius;
    }
    case 'polyline': {
      const n = ent.points.length;
      if (n === 0) return false;
      if (n === 1) return pointInBox(ent.points[0], box);
      const count = ent.closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        if (segmentIntersectsOrInsideBox({ a: ent.points[i], b: ent.points[(i + 1) % n] }, box)) {
          return true;
        }
      }
      return false;
    }
    case 'text': {
      const corners = textWorldCorners(ent, minTextHeightWorld);
      for (let i = 0; i < 4; i++) {
        if (segmentIntersectsOrInsideBox({ a: corners[i], b: corners[(i + 1) % 4] }, box)) {
          return true;
        }
      }
      // Check if selection box is completely inside text polygon
      return pointInPolygon({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, corners);
    }
    case 'dimension': {
      const { segments, points } = dimensionGeometry(ent);
      if (points.some(p => pointInBox(p, box))) return true;
      return segments.some(s => segmentIntersectsOrInsideBox(s, box));
    }
    case 'image': {
      const p1 = { x: ent.x, y: ent.y };
      const p2 = { x: ent.x + ent.width, y: ent.y };
      const p3 = { x: ent.x + ent.width, y: ent.y + ent.height };
      const p4 = { x: ent.x, y: ent.y + ent.height };
      return (
        segmentIntersectsOrInsideBox({ a: p1, b: p2 }, box) ||
        segmentIntersectsOrInsideBox({ a: p2, b: p3 }, box) ||
        segmentIntersectsOrInsideBox({ a: p3, b: p4 }, box) ||
        segmentIntersectsOrInsideBox({ a: p4, b: p1 }, box)
      );
    }
  }
}

// ---------- Geometric transforms (used by Rotate / Mirror / Move) ----------

export function rotatePoint(p: Point2D, center: Point2D, angleDeg: number): Point2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p.x - center.x, dy = p.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function mirrorPoint(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { ...p };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return { x: 2 * projX - p.x, y: 2 * projY - p.y };
}

/**
 * Apply a point transformation to an entity in place.
 * angleDelta: rotation added to text (rotate). mirrored: flips dimension offset side.
 */
export function transformEntity(
  ent: CadEntity,
  fn: (p: Point2D) => Point2D,
  opts: { angleDelta?: number; mirrored?: boolean; scale?: number } = {}
) {
  const apply = (x: number, y: number) => fn({ x, y });
  const sc = opts.scale ?? 1;
  switch (ent.type) {
    case 'point': {
      const p = apply(ent.x, ent.y); ent.x = p.x; ent.y = p.y; break;
    }
    case 'line': {
      const a = apply(ent.x1, ent.y1), b = apply(ent.x2, ent.y2);
      ent.x1 = a.x; ent.y1 = a.y; ent.x2 = b.x; ent.y2 = b.y; break;
    }
    case 'circle': {
      const c = apply(ent.cx, ent.cy); ent.cx = c.x; ent.cy = c.y;
      if (sc !== 1) ent.radius *= sc;
      break;
    }
    case 'polyline':
      ent.points = ent.points.map(p => fn(p)); break;
    case 'text': {
      const p = apply(ent.x, ent.y); ent.x = p.x; ent.y = p.y;
      if (sc !== 1) {
        ent.height *= sc;
        if (ent.boxWidth !== undefined) ent.boxWidth *= sc;
        if (ent.boxHeight !== undefined) ent.boxHeight *= sc;
      }
      if (opts.angleDelta) ent.rotation = (((ent.rotation + opts.angleDelta) % 360) + 360) % 360;
      break;
    }
    case 'dimension': {
      ent.p1 = fn(ent.p1); ent.p2 = fn(ent.p2);
      if (ent.center) ent.center = fn(ent.center);
      if (ent.arcMidPt) ent.arcMidPt = fn(ent.arcMidPt);
      if (sc !== 1) {
        ent.offset *= sc;
        if (ent.textHeight !== undefined) ent.textHeight *= sc;
        if (ent.radius !== undefined) ent.radius *= sc;
      }
      if (opts.mirrored) ent.offset = -ent.offset;
      break;
    }
    case 'image': {
      const p = apply(ent.x, ent.y);
      ent.x = p.x;
      ent.y = p.y;
      if (sc !== 1) {
        ent.width *= sc;
        ent.height *= sc;
      }
      break;
    }
  }
}

export function cloneEntity<T extends CadEntity>(ent: T, newId = true): T {
  const copy = JSON.parse(JSON.stringify(ent)) as T;
  if (newId) copy.id = ent.type + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  copy.selected = false;
  return copy;
}

/** Point-in-polygon (ray casting) */
export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const Geometry = {
  getTextFrameSize,
  textWorldCorners,
  isPointInText,
  computeArcSweep,
  dimensionGeometry,
  entityBounds,
  unionBounds,
  entityPrimitives,
  intersectSegments,
  intersectInfiniteLines,
  intersectSegmentCircle,
  intersectCircles,
  pointInBox,
  segmentIntersectsOrInsideBox,
  entityInsideBox,
  entityIntersectsOrInsideBox,
  rotatePoint,
  mirrorPoint,
  pointInPolygon,
  cloneEntity<T extends CadEntity>(ent: T, customId?: string): T {
    const copy = cloneEntity(ent, !customId);
    if (customId) copy.id = customId;
    return copy;
  },
  transformEntity<T extends CadEntity>(
    ent: T,
    fn: (p: Point2D) => Point2D,
    opts: { angleDeltaDeg?: number; invertOffset?: boolean; scale?: number } = {}
  ): T {
    const copy = cloneEntity(ent, true);
    transformEntity(copy, fn, {
      angleDelta: opts.angleDeltaDeg,
      mirrored: opts.invertOffset,
      scale: opts.scale,
    });
    return copy;
  },
};

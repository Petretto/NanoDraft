import { CadDocument } from '../model/document';
import { ViewportTransform } from '../math/transform';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { CadEntity, DimensionEntity, Point2D, SnapPoint } from '../types/cad';
import { CadGrid } from './grid';
import { SnapEngine } from './snap';

export interface RenderPreview {
  /**
   * 'line' | 'rect' | 'circle' | 'polyline' | 'ghost'
   * ghost: { entities: CadEntity[], line?: {p1, p2}, label?: string }
   */
  type: string;
  data: any;
}

export class CadRenderer {
  public crosshairSize: number = 20;
  public fullScreenCrosshair: boolean = true;
  public pickboxSize: number = 6;

  /** Canvas background (dark for screen, white for printing) */
  public backgroundColor: string = '#1e1f22';
  /** Draw the UCS axis icon */
  public drawUCS: boolean = true;
  /** Draw center crosshair marks on circles (true on screen, false on print/PDF) */
  public drawCircleCenterMarks: boolean = true;
  /** Multiplier for pixel-based sizes (line widths, arrows, min fonts). >1 for high-DPI print */
  public pixelScale: number = 1;

  private currentDoc: CadDocument | null = null;
  private static imageCache: Map<string, HTMLImageElement> = new Map();

  static getCachedImage(dataUrl: string, onLoad?: () => void): HTMLImageElement | null {
    if (!dataUrl) return null;
    let img = this.imageCache.get(dataUrl);
    if (!img) {
      img = new Image();
      img.src = dataUrl;
      if (onLoad) {
        img.onload = () => onLoad();
      }
      this.imageCache.set(dataUrl, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  render(
    ctx: CanvasRenderingContext2D,
    doc: CadDocument,
    transform: ViewportTransform,
    grid: CadGrid,
    snapEngine: SnapEngine,
    currentSnap: SnapPoint | null,
    mouseScreenPos: Point2D | null,
    preview: RenderPreview | null,
    selectionBox: { start: Point2D; end: Point2D } | null = null
  ) {
    this.currentDoc = doc;
    const width = transform.screenWidth;
    const height = transform.screenHeight;

    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // 1. Grid
    grid.render(ctx, transform, doc.unit);

    // 2. Entities (Pass 0: Underlay images, Pass 1: Hatch lines, Pass 2: Main geometry & annotations)
    const isUnderlayEntity = (e: CadEntity) =>
      e.type === 'image' && (e.isUnderlay || e.layerId === 'underlay');
    const isHatchEntity = (e: CadEntity) =>
      e.layerId === 'hatch' || e.id.startsWith('hatch_') || (e.groupId ? e.groupId.startsWith('grp_hatch_') : false);

    const orderedEntities = [
      ...doc.entities.filter(e => isUnderlayEntity(e)),
      ...doc.entities.filter(e => !isUnderlayEntity(e) && isHatchEntity(e)),
      ...doc.entities.filter(e => !isUnderlayEntity(e) && !isHatchEntity(e)),
    ];

    for (const ent of orderedEntities) {
      const layer = doc.layers.find(l => l.id === ent.layerId) || doc.layers[0];
      if (!layer.visible) continue;

      const isHatch = isHatchEntity(ent);
      ctx.save();
      const color = ent.color || layer.color;
      const lineWidth = (ent.lineWidth || layer.lineWidth) * this.pixelScale;
      const lineType = ent.lineType || layer.lineType || 'continuous';
      this.applyLineDash(ctx, lineType);

      if (ent.selected) {
        ctx.strokeStyle = '#00e5ff';
        ctx.fillStyle = '#00e5ff';
        ctx.lineWidth = isHatch ? Math.max(lineWidth, 1.2) : Math.max(lineWidth + 1.5, 2);
        ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
        ctx.shadowBlur = isHatch ? 3 : 6;
      } else {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;
      }

      this.renderEntity(ctx, ent, transform, doc.unit, color, !isHatch);
      ctx.restore();
    }

    // 3. Tool preview (rubber band / ghost)
    if (preview) {
      ctx.save();
      ctx.strokeStyle = '#ffeb3b';
      ctx.fillStyle = 'rgba(255, 235, 59, 0.1)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      this.renderPreview(ctx, preview, transform, doc.unit);
      ctx.restore();
    }

    // 4. Selection box (Window / Crossing)
    if (selectionBox) {
      ctx.save();
      const isCrossing = selectionBox.end.x < selectionBox.start.x;
      if (isCrossing) {
        ctx.fillStyle = 'rgba(76, 175, 80, 0.15)';
        ctx.strokeStyle = '#4caf50';
        ctx.setLineDash([4, 3]);
      } else {
        ctx.fillStyle = 'rgba(33, 150, 243, 0.15)';
        ctx.strokeStyle = '#2196f3';
      }
      ctx.lineWidth = 1;
      const x = Math.min(selectionBox.start.x, selectionBox.end.x);
      const y = Math.min(selectionBox.start.y, selectionBox.end.y);
      const w = Math.abs(selectionBox.end.x - selectionBox.start.x);
      const h = Math.abs(selectionBox.end.y - selectionBox.start.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    // 5. Snap marker
    if (currentSnap) snapEngine.renderSnapMarker(ctx, currentSnap, transform);

    // 6. Crosshair
    if (mouseScreenPos) this.renderCrosshair(ctx, mouseScreenPos, width, height);

    // 7. UCS icon
    if (this.drawUCS) this.renderUCSIcon(ctx, transform);
  }

  private applyLineDash(ctx: CanvasRenderingContext2D, lineType: string) {
    const k = this.pixelScale;
    if (lineType === 'dashed') ctx.setLineDash([8 * k, 5 * k]);
    else if (lineType === 'dashdot') ctx.setLineDash([12 * k, 4 * k, 2 * k, 4 * k]);
    else if (lineType === 'dotted') ctx.setLineDash([2 * k, 4 * k]);
    else ctx.setLineDash([]);
  }

  private renderEntity(
    ctx: CanvasRenderingContext2D,
    ent: CadEntity,
    transform: ViewportTransform,
    unit: string,
    baseColor: string,
    showGrips: boolean = true
  ) {
    const k = this.pixelScale;
    const grips = showGrips && !!ent.selected;
    switch (ent.type) {
      case 'point': {
        const pt = transform.worldToScreen({ x: ent.x, y: ent.y });
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pt.x - 5 * k, pt.y);
        ctx.lineTo(pt.x + 5 * k, pt.y);
        ctx.moveTo(pt.x, pt.y - 5 * k);
        ctx.lineTo(pt.x, pt.y + 5 * k);
        ctx.stroke();
        break;
      }

      case 'line': {
        const p1 = transform.worldToScreen({ x: ent.x1, y: ent.y1 });
        const p2 = transform.worldToScreen({ x: ent.x2, y: ent.y2 });
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        if (grips) {
          this.drawGrip(ctx, p1);
          this.drawGrip(ctx, p2);
          this.drawGrip(ctx, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
        }
        break;
      }

      case 'polyline': {
        if (ent.points.length < 2) return;
        const pts = ent.points.map(p => transform.worldToScreen(p));
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (ent.closed) ctx.closePath();
        ctx.stroke();
        if (grips) for (const p of pts) this.drawGrip(ctx, p);
        break;
      }

      case 'circle': {
        const center = transform.worldToScreen({ x: ent.cx, y: ent.cy });
        const radiusPx = transform.worldDistToScreen(ent.radius);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();

        // Center mark (solid) — hidden on printouts when drawCircleCenterMarks is false
        if (this.drawCircleCenterMarks) {
          ctx.save();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(center.x - 4 * k, center.y);
          ctx.lineTo(center.x + 4 * k, center.y);
          ctx.moveTo(center.x, center.y - 4 * k);
          ctx.lineTo(center.x, center.y + 4 * k);
          ctx.stroke();
          ctx.restore();
        }

        if (grips) {
          this.drawGrip(ctx, center);
          this.drawGrip(ctx, { x: center.x + radiusPx, y: center.y });
          this.drawGrip(ctx, { x: center.x - radiusPx, y: center.y });
          this.drawGrip(ctx, { x: center.x, y: center.y + radiusPx });
          this.drawGrip(ctx, { x: center.x, y: center.y - radiusPx });
        }
        break;
      }

      case 'text': {
        const pt = transform.worldToScreen({ x: ent.x, y: ent.y });
        const heightPx = Math.max(transform.worldDistToScreen(ent.height), 8 * k);
        const minWorldH = transform.screenDistToWorld(8 * k);
        const { w, h } = Geometry.getTextFrameSize(ent, minWorldH);
        const wPx = Math.max(transform.worldDistToScreen(w), 12 * k);
        const hPx = Math.max(transform.worldDistToScreen(h), heightPx);

        ctx.font = `${Math.round(heightPx)}px "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = ent.align;
        ctx.textBaseline = ent.baseline;

        // Compute text anchor inside frame [0, wPx] x [-hPx, 0]
        let tx = 0;
        if (ent.align === 'center') tx = wPx / 2;
        else if (ent.align === 'right') tx = wPx;

        let ty = 0; // baseline === 'bottom' sits at bottom of frame (y = 0)
        if (ent.baseline === 'middle') ty = -hPx / 2;
        else if (ent.baseline === 'top') ty = -hPx;

        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate((-ent.rotation * Math.PI) / 180);
        ctx.fillText(ent.text, tx, ty);

        if (grips) {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 1;
          ctx.strokeRect(0, -hPx, wPx, hPx);

          // 4 Corner Grips (BL, BR, TR, TL) + 1 Center Move Grip
          this.drawGrip(ctx, { x: 0, y: 0 });           // Bottom-Left (BL)
          this.drawGrip(ctx, { x: wPx, y: 0 });         // Bottom-Right (BR)
          this.drawGrip(ctx, { x: wPx, y: -hPx });      // Top-Right (TR)
          this.drawGrip(ctx, { x: 0, y: -hPx });        // Top-Left (TL)
          this.drawGrip(ctx, { x: wPx / 2, y: -hPx / 2 }); // Center Move Grip
        }
        ctx.restore();
        break;
      }

      case 'dimension': {
        if (ent.dimType === 'radius' || ent.dimType === 'diameter') {
          this.renderRadialDimension(ctx, ent, transform, unit, baseColor, grips);
        } else if (ent.dimType === 'angular') {
          this.renderAngularDimension(ctx, ent, transform, unit, baseColor, grips);
        } else if (ent.dimType === 'arc-length') {
          this.renderArcLengthDimension(ctx, ent, transform, unit, baseColor, grips);
        } else if (ent.dimType === 'leader') {
          this.renderLeaderDimension(ctx, ent, transform, unit, baseColor, grips);
        } else {
          this.renderLinearDimension(ctx, ent, transform, unit, baseColor, grips);
        }
        break;
      }

      case 'image': {
        const tlScreen = transform.worldToScreen({ x: ent.x, y: ent.y + ent.height });
        const wPx = transform.worldDistToScreen(ent.width);
        const hPx = transform.worldDistToScreen(ent.height);
        const img = CadRenderer.getCachedImage(ent.dataUrl, () => {
          this.currentDoc?.notifyChange();
        });
        if (img) {
          ctx.save();
          if (ent.opacity !== undefined && ent.opacity < 1) {
            ctx.globalAlpha = Math.max(0.05, Math.min(1, ent.opacity));
          }
          ctx.drawImage(img, tlScreen.x, tlScreen.y, wPx, hPx);
          ctx.restore();
        }
        if (grips) {
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = '#00e5ff';
          ctx.strokeRect(tlScreen.x, tlScreen.y, wPx, hPx);
          ctx.restore();
          this.drawGrip(ctx, tlScreen);
          this.drawGrip(ctx, { x: tlScreen.x + wPx, y: tlScreen.y + hPx });
        }
        break;
      }
    }
  }

  private formatNumber(v: number): string {
    return VectorMath.round(v, 2).toString();
  }

  private renderLinearDimension(
    ctx: CanvasRenderingContext2D,
    dim: DimensionEntity,
    transform: ViewportTransform,
    unit: string,
    baseColor: string,
    grips: boolean
  ) {
    const k = this.pixelScale;
    const s1 = transform.worldToScreen(dim.p1);
    const s2 = transform.worldToScreen(dim.p2);
    const dist = VectorMath.distance(dim.p1, dim.p2);
    const text = dim.customText || `${this.formatNumber(dist)} ${unit}`;

    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    // Normal in screen space (screen Y is flipped, so this matches world normal (-dy, dx))
    const nx = dy / len;
    const ny = -dx / len;
    const offsetPx = transform.worldDistToScreen(dim.offset ?? 15);

    const d1 = { x: s1.x + nx * offsetPx, y: s1.y + ny * offsetPx };
    const d2 = { x: s2.x + nx * offsetPx, y: s2.y + ny * offsetPx };
    const sign = offsetPx >= 0 ? 1 : -1;

    ctx.save();
    ctx.setLineDash([]);
    const dimColor = dim.selected ? '#00e5ff' : baseColor;
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = (dim.selected ? 2 : 1) * k;

    // Extension lines (overshoot 3px beyond dimension line)
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(d1.x + nx * 3 * k * sign, d1.y + ny * 3 * k * sign);
    ctx.moveTo(s2.x, s2.y);
    ctx.lineTo(d2.x + nx * 3 * k * sign, d2.y + ny * 3 * k * sign);
    ctx.stroke();

    // Dimension line + arrows
    ctx.beginPath();
    ctx.moveTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.stroke();
    this.drawArrowhead(ctx, d2, d1);
    this.drawArrowhead(ctx, d1, d2);

    const midX = (d1.x + d2.x) / 2;
    const midY = (d1.y + d2.y) / 2;
    this.drawDimText(ctx, text, midX, midY, Math.atan2(d2.y - d1.y, d2.x - d1.x), dim, transform, dimColor, unit);

    if (grips) {
      this.drawGrip(ctx, s1);
      this.drawGrip(ctx, s2);
      this.drawGrip(ctx, { x: midX, y: midY });
    }
    ctx.restore();
  }

  /** Radius (R) / Diameter (Ø) dimension. center = circle center, p2 = leader/text point. */
  private renderRadialDimension(
    ctx: CanvasRenderingContext2D,
    dim: DimensionEntity,
    transform: ViewportTransform,
    unit: string,
    baseColor: string,
    grips: boolean
  ) {
    const k = this.pixelScale;
    // Associative: read live geometry of attached circle if it still exists
    let center = dim.center || dim.p1;
    let radius = dim.radius || VectorMath.distance(center, dim.p2);
    const attachedId = dim.attachedEntityIds?.[0];
    if (attachedId && this.currentDoc) {
      const c = this.currentDoc.getEntity(attachedId);
      if (c && c.type === 'circle') {
        center = { x: c.cx, y: c.cy };
        radius = c.radius;
      }
    }
    if (radius <= 0) return;

    const dx = dim.p2.x - center.x;
    const dy = dim.p2.y - center.y;
    const dirAngle = (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) ? Math.PI / 4 : Math.atan2(dy, dx);
    const dir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
    const edge1 = { x: center.x + dir.x * radius, y: center.y + dir.y * radius };
    const edge2 = { x: center.x - dir.x * radius, y: center.y - dir.y * radius };

    const distToP2 = VectorMath.distance(center, dim.p2);
    const leaderEnd = distToP2 > radius ? dim.p2 : edge1;
    const start = dim.dimType === 'diameter' ? edge2 : center;

    const sCenter = transform.worldToScreen(center);
    const sStart = transform.worldToScreen(start);
    const sEdge1 = transform.worldToScreen(edge1);
    const sEnd = transform.worldToScreen(leaderEnd);
    const sTextPt = transform.worldToScreen(
      distToP2 > radius * 0.25
        ? dim.p2
        : { x: center.x + dir.x * (radius * 0.55), y: center.y + dir.y * (radius * 0.55) }
    );

    const value = dim.dimType === 'diameter' ? radius * 2 : radius;
    const prefix = dim.dimType === 'diameter' ? 'Ø' : 'R';
    const text = dim.customText || `${prefix}${this.formatNumber(value)} ${unit}`;

    ctx.save();
    ctx.setLineDash([]);
    const dimColor = dim.selected ? '#00e5ff' : baseColor;
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = (dim.selected ? 2 : 1) * k;

    // Small center cross mark (hidden on printouts when drawCircleCenterMarks is false)
    if (this.drawCircleCenterMarks) {
      ctx.beginPath();
      ctx.moveTo(sCenter.x - 4 * k, sCenter.y);
      ctx.lineTo(sCenter.x + 4 * k, sCenter.y);
      ctx.moveTo(sCenter.x, sCenter.y - 4 * k);
      ctx.lineTo(sCenter.x, sCenter.y + 4 * k);
      ctx.stroke();
    }

    // Main dimension / leader line & arrowheads
    const radiusPx = transform.worldDistToScreen(radius);
    if (dim.dimType === 'diameter') {
      if (distToP2 > radius && radiusPx < 18 * k && radiusPx > 0.5) {
        // Small circle with external text: extend line outside on BOTH sides and point both arrows INWARD toward center
        const ux = (sStart.x - sCenter.x) / radiusPx;
        const uy = (sStart.y - sCenter.y) / radiusPx;
        const sStartOuter = { x: sStart.x + ux * 16 * k, y: sStart.y + uy * 16 * k };

        ctx.beginPath();
        ctx.moveTo(sStartOuter.x, sStartOuter.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.stroke();

        this.drawArrowhead(ctx, sEnd, sEdge1);
        this.drawArrowhead(ctx, sStartOuter, sStart);
      } else {
        // Standard circle: both arrows are INSIDE the circle pointing from center outward to the rim edges
        ctx.beginPath();
        ctx.moveTo(sStart.x, sStart.y);
        ctx.lineTo(sEnd.x, sEnd.y);
        ctx.stroke();

        this.drawArrowhead(ctx, sCenter, sEdge1);
        this.drawArrowhead(ctx, sCenter, sStart);
      }
    } else {
      // Radius dimension (R)
      ctx.beginPath();
      ctx.moveTo(sStart.x, sStart.y);
      ctx.lineTo(sEnd.x, sEnd.y);
      ctx.stroke();

      if (distToP2 > radius && radiusPx < 18 * k) {
        this.drawArrowhead(ctx, sEnd, sEdge1);
      } else {
        this.drawArrowhead(ctx, sCenter, sEdge1);
      }
    }

    const screenAngle = Math.atan2(sEdge1.y - sCenter.y, sEdge1.x - sCenter.x);
    this.drawDimText(ctx, text, sTextPt.x, sTextPt.y, screenAngle, dim, transform, dimColor, unit);

    if (grips) {
      this.drawGrip(ctx, sTextPt);
      this.drawGrip(ctx, sEdge1);
    }
    ctx.restore();
  }

  /** Angular dimension (°) between two rays (center -> p1 and center -> p2) at radius = dim.radius */
  private renderAngularDimension(
    ctx: CanvasRenderingContext2D,
    dim: DimensionEntity,
    transform: ViewportTransform,
    unit: string,
    baseColor: string,
    grips: boolean
  ) {
    const k = this.pixelScale;
    const center = dim.center || { x: 0, y: 0 };
    const arcRadius = dim.radius || Math.max(Math.abs(dim.offset), 1);
    if (arcRadius <= 0) return;

    const ang1 = Math.atan2(dim.p1.y - center.y, dim.p1.x - center.x);
    const ang2 = Math.atan2(dim.p2.y - center.y, dim.p2.x - center.x);
    let diff = ang2 - ang1;
    while (diff <= -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const angleDeg = Math.abs((diff * 180) / Math.PI);
    const text = dim.customText || `${VectorMath.round(angleDeg, 1)}°`;

    const steps = 28;
    const screenArcPts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = ang1 + (diff * i) / steps;
      const wp = { x: center.x + Math.cos(a) * arcRadius, y: center.y + Math.sin(a) * arcRadius };
      screenArcPts.push(transform.worldToScreen(wp));
    }

    const sP1 = transform.worldToScreen(dim.p1);
    const sP2 = transform.worldToScreen(dim.p2);
    const sArcStart = screenArcPts[0];
    const sArcEnd = screenArcPts[screenArcPts.length - 1];

    ctx.save();
    ctx.setLineDash([]);
    const dimColor = dim.selected ? '#00e5ff' : baseColor;
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = (dim.selected ? 2 : 1) * k;

    // Extension lines from ray points to arc endpoints
    ctx.beginPath();
    ctx.moveTo(sP1.x, sP1.y);
    ctx.lineTo(sArcStart.x, sArcStart.y);
    ctx.moveTo(sP2.x, sP2.y);
    ctx.lineTo(sArcEnd.x, sArcEnd.y);
    ctx.stroke();

    // Dimension arc
    ctx.beginPath();
    ctx.moveTo(screenArcPts[0].x, screenArcPts[0].y);
    for (let i = 1; i < screenArcPts.length; i++) {
      ctx.lineTo(screenArcPts[i].x, screenArcPts[i].y);
    }
    ctx.stroke();

    // Arrowheads at both ends of the arc
    if (screenArcPts.length >= 3) {
      this.drawArrowhead(ctx, screenArcPts[2], screenArcPts[0]);
      this.drawArrowhead(ctx, screenArcPts[screenArcPts.length - 3], screenArcPts[screenArcPts.length - 1]);
    }

    // Text at mid-arc
    const midIdx = Math.floor(screenArcPts.length / 2);
    const sMid = screenArcPts[midIdx];
    const tangentAngle = Math.atan2(
      screenArcPts[Math.min(midIdx + 1, steps)].y - screenArcPts[Math.max(midIdx - 1, 0)].y,
      screenArcPts[Math.min(midIdx + 1, steps)].x - screenArcPts[Math.max(midIdx - 1, 0)].x
    );
    this.drawDimText(ctx, text, sMid.x, sMid.y, tangentAngle, dim, transform, dimColor, unit);

    if (grips) {
      this.drawGrip(ctx, sArcStart);
      this.drawGrip(ctx, sArcEnd);
      this.drawGrip(ctx, sMid);
    }
    ctx.restore();
  }

  /** Arc Length dimension (⌒) along a circular arc (center, p1, p2, arcMidPt) at concentric radius = dim.radius */
  private renderArcLengthDimension(
    ctx: CanvasRenderingContext2D,
    dim: DimensionEntity,
    transform: ViewportTransform,
    unit: string,
    baseColor: string,
    grips: boolean
  ) {
    const k = this.pixelScale;
    const center = dim.center || { x: 0, y: 0 };
    const { startAngle, sweep, sourceRadius, arcLength } = Geometry.computeArcSweep(
      center,
      dim.p1,
      dim.p2,
      dim.arcMidPt
    );
    const dimArcRadius = dim.radius || Math.max(sourceRadius + (dim.offset || 10), 1);
    if (dimArcRadius <= 0 || Math.abs(sweep) < 1e-6) return;

    const text = dim.customText || `⌒ ${this.formatNumber(arcLength)} ${unit}`;

    const steps = 32;
    const screenArcPts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = startAngle + (sweep * i) / steps;
      const wp = { x: center.x + Math.cos(a) * dimArcRadius, y: center.y + Math.sin(a) * dimArcRadius };
      screenArcPts.push(transform.worldToScreen(wp));
    }

    const sP1 = transform.worldToScreen(dim.p1);
    const sP2 = transform.worldToScreen(dim.p2);
    const sArcStart = screenArcPts[0];
    const sArcEnd = screenArcPts[screenArcPts.length - 1];

    ctx.save();
    ctx.setLineDash([]);
    const dimColor = dim.selected ? '#00e5ff' : baseColor;
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = (dim.selected ? 2 : 1) * k;

    // Radial extension lines from arc endpoints p1, p2 to dimension arc endpoints
    ctx.beginPath();
    ctx.moveTo(sP1.x, sP1.y);
    ctx.lineTo(sArcStart.x, sArcStart.y);
    ctx.moveTo(sP2.x, sP2.y);
    ctx.lineTo(sArcEnd.x, sArcEnd.y);
    ctx.stroke();

    // Concentric dimension arc
    ctx.beginPath();
    ctx.moveTo(screenArcPts[0].x, screenArcPts[0].y);
    for (let i = 1; i < screenArcPts.length; i++) {
      ctx.lineTo(screenArcPts[i].x, screenArcPts[i].y);
    }
    ctx.stroke();

    // Arrowheads at both ends of the dimension arc
    if (screenArcPts.length >= 3) {
      this.drawArrowhead(ctx, screenArcPts[2], screenArcPts[0]);
      this.drawArrowhead(ctx, screenArcPts[screenArcPts.length - 3], screenArcPts[screenArcPts.length - 1]);
    }

    // Arc length text at mid-arc
    const midIdx = Math.floor(screenArcPts.length / 2);
    const sMid = screenArcPts[midIdx];
    const tangentAngle = Math.atan2(
      screenArcPts[Math.min(midIdx + 1, steps)].y - screenArcPts[Math.max(midIdx - 1, 0)].y,
      screenArcPts[Math.min(midIdx + 1, steps)].x - screenArcPts[Math.max(midIdx - 1, 0)].x
    );
    this.drawDimText(ctx, text, sMid.x, sMid.y, tangentAngle, dim, transform, dimColor, unit);

    if (grips) {
      this.drawGrip(ctx, sP1);
      this.drawGrip(ctx, sP2);
      this.drawGrip(ctx, sMid);
    }
    ctx.restore();
  }

  /** Leader / Callout arrow with landing shelf (p1 = arrow tip on detail, p2 = elbow, horizontal shelf with text) */
  private renderLeaderDimension(
    ctx: CanvasRenderingContext2D,
    dim: DimensionEntity,
    transform: ViewportTransform,
    unit: string,
    baseColor: string,
    grips: boolean
  ) {
    const k = this.pixelScale;
    const sP1 = transform.worldToScreen(dim.p1);
    const sP2 = transform.worldToScreen(dim.p2);
    const text = dim.customText || 'Odnośnik';

    const defaultH = unit === 'm' ? 0.28 : unit === 'cm' ? 0.35 : unit === 'in' ? 0.14 : 3.5;
    const worldTextH = dim.textHeight && dim.textHeight > 0 ? dim.textHeight : defaultH;
    const fontPx = Math.max(transform.worldDistToScreen(worldTextH), 9 * k);

    ctx.save();
    ctx.setLineDash([]);
    const dimColor = dim.selected ? '#00e5ff' : baseColor;
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = (dim.selected ? 2 : 1.2) * k;
    ctx.font = `600 ${fontPx}px 'JetBrains Mono', monospace`;

    const measuredTextW = ctx.measureText(text).width;
    const dirSign =
      dim.offset !== undefined && dim.offset !== 0
        ? Math.sign(dim.offset)
        : sP2.x >= sP1.x
        ? 1
        : -1;
    const minShelfPx = Math.max(measuredTextW + 8 * k, 24 * k);
    const sP3 = { x: sP2.x + dirSign * minShelfPx, y: sP2.y };

    // Leader line: sP1 -> sP2 -> sP3
    ctx.beginPath();
    ctx.moveTo(sP1.x, sP1.y);
    ctx.lineTo(sP2.x, sP2.y);
    ctx.lineTo(sP3.x, sP3.y);
    ctx.stroke();

    // Arrowhead at sP1 pointing from sP2 toward sP1
    this.drawArrowhead(ctx, sP2, sP1);

    // Text sitting above the horizontal landing shelf
    ctx.textAlign = dirSign >= 0 ? 'left' : 'right';
    ctx.textBaseline = 'bottom';
    const textX = dirSign >= 0 ? sP2.x + 4 * k : sP2.x - 4 * k;
    const textY = sP2.y - 3 * k;
    ctx.fillText(text, textX, textY);

    if (grips) {
      this.drawGrip(ctx, sP1);
      this.drawGrip(ctx, sP2);
      this.drawGrip(ctx, sP3);
    }
    ctx.restore();
  }

  private drawDimText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    angle: number,
    dim: DimensionEntity,
    transform: ViewportTransform,
    color: string,
    unit: string = 'mm'
  ) {
    const k = this.pixelScale;
    let a = angle;
    if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI; // keep text readable

    const defaultH = unit === 'm' ? 0.28 : unit === 'cm' ? 0.35 : unit === 'in' ? 0.14 : 3.5;
    const fontHeightPx = Math.max(transform.worldDistToScreen(dim.textHeight || defaultH), 10 * k);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.font = `${Math.round(fontHeightPx)}px "Segoe UI", Roboto, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    ctx.fillText(text, 0, -3 * k);
    ctx.restore();
  }

  private drawArrowhead(ctx: CanvasRenderingContext2D, from: Point2D, to: Point2D) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowLen = 9 * this.pixelScale;
    const arrowAngle = Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - arrowLen * Math.cos(angle - arrowAngle), to.y - arrowLen * Math.sin(angle - arrowAngle));
    ctx.lineTo(to.x - arrowLen * Math.cos(angle + arrowAngle), to.y - arrowLen * Math.sin(angle + arrowAngle));
    ctx.closePath();
    ctx.fill();
  }

  private drawGrip(ctx: CanvasRenderingContext2D, screenPt: Point2D) {
    const s = 3.5;
    ctx.save();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(screenPt.x - s, screenPt.y - s, s * 2, s * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(screenPt.x - s, screenPt.y - s, s * 2, s * 2);
    ctx.restore();
  }

  private renderPreview(ctx: CanvasRenderingContext2D, preview: RenderPreview, transform: ViewportTransform, unit: string) {
    if (preview.type === 'line') {
      const p1 = transform.worldToScreen(preview.data.p1);
      const p2 = transform.worldToScreen(preview.data.p2);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      const dist = VectorMath.distance(preview.data.p1, preview.data.p2);
      const angle = VectorMath.angleDeg(preview.data.p1, preview.data.p2);
      this.drawLiveDimensionBadge(ctx, p1, p2, preview.data.label || `${VectorMath.round(dist, 2)} ${unit}  ∠${VectorMath.round(angle, 1)}°`);
    } else if (preview.type === 'polyline') {
      const pts: Point2D[] = preview.data.points.map((p: Point2D) => transform.worldToScreen(p));
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        const a = preview.data.points[pts.length - 2];
        const b = preview.data.points[pts.length - 1];
        const dist = VectorMath.distance(a, b);
        const angle = VectorMath.angleDeg(a, b);
        this.drawLiveDimensionBadge(ctx, pts[pts.length - 2], pts[pts.length - 1], `${VectorMath.round(dist, 2)} ${unit}  ∠${VectorMath.round(angle, 1)}°`);
      }
    } else if (preview.type === 'rect') {
      const p1 = transform.worldToScreen(preview.data.p1);
      const p2 = transform.worldToScreen(preview.data.p2);
      const x = Math.min(p1.x, p2.x);
      const y = Math.min(p1.y, p2.y);
      const w = Math.abs(p2.x - p1.x);
      const h = Math.abs(p2.y - p1.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      const worldW = Math.abs(preview.data.p2.x - preview.data.p1.x);
      const worldH = Math.abs(preview.data.p2.y - preview.data.p1.y);
      this.drawLiveDimensionBadge(ctx, p1, p2, `${VectorMath.round(worldW, 2)} × ${VectorMath.round(worldH, 2)} ${unit}`);
    } else if (preview.type === 'circle') {
      const center = transform.worldToScreen(preview.data.center);
      const radiusPx = transform.worldDistToScreen(preview.data.radius);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      const curr = transform.worldToScreen(preview.data.current);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(curr.x, curr.y);
      ctx.stroke();
      this.drawLiveDimensionBadge(ctx, center, curr, `R: ${VectorMath.round(preview.data.radius, 2)} ${unit}`);
    } else if (preview.type === 'ghost') {
      // Semi-transparent copies of entities being transformed
      ctx.save();
      ctx.globalAlpha = 0.75;
      for (const ent of preview.data.entities as CadEntity[]) {
        ctx.save();
        ctx.strokeStyle = '#ffeb3b';
        ctx.fillStyle = '#ffeb3b';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 3]);
        this.renderEntity(ctx, ent, transform, unit, '#ffeb3b', false);
        ctx.restore();
      }
      ctx.restore();
      if (preview.data.line) {
        const p1 = transform.worldToScreen(preview.data.line.p1);
        const p2 = transform.worldToScreen(preview.data.line.p2);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        const dist = VectorMath.distance(preview.data.line.p1, preview.data.line.p2);
        const angle = VectorMath.angleDeg(preview.data.line.p1, preview.data.line.p2);
        this.drawLiveDimensionBadge(ctx, p1, p2, preview.data.label || `${VectorMath.round(dist, 2)} ${unit}  ∠${VectorMath.round(angle, 1)}°`);
      }
    }
  }

  private drawLiveDimensionBadge(ctx: CanvasRenderingContext2D, p1: Point2D, p2: Point2D, label: string) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2 - 12;
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.font = '11px monospace';
    const m = ctx.measureText(label);
    ctx.fillStyle = 'rgba(25, 25, 25, 0.85)';
    ctx.fillRect(midX - m.width / 2 - 4, midY - 10, m.width + 8, 14);
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 1;
    ctx.strokeRect(midX - m.width / 2 - 4, midY - 10, m.width + 8, 14);
    ctx.fillStyle = '#ffeb3b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY - 3);
    ctx.restore();
  }

  private renderCrosshair(ctx: CanvasRenderingContext2D, pos: Point2D, screenWidth: number, screenHeight: number) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1;
    const x = Math.round(pos.x) + 0.5;
    const y = Math.round(pos.y) + 0.5;
    ctx.beginPath();
    if (this.fullScreenCrosshair) {
      ctx.moveTo(0, y);
      ctx.lineTo(screenWidth, y);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, screenHeight);
    } else {
      ctx.moveTo(x - this.crosshairSize, y);
      ctx.lineTo(x + this.crosshairSize, y);
      ctx.moveTo(x, y - this.crosshairSize);
      ctx.lineTo(x, y + this.crosshairSize);
    }
    ctx.stroke();
    const s = this.pickboxSize;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    ctx.restore();
  }

  private renderUCSIcon(ctx: CanvasRenderingContext2D, transform: ViewportTransform) {
    const origin = transform.worldToScreen({ x: 0, y: 0 });
    let pos: Point2D;
    if (origin.x >= 30 && origin.x <= transform.screenWidth - 30 && origin.y >= 30 && origin.y <= transform.screenHeight - 30) {
      pos = origin;
    } else {
      pos = { x: 35, y: transform.screenHeight - 35 };
    }
    const armLen = 22;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ef5350';
    ctx.fillStyle = '#ef5350';
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + armLen, pos.y);
    ctx.stroke();
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('X', pos.x + armLen + 4, pos.y + 3);
    ctx.strokeStyle = '#66bb6a';
    ctx.fillStyle = '#66bb6a';
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x, pos.y - armLen);
    ctx.stroke();
    ctx.fillText('Y', pos.x - 3, pos.y - armLen - 4);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.strokeRect(pos.x - 2, pos.y - 2, 4, 4);
    ctx.restore();
  }
}

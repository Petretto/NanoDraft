import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity, LineEntity, CircleEntity, PolylineEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class OffsetTool extends BaseTool {
  readonly id = 'offset';
  readonly name = 'Odsunięcie';
  readonly shortcut = 'F';

  private sourceEntity: CadEntity | null = null;
  private offsetDistance: number = 10;
  private currentPt: Point2D | null = null;

  activate(context: ToolContext) {
    this.sourceEntity = null;
    this.currentPt = null;
    context.setHint(`ODSUNIĘCIE (Offset): Kliknij linię, okrąg lub polilinię do odsunięcia (domyślny dystans: ${this.offsetDistance} ${context.doc.unit})`);
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.sourceEntity = null;
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    if (!this.sourceEntity) {
      const hit = this.findEntityAt(worldPt, context);
      if (!hit) {
        context.setHint('ODSUNIĘCIE: Najedź i kliknij na linię, okrąg lub polilinię!');
        return;
      }
      this.sourceEntity = hit;
      this.currentPt = { ...worldPt };
      context.setHint('ODSUNIĘCIE: Wpisz dystans odsunięcia i wskaż stronę kliknięciem myszy');

      const screenPt = context.transform.worldToScreen(worldPt);
      context.hud.showSingleField(
        screenPt,
        `Dystans [${context.doc.unit}]:`,
        this.offsetDistance,
        (dist) => {
          if (dist > 0) this.offsetDistance = dist;
          if (this.sourceEntity && this.currentPt) {
            this.commitOffset(this.sourceEntity, this.currentPt, this.offsetDistance, context);
          }
        },
        () => this.cancel(context)
      );
    } else {
      // Read live input from HUD if user typed a number without pressing Enter yet
      this.commitOffset(this.sourceEntity, worldPt, this.offsetDistance, context);
    }
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    this.currentPt = { ...worldPt };
    if (this.sourceEntity) {
      const screenPt = context.transform.worldToScreen(worldPt);
      context.hud.updatePosition(screenPt);
    }
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

  private findEntityAt(pt: Point2D, context: ToolContext): CadEntity | null {
    const tol = 8 / context.transform.zoom;
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;

      if (ent.type === 'line') {
        const dist = VectorMath.distanceToSegment(pt, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 });
        if (dist <= tol) return ent;
      } else if (ent.type === 'circle') {
        const d = Math.abs(VectorMath.distance(pt, { x: ent.cx, y: ent.cy }) - ent.radius);
        if (d <= tol) return ent;
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        const count = ent.closed ? pts.length : pts.length - 1;
        for (let j = 0; j < count; j++) {
          const p1 = pts[j];
          const p2 = pts[(j + 1) % pts.length];
          if (VectorMath.distanceToSegment(pt, p1, p2) <= tol) return ent;
        }
      }
    }
    return null;
  }

  private buildOffsetEntity(ent: CadEntity, sidePt: Point2D, dist: number): CadEntity | null {
    if (dist <= 0) return null;
    const newId = ent.type + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    if (ent.type === 'line') {
      const dx = ent.x2 - ent.x1;
      const dy = ent.y2 - ent.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      const nx = -dy / len;
      const ny = dx / len;
      const side = (sidePt.x - ent.x1) * nx + (sidePt.y - ent.y1) * ny >= 0 ? 1 : -1;
      const ox = nx * dist * side;
      const oy = ny * dist * side;
      const res: LineEntity = {
        ...ent,
        id: newId,
        x1: ent.x1 + ox,
        y1: ent.y1 + oy,
        x2: ent.x2 + ox,
        y2: ent.y2 + oy,
        selected: false,
      };
      return res;
    }

    if (ent.type === 'circle') {
      const dCenter = VectorMath.distance(sidePt, { x: ent.cx, y: ent.cy });
      const sign = dCenter >= ent.radius ? 1 : -1;
      const newRadius = ent.radius + sign * dist;
      if (newRadius <= 1e-4) return null;
      const res: CircleEntity = {
        ...ent,
        id: newId,
        radius: newRadius,
        selected: false,
      };
      return res;
    }

    if (ent.type === 'polyline' && ent.points.length >= 2) {
      // Computecentroid to decide inward vs outward offset
      const cx = ent.points.reduce((s, p) => s + p.x, 0) / ent.points.length;
      const cy = ent.points.reduce((s, p) => s + p.y, 0) / ent.points.length;
      const avgDist = ent.points.reduce((s, p) => s + VectorMath.distance(p, { x: cx, y: cy }), 0) / ent.points.length;
      const clickDist = VectorMath.distance(sidePt, { x: cx, y: cy });
      const outward = clickDist >= avgDist ? 1 : -1;

      const newPts = ent.points.map((p) => {
        const vx = p.x - cx;
        const vy = p.y - cy;
        const vlen = Math.hypot(vx, vy) || 1;
        // For axis-aligned rectangles or polygons, offset each edge normal cleanly
        return {
          x: p.x + Math.sign(vx || 1) * (Math.abs(vx) > 1e-4 ? dist * outward : (vx / vlen) * dist * outward),
          y: p.y + Math.sign(vy || 1) * (Math.abs(vy) > 1e-4 ? dist * outward : (vy / vlen) * dist * outward),
        };
      });

      const res: PolylineEntity = {
        ...ent,
        id: newId,
        points: newPts,
        selected: false,
      };
      return res;
    }

    return null;
  }

  private commitOffset(ent: CadEntity, sidePt: Point2D, dist: number, context: ToolContext) {
    const offsetEnt = this.buildOffsetEntity(ent, sidePt, dist);
    if (!offsetEnt) {
      context.setHint('ODSUNIĘCIE: Nie można utworzyć odsunięcia (zbyt mały promień lub dystans)');
      return;
    }

    const cmd: Command = {
      description: `Odsunięcie o ${VectorMath.round(dist)} ${context.doc.unit}`,
      execute: () => context.doc.addEntity(offsetEnt),
      undo: () => context.doc.removeEntity(offsetEnt.id),
    };
    context.history.execute(cmd);

    this.sourceEntity = null;
    context.hud.hide();
    context.setHint(`ODSUNIĘCIE: Utworzono obiekt. Kliknij kolejny obiekt do odsunięcia (dystans: ${this.offsetDistance} ${context.doc.unit})`);
    context.requestRender();
  }

  getPreview(): RenderPreview | null {
    if (this.sourceEntity && this.currentPt) {
      const ghost = this.buildOffsetEntity(this.sourceEntity, this.currentPt, this.offsetDistance);
      if (ghost) {
        return {
          type: 'ghost',
          data: { entities: [ghost] },
        };
      }
    }
    return null;
  }
}

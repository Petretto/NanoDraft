import { BaseTool, ToolContext } from './base-tool';
import {
  Point2D,
  SnapPoint,
  CadEntity,
  LineEntity,
  CircleEntity,
  PolylineEntity,
  PointEntity,
  TextEntity,
  DimensionEntity,
} from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { Command } from '../model/history';

interface ActiveGrip {
  entityId: string;
  gripType:
    | 'line-p1'
    | 'line-p2'
    | 'line-mid'
    | 'circle-radius'
    | 'circle-center'
    | 'poly-vertex'
    | 'point'
    | 'text-bl'
    | 'text-br'
    | 'text-tr'
    | 'text-tl'
    | 'text-center'
    | 'dim-offset'
    | 'dim-p1'
    | 'dim-p2';
  vertexIndex?: number;
  originalEntity: CadEntity;
}

export class SelectTool extends BaseTool {
  readonly id = 'select';
  readonly name = 'Zaznacz';
  readonly shortcut = 'S';

  private boxStart: Point2D | null = null;
  private boxEnd: Point2D | null = null;
  private isDragging: boolean = false;
  private isTwoClickBox: boolean = false;
  private pendingClickEntity: CadEntity | null = null;
  private activeGrip: ActiveGrip | null = null;

  activate(context: ToolContext) {
    context.setHint(
      'ZAZNACZ: Kliknij obiekt | Przeciągnij L→P (Okno: tylko w całości wewnątrz) lub P→L (Przecięcie: wszystko co dotknie)'
    );
  }

  deactivate(_context: ToolContext) {
    this.boxStart = null;
    this.boxEnd = null;
    this.isDragging = false;
    this.isTwoClickBox = false;
    this.pendingClickEntity = null;
    this.activeGrip = null;
  }

  cancel(context: ToolContext) {
    this.boxStart = null;
    this.boxEnd = null;
    this.isDragging = false;
    this.isTwoClickBox = false;
    this.pendingClickEntity = null;
    this.activeGrip = null;
    context.requestRender();
  }

  getSelectionBox(): { start: Point2D; end: Point2D } | null {
    if ((this.isDragging || this.isTwoClickBox) && this.boxStart && this.boxEnd) {
      const dist = Math.hypot(this.boxEnd.x - this.boxStart.x, this.boxEnd.y - this.boxStart.y);
      if (dist > 4) {
        return { start: this.boxStart, end: this.boxEnd };
      }
    }
    return null;
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    const screenPt = context.getMouseScreen() || context.transform.worldToScreen(worldPt);

    // If user is in 2-click selection box mode (clicked empty space earlier and moved mouse), second click finishes box
    if (this.isTwoClickBox && this.boxStart) {
      this.boxEnd = { ...screenPt };
      this.finishSelectionBox(e.shiftKey, context);
      return;
    }

    // 1. Check if clicked directly on an active GRIP of a selected entity
    const grip = this.findGripAt(worldPt, context);
    if (grip) {
      this.activeGrip = grip;
      context.setHint('ROZCIĄGNIJ UCHWYT: Przesuń mysz i kliknij, aby zatwierdzić nową pozycję (Shift/F8: Ortho)');
      return;
    }

    // 2. Check if clicked on an entity
    const clickedEntity = this.findEntityAt(worldPt, context);
    this.pendingClickEntity = clickedEntity;
    this.boxStart = { ...screenPt };
    this.boxEnd = { ...screenPt };
    this.isDragging = true;
    this.isTwoClickBox = false;

    context.requestRender();
  }

  onMouseMove(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    // Handling Grip Dragging
    if (this.activeGrip) {
      const pt = snapPt ? snapPt.point : worldPt;
      this.applyGripMove(this.activeGrip, pt, e, context);
      context.requestRender();
      return;
    }

    // Handling Selection Box Dragging (either held mouse button OR 2-click box)
    if ((this.isDragging || this.isTwoClickBox) && this.boxStart) {
      const screenPt = context.getMouseScreen() || context.transform.worldToScreen(worldPt);
      this.boxEnd = { ...screenPt };
      const dist = Math.hypot(this.boxEnd.x - this.boxStart.x, this.boxEnd.y - this.boxStart.y);
      if (dist > 5) {
        const isCrossing = this.boxEnd.x < this.boxStart.x;
        context.setHint(
          isCrossing
            ? 'ZAZNACZANIE PRZECINAJĄCE (Prawa → Lewa): Zaznaczy wszystko wewnątrz ORAZ przecięte ramką'
            : 'ZAZNACZANIE OKNEM (Lewa → Prawa): Zaznaczy TYLKO obiekty mieszczące się w całości wewnątrz ramki'
        );
      }
      context.requestRender();
    }
  }

  onMouseUp(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    // Finish Grip Dragging
    if (this.activeGrip) {
      const pt = snapPt ? snapPt.point : worldPt;
      this.applyGripMove(this.activeGrip, pt, e, context);
      const grip = this.activeGrip;
      const currentEntity = context.doc.getEntity(grip.entityId);
      if (currentEntity) {
        const orig = grip.originalEntity;
        const currentCopy = JSON.parse(JSON.stringify(currentEntity));
        const cmd: Command = {
          description: `Rozciągnij uchwyt obiektu ${orig.type}`,
          execute: () => {
            const ent = context.doc.getEntity(grip.entityId);
            if (ent) Object.assign(ent, currentCopy);
            context.doc.notifyChange();
          },
          undo: () => {
            const ent = context.doc.getEntity(grip.entityId);
            if (ent) Object.assign(ent, orig);
            context.doc.notifyChange();
          },
        };
        context.history.execute(cmd);
      }
      this.activeGrip = null;
      context.setHint('ZAZNACZ: Gotowy.');
      context.requestRender();
      return;
    }

    if (this.isDragging && this.boxStart && this.boxEnd) {
      const screenPt = context.getMouseScreen() || context.transform.worldToScreen(worldPt);
      this.boxEnd = { ...screenPt };
      const dist = Math.hypot(this.boxEnd.x - this.boxStart.x, this.boxEnd.y - this.boxStart.y);

      if (dist > 5) {
        // User dragged a Window / Crossing box
        this.finishSelectionBox(e.shiftKey, context);
      } else {
        // User clicked without dragging
        this.isDragging = false;
        if (this.pendingClickEntity) {
          const clicked = this.pendingClickEntity;
          if (e.shiftKey) {
            if (context.doc.selectedEntityIds.has(clicked.id)) {
              context.doc.deselectEntity(clicked.id);
            } else {
              context.doc.selectEntity(clicked.id, true);
            }
          } else {
            context.doc.selectEntity(clicked.id, false);
          }
          this.boxStart = null;
          this.boxEnd = null;
          this.pendingClickEntity = null;
        } else {
          // Clicked empty space: clear selection (unless Shift) and allow 2-click box if user moves mouse, or Esc
          if (!e.shiftKey) {
            context.doc.clearSelection();
          }
          this.boxStart = null;
          this.boxEnd = null;
        }
      }
      context.requestRender();
    }
  }

  private finishSelectionBox(additive: boolean, context: ToolContext) {
    if (!this.boxStart || !this.boxEnd) return;
    const isCrossing = this.boxEnd.x < this.boxStart.x;
    const wStart = context.transform.screenToWorld(this.boxStart);
    const wEnd = context.transform.screenToWorld(this.boxEnd);

    const minX = Math.min(wStart.x, wEnd.x);
    const maxX = Math.max(wStart.x, wEnd.x);
    const minY = Math.min(wStart.y, wEnd.y);
    const maxY = Math.max(wStart.y, wEnd.y);

    this.selectInBox(minX, maxX, minY, maxY, isCrossing, context, additive);
    this.isDragging = false;
    this.isTwoClickBox = false;
    this.boxStart = null;
    this.boxEnd = null;
    this.pendingClickEntity = null;
    context.setHint(
      `ZAZNACZ: Zaznaczono ${context.doc.selectedEntityIds.size} obiekt(ów) [${isCrossing ? 'Przecięcie P→L' : 'Okno L→P'}]`
    );
  }

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selected = context.doc.getSelectedEntities();
      if (selected.length > 0) {
        const entitiesBackup = [...selected];
        const cmd: Command = {
          description: `Usuń ${selected.length} obiektów`,
          execute: () => context.doc.deleteSelected(),
          undo: () => {
            for (const ent of entitiesBackup) {
              context.doc.addEntity(ent);
            }
          },
        };
        context.history.execute(cmd);
        context.requestRender();
        return true;
      }
    } else if (e.key === 'Escape') {
      if (this.activeGrip) {
        const ent = context.doc.getEntity(this.activeGrip.entityId);
        if (ent) Object.assign(ent, this.activeGrip.originalEntity);
        this.activeGrip = null;
      }
      this.cancel(context);
      context.doc.clearSelection();
      context.requestRender();
      return true;
    }
    return false;
  }

  private findGripAt(pt: Point2D, context: ToolContext): ActiveGrip | null {
    const tolerance = context.transform.screenDistToWorld(8);
    const selected = context.doc.getSelectedEntities();

    for (const ent of selected) {
      if (ent.type === 'line') {
        const p1 = { x: ent.x1, y: ent.y1 };
        const p2 = { x: ent.x2, y: ent.y2 };
        if (VectorMath.distance(pt, p1) <= tolerance) {
          return { entityId: ent.id, gripType: 'line-p1', originalEntity: JSON.parse(JSON.stringify(ent)) };
        }
        if (VectorMath.distance(pt, p2) <= tolerance) {
          return { entityId: ent.id, gripType: 'line-p2', originalEntity: JSON.parse(JSON.stringify(ent)) };
        }
      } else if (ent.type === 'circle') {
        const c = { x: ent.cx, y: ent.cy };
        const d = VectorMath.distance(pt, c);
        if (Math.abs(d - ent.radius) <= tolerance) {
          return { entityId: ent.id, gripType: 'circle-radius', originalEntity: JSON.parse(JSON.stringify(ent)) };
        }
        if (d <= tolerance) {
          return { entityId: ent.id, gripType: 'circle-center', originalEntity: JSON.parse(JSON.stringify(ent)) };
        }
      } else if (ent.type === 'polyline') {
        for (let i = 0; i < ent.points.length; i++) {
          if (VectorMath.distance(pt, ent.points[i]) <= tolerance) {
            return {
              entityId: ent.id,
              gripType: 'poly-vertex',
              vertexIndex: i,
              originalEntity: JSON.parse(JSON.stringify(ent)),
            };
          }
        }
      } else if (ent.type === 'point') {
        if (VectorMath.distance(pt, { x: ent.x, y: ent.y }) <= tolerance) {
          return { entityId: ent.id, gripType: 'point', originalEntity: JSON.parse(JSON.stringify(ent)) };
        }
      } else if (ent.type === 'text') {
        const minWorldH = context.transform.screenDistToWorld(8);
        const corners = Geometry.textWorldCorners(ent, minWorldH);
        const gripTypes: ('text-bl' | 'text-br' | 'text-tr' | 'text-tl')[] = [
          'text-bl',
          'text-br',
          'text-tr',
          'text-tl',
        ];
        for (let c = 0; c < 4; c++) {
          if (VectorMath.distance(pt, corners[c]) <= tolerance * 1.5) {
            return {
              entityId: ent.id,
              gripType: gripTypes[c],
              originalEntity: JSON.parse(JSON.stringify(ent)),
            };
          }
        }
        const center = {
          x: (corners[0].x + corners[2].x) / 2,
          y: (corners[0].y + corners[2].y) / 2,
        };
        if (VectorMath.distance(pt, center) <= tolerance * 1.5) {
          return {
            entityId: ent.id,
            gripType: 'text-center',
            originalEntity: JSON.parse(JSON.stringify(ent)),
          };
        }
      } else if (ent.type === 'dimension') {
        if (ent.dimType === 'leader') {
          if (VectorMath.distance(pt, ent.p1) <= tolerance * 2) {
            return { entityId: ent.id, gripType: 'dim-p1', originalEntity: JSON.parse(JSON.stringify(ent)) };
          }
          if (VectorMath.distance(pt, ent.p2) <= tolerance * 2) {
            return { entityId: ent.id, gripType: 'dim-p2', originalEntity: JSON.parse(JSON.stringify(ent)) };
          }
        } else if (ent.dimType === 'radius' || ent.dimType === 'diameter' || ent.dimType === 'angular' || ent.dimType === 'arc-length') {
          if (VectorMath.distance(pt, ent.p2) <= tolerance * 2) {
            return { entityId: ent.id, gripType: 'dim-p2', originalEntity: JSON.parse(JSON.stringify(ent)) };
          }
        } else {
          const dx = ent.p2.x - ent.p1.x;
          const dy = ent.p2.y - ent.p1.y;
          const len = Math.hypot(dx, dy);
          if (len > 0) {
            const nx = -dy / len;
            const ny = dx / len;
            const mid = {
              x: (ent.p1.x + ent.p2.x) / 2 + nx * ent.offset,
              y: (ent.p1.y + ent.p2.y) / 2 + ny * ent.offset,
            };
            if (VectorMath.distance(pt, mid) <= tolerance * 2) {
              return { entityId: ent.id, gripType: 'dim-offset', originalEntity: JSON.parse(JSON.stringify(ent)) };
            }
          }
        }
      }
    }
    return null;
  }

  private applyGripMove(grip: ActiveGrip, pt: Point2D, _e: MouseEvent, context: ToolContext) {
    const ent = context.doc.getEntity(grip.entityId);
    if (!ent) return;

    if (ent.type === 'line') {
      const line = ent as LineEntity;
      if (grip.gripType === 'line-p1') {
        const effPt = context.snapEngine.isOrthoActive()
          ? context.snapEngine.applyOrtho({ x: line.x2, y: line.y2 }, pt)
          : pt;
        line.x1 = effPt.x;
        line.y1 = effPt.y;
      } else if (grip.gripType === 'line-p2') {
        const effPt = context.snapEngine.isOrthoActive()
          ? context.snapEngine.applyOrtho({ x: line.x1, y: line.y1 }, pt)
          : pt;
        line.x2 = effPt.x;
        line.y2 = effPt.y;
      }
    } else if (ent.type === 'circle') {
      const circle = ent as CircleEntity;
      if (grip.gripType === 'circle-radius') {
        const newR = VectorMath.distance({ x: circle.cx, y: circle.cy }, pt);
        if (newR > 0.01) circle.radius = newR;
      } else if (grip.gripType === 'circle-center') {
        circle.cx = pt.x;
        circle.cy = pt.y;
      }
    } else if (ent.type === 'polyline') {
      const poly = ent as PolylineEntity;
      if (grip.vertexIndex !== undefined && poly.points[grip.vertexIndex]) {
        poly.points[grip.vertexIndex] = { ...pt };
      }
    } else if (ent.type === 'point') {
      const point = ent as PointEntity;
      point.x = pt.x;
      point.y = pt.y;
    } else if (ent.type === 'text') {
      const txt = ent as TextEntity;
      const orig = grip.originalEntity as TextEntity;
      const minWorldH = context.transform.screenDistToWorld(8);
      const { w: origW, h: origH } = Geometry.getTextFrameSize(orig, minWorldH);
      const rad = ((orig.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      if (grip.gripType === 'text-center') {
        txt.x = pt.x - ((origW / 2) * cos - (origH / 2) * sin);
        txt.y = pt.y - ((origW / 2) * sin + (origH / 2) * cos);
        txt.boxWidth = origW;
        txt.boxHeight = origH;
      } else {
        const dx = pt.x - orig.x;
        const dy = pt.y - orig.y;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;

        let x0 = 0, x1 = origW, y0 = 0, y1 = origH;
        if (grip.gripType === 'text-tr') {
          x0 = Math.min(0, lx); x1 = Math.max(0, lx);
          y0 = Math.min(0, ly); y1 = Math.max(0, ly);
        } else if (grip.gripType === 'text-bl') {
          x0 = Math.min(lx, origW); x1 = Math.max(lx, origW);
          y0 = Math.min(ly, origH); y1 = Math.max(ly, origH);
        } else if (grip.gripType === 'text-br') {
          x0 = Math.min(0, lx); x1 = Math.max(0, lx);
          y0 = Math.min(ly, origH); y1 = Math.max(ly, origH);
        } else if (grip.gripType === 'text-tl') {
          x0 = Math.min(lx, origW); x1 = Math.max(lx, origW);
          y0 = Math.min(0, ly); y1 = Math.max(0, ly);
        }

        txt.x = orig.x + x0 * cos - y0 * sin;
        txt.y = orig.y + x0 * sin + y0 * cos;
        txt.boxWidth = Math.max(x1 - x0, 0.05);
        txt.boxHeight = Math.max(y1 - y0, 0.05);
      }
    } else if (ent.type === 'dimension') {
      const dim = ent as DimensionEntity;
      if (grip.gripType === 'dim-p1') {
        dim.p1 = { ...pt };
      } else if (grip.gripType === 'dim-p2') {
        dim.p2 = { ...pt };
        if (dim.dimType === 'angular' && dim.center) {
          dim.radius = VectorMath.distance(dim.center, pt);
          dim.offset = dim.radius;
        } else if (dim.dimType === 'leader') {
          dim.offset = dim.p2.x >= dim.p1.x ? Math.abs(dim.offset || 15) : -Math.abs(dim.offset || 15);
        }
      } else {
        const dx = dim.p2.x - dim.p1.x;
        const dy = dim.p2.y - dim.p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          dim.offset = (pt.x - dim.p1.x) * nx + (pt.y - dim.p1.y) * ny;
        }
      }
    }
  }

  private findEntityAt(pt: Point2D, context: ToolContext): CadEntity | null {
    const tolerance = context.transform.screenDistToWorld(8);
    const minTextH = context.transform.screenDistToWorld(8);

    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;

      if (ent.type === 'point') {
        if (VectorMath.distance(pt, { x: ent.x, y: ent.y }) <= tolerance) return ent;
      } else if (ent.type === 'line') {
        if (VectorMath.distanceToSegment(pt, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }) <= tolerance) {
          return ent;
        }
      } else if (ent.type === 'circle') {
        const d = VectorMath.distance(pt, { x: ent.cx, y: ent.cy });
        if (Math.abs(d - ent.radius) <= tolerance || d <= tolerance) {
          return ent;
        }
      } else if (ent.type === 'polyline') {
        const count = ent.closed ? ent.points.length : ent.points.length - 1;
        for (let j = 0; j < count; j++) {
          const pA = ent.points[j];
          const pB = ent.points[(j + 1) % ent.points.length];
          if (VectorMath.distanceToSegment(pt, pA, pB) <= tolerance) {
            return ent;
          }
        }
      } else if (ent.type === 'text') {
        if (Geometry.isPointInText(pt, ent, tolerance * 0.8, minTextH)) {
          return ent;
        }
      } else if (ent.type === 'image') {
        if (
          pt.x >= ent.x - tolerance &&
          pt.x <= ent.x + ent.width + tolerance &&
          pt.y >= ent.y - tolerance &&
          pt.y <= ent.y + ent.height + tolerance
        ) {
          return ent;
        }
      } else if (ent.type === 'dimension') {
        const { segments, points } = Geometry.dimensionGeometry(ent);
        for (const s of segments) {
          if (VectorMath.distanceToSegment(pt, s.a, s.b) <= tolerance * 1.5) return ent;
        }
        for (const p of points) {
          if (VectorMath.distance(pt, p) <= tolerance * 1.5) return ent;
        }
      }
    }
    return null;
  }

  private selectInBox(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    isCrossing: boolean,
    context: ToolContext,
    additive: boolean
  ) {
    if (!additive) {
      context.doc.clearSelection();
    }

    const box = { minX, minY, maxX, maxY };
    const minTextH = context.transform.screenDistToWorld(8);

    for (const ent of context.doc.entities) {
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;

      const matched = isCrossing
        ? Geometry.entityIntersectsOrInsideBox(ent, box, minTextH)
        : Geometry.entityInsideBox(ent, box, minTextH);

      if (matched) {
        context.doc.selectEntity(ent.id, true);
      }
    }
  }
}

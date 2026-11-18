import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, PolylineEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class RectTool extends BaseTool {
  readonly id = 'rect';
  readonly name = 'Prostokąt';
  readonly shortcut = 'REC';

  private corner1: Point2D | null = null;
  private currentPt: Point2D | null = null;

  activate(context: ToolContext) {
    this.corner1 = null;
    this.currentPt = null;
    context.setHint('PROSTOKĄT: Wskaż pierwszy narożnik');
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.corner1 = null;
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;

    if (!this.corner1) {
      this.corner1 = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('PROSTOKĄT: Wskaż drugi narożnik lub wpisz Szerokość i Wysokość [Tab]');

      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showDoubleFields(
        screenPt,
        'Szerokość (W):',
        0,
        'Wysokość (H):',
        0,
        (w, h) => this.commitWithDimensions(w, h, context),
        () => this.cancel(context)
      );
    } else {
      this.createRectangle(this.corner1, pt, context);
      this.cancel(context);
    }
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    this.currentPt = { ...pt };

    if (this.corner1) {
      const w = Math.abs(pt.x - this.corner1.x);
      const h = Math.abs(pt.y - this.corner1.y);
      context.hud.updateLiveValues(w, h);
      const screenPt = context.transform.worldToScreen(pt);
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

  private commitWithDimensions(width: number, height: number, context: ToolContext) {
    if (!this.corner1) return;
    const corner2: Point2D = {
      x: this.corner1.x + width,
      y: this.corner1.y + height,
    };
    this.createRectangle(this.corner1, corner2, context);
    this.cancel(context);
  }

  private createRectangle(p1: Point2D, p2: Point2D, context: ToolContext) {
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    const poly: PolylineEntity = {
      id: 'rect_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'polyline',
      layerId: context.doc.activeLayerId,
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      closed: true,
    };

    const cmd: Command = {
      description: `Dodaj Prostokąt ${VectorMath.round(maxX - minX)} x ${VectorMath.round(maxY - minY)}`,
      execute: () => context.doc.addEntity(poly),
      undo: () => context.doc.removeEntity(poly.id),
    };
    context.history.execute(cmd);
  }

  getPreview(): RenderPreview | null {
    if (this.corner1 && this.currentPt) {
      return {
        type: 'rect',
        data: { p1: this.corner1, p2: this.currentPt },
      };
    }
    return null;
  }
}

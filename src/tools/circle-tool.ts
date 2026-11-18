import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CircleEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class CircleTool extends BaseTool {
  readonly id = 'circle';
  readonly name = 'Okrąg';
  readonly shortcut = 'C';

  private centerPt: Point2D | null = null;
  private currentPt: Point2D | null = null;

  activate(context: ToolContext) {
    this.centerPt = null;
    this.currentPt = null;
    context.setHint('OKRĄG: Wskaż środek okręgu');
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.centerPt = null;
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;

    if (!this.centerPt) {
      this.centerPt = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('OKRĄG: Wskaż promień lub wpisz wartość [Enter]');

      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showSingleField(
        screenPt,
        'Promień (R):',
        0,
        (r) => this.commitWithRadius(r, context),
        () => this.cancel(context)
      );
    } else {
      const radius = VectorMath.distance(this.centerPt, pt);
      if (radius > 0.001) {
        this.createCircle(this.centerPt, radius, context);
      }
      this.cancel(context);
    }
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    this.currentPt = { ...pt };

    if (this.centerPt) {
      const radius = VectorMath.distance(this.centerPt, pt);
      context.hud.updateLiveValues(radius);
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

  private commitWithRadius(radius: number, context: ToolContext) {
    if (!this.centerPt || radius <= 0) return;
    this.createCircle(this.centerPt, radius, context);
    this.cancel(context);
  }

  private createCircle(center: Point2D, radius: number, context: ToolContext) {
    const circle: CircleEntity = {
      id: 'circle_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'circle',
      layerId: context.doc.activeLayerId,
      cx: center.x,
      cy: center.y,
      radius: radius,
    };

    const cmd: Command = {
      description: `Dodaj Okrąg (R=${VectorMath.round(radius)})`,
      execute: () => context.doc.addEntity(circle),
      undo: () => context.doc.removeEntity(circle.id),
    };
    context.history.execute(cmd);
  }

  getPreview(): RenderPreview | null {
    if (this.centerPt && this.currentPt) {
      const radius = VectorMath.distance(this.centerPt, this.currentPt);
      return {
        type: 'circle',
        data: { center: this.centerPt, current: this.currentPt, radius },
      };
    }
    return null;
  }
}

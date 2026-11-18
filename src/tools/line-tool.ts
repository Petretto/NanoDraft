import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, LineEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class LineTool extends BaseTool {
  readonly id = 'line';
  readonly name = 'Linia';
  readonly shortcut = 'L';

  private startPt: Point2D | null = null;
  private currentPt: Point2D | null = null;

  activate(context: ToolContext) {
    this.startPt = null;
    this.currentPt = null;
    context.setHint('LINIA: Wskaż punkt początkowy (kliknij lub wpisz)');
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.startPt = null;
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return; // Left click only
    const pt = snapPt ? snapPt.point : worldPt;

    if (!this.startPt) {
      // First point clicked
      this.startPt = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('LINIA: Wskaż kolejny punkt lub wpisz Długość i Kąt w okienku [Tab] (Shift/F8: Ortho)');

      // Show HUD for Length and Angle
      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showDoubleFields(
        screenPt,
        'Długość:',
        0,
        'Kąt [°]:',
        0,
        (len, angle) => this.commitWithLengthAngle(len, angle, context),
        () => this.cancel(context)
      );
    } else {
      // Second point clicked
      const effectivePt = context.snapEngine.isOrthoActive()
        ? context.snapEngine.applyOrtho(this.startPt, pt)
        : pt;

      this.createLine(this.startPt, effectivePt, context);
      // Chain to next line
      this.startPt = { ...effectivePt };
      this.currentPt = { ...effectivePt };
      const screenPt = context.transform.worldToScreen(effectivePt);
      context.hud.showDoubleFields(
        screenPt,
        'Długość:',
        0,
        'Kąt [°]:',
        0,
        (len, angle) => this.commitWithLengthAngle(len, angle, context),
        () => this.cancel(context)
      );
    }
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    const effectivePt = (this.startPt && context.snapEngine.isOrthoActive())
      ? context.snapEngine.applyOrtho(this.startPt, pt)
      : pt;

    this.currentPt = { ...effectivePt };

    if (this.startPt) {
      const dist = VectorMath.distance(this.startPt, effectivePt);
      const angle = VectorMath.angleDeg(this.startPt, effectivePt);
      context.hud.updateLiveValues(dist, angle);
      const screenPt = context.transform.worldToScreen(effectivePt);
      context.hud.updatePosition(screenPt);
    }
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.cancel(context);
      return true;
    }
    // Typing digits or Tab immediately focuses HUD
    if (/^[0-9.-]$/.test(e.key) && this.startPt && !context.hud.isActive()) {
      context.hud.focus();
    }
    return false;
  }

  private commitWithLengthAngle(len: number, angleDeg: number, context: ToolContext) {
    if (!this.startPt) return;
    const endPt = VectorMath.pointFromPolar(this.startPt, len, angleDeg);
    this.createLine(this.startPt, endPt, context);
    // Chain to next line
    this.startPt = { ...endPt };
    this.currentPt = { ...endPt };
    const screenPt = context.transform.worldToScreen(endPt);
    context.hud.showDoubleFields(
      screenPt,
      'Długość:',
      0,
      'Kąt [°]:',
      0,
      (l, a) => this.commitWithLengthAngle(l, a, context),
      () => this.cancel(context)
    );
    context.requestRender();
  }

  private createLine(p1: Point2D, p2: Point2D, context: ToolContext) {
    const line: LineEntity = {
      id: 'line_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'line',
      layerId: context.doc.activeLayerId,
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
    };

    const cmd: Command = {
      description: `Dodaj Linię (${VectorMath.round(p1.x)},${VectorMath.round(p1.y)}) -> (${VectorMath.round(p2.x)},${VectorMath.round(p2.y)})`,
      execute: () => context.doc.addEntity(line),
      undo: () => context.doc.removeEntity(line.id),
    };
    context.history.execute(cmd);
  }

  getBasePoint(): Point2D | null {
    return this.startPt;
  }

  getPreview(): RenderPreview | null {
    if (this.startPt && this.currentPt) {
      return {
        type: 'line',
        data: { p1: this.startPt, p2: this.currentPt },
      };
    }
    return null;
  }
}

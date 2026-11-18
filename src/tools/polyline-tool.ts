import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, PolylineEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class PolylineTool extends BaseTool {
  readonly id = 'polyline';
  readonly name = 'Polilinia';
  readonly shortcut = 'W';

  private points: Point2D[] = [];
  private currentPt: Point2D | null = null;

  activate(context: ToolContext) {
    this.points = [];
    this.currentPt = null;
    context.setHint('POLILINIA: Wskaż pierwszy wierzchołek');
  }

  deactivate(context: ToolContext) {
    this.finishPolyline(false, context);
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    if (this.points.length >= 2) {
      this.finishPolyline(false, context);
    }
    this.points = [];
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const rawPt = snapPt ? snapPt.point : worldPt;
    const lastPt = this.points.length > 0 ? this.points[this.points.length - 1] : null;
    const pt = (lastPt && context.snapEngine.isOrthoActive())
      ? context.snapEngine.applyOrtho(lastPt, rawPt)
      : rawPt;

    // Check if user clicked on the start point to close polyline (when >= 3 points)
    if (this.points.length >= 3 && VectorMath.distance(pt, this.points[0]) < 1e-3) {
      this.finishPolyline(true, context);
      return;
    }

    this.points.push({ ...pt });
    this.currentPt = { ...pt };

    context.setHint(
      this.points.length >= 3
        ? 'POLILINIA: Kolejny punkt | [C] Zamknij | [Enter / PPM] Zakończ otwartą'
        : 'POLILINIA: Wskaż kolejny wierzchołek lub wpisz Długość i Kąt [Tab]'
    );

    const screenPt = context.transform.worldToScreen(pt);
    context.hud.showDoubleFields(
      screenPt,
      'Długość:',
      0,
      'Kąt [°]:',
      0,
      (len, angle) => this.addPolarVertex(len, angle, context),
      () => this.cancel(context)
    );

    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const rawPt = snapPt ? snapPt.point : worldPt;
    const lastPt = this.points.length > 0 ? this.points[this.points.length - 1] : null;
    const effectivePt = (lastPt && context.snapEngine.isOrthoActive())
      ? context.snapEngine.applyOrtho(lastPt, rawPt)
      : rawPt;

    this.currentPt = { ...effectivePt };

    if (lastPt) {
      const dist = VectorMath.distance(lastPt, effectivePt);
      const angle = VectorMath.angleDeg(lastPt, effectivePt);
      context.hud.updateLiveValues(dist, angle);
      const screenPt = context.transform.worldToScreen(effectivePt);
      context.hud.updatePosition(screenPt);
    }
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Enter') {
      this.finishPolyline(false, context);
      return true;
    }
    if (e.key === 'Escape') {
      this.points = [];
      this.currentPt = null;
      context.hud.hide();
      context.setHint('POLILINIA: Anulowano');
      context.requestRender();
      return true;
    }
    if ((e.key === 'c' || e.key === 'C') && this.points.length >= 3) {
      e.preventDefault();
      this.finishPolyline(true, context);
      return true;
    }
    return false;
  }

  private addPolarVertex(len: number, angleDeg: number, context: ToolContext) {
    if (this.points.length === 0) return;
    if (len <= 0) {
      this.finishPolyline(false, context);
      return;
    }
    const lastPt = this.points[this.points.length - 1];
    const nextPt = VectorMath.pointFromPolar(lastPt, len, angleDeg);
    this.points.push(nextPt);
    this.currentPt = { ...nextPt };

    const screenPt = context.transform.worldToScreen(nextPt);
    context.hud.showDoubleFields(
      screenPt,
      'Długość:',
      0,
      'Kąt [°]:',
      0,
      (l, a) => this.addPolarVertex(l, a, context),
      () => this.cancel(context)
    );
    context.requestRender();
  }

  private finishPolyline(closed: boolean, context: ToolContext) {
    if (this.points.length < 2) {
      this.points = [];
      this.currentPt = null;
      context.hud.hide();
      context.requestRender();
      return;
    }

    const pts = this.points.map(p => ({ ...p }));
    const poly: PolylineEntity = {
      id: 'poly_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'polyline',
      layerId: context.doc.activeLayerId,
      points: pts,
      closed,
    };

    const cmd: Command = {
      description: `Dodaj Polilinię (${pts.length} wierzchołków${closed ? ', zamknięta' : ''})`,
      execute: () => context.doc.addEntity(poly),
      undo: () => context.doc.removeEntity(poly.id),
    };
    context.history.execute(cmd);

    this.points = [];
    this.currentPt = null;
    context.hud.hide();
    context.setHint('POLILINIA: Utworzono polilinię. Wskaż pierwszy punkt kolejnej polilinii.');
    context.requestRender();
  }

  getBasePoint(): Point2D | null {
    return this.points.length > 0 ? this.points[this.points.length - 1] : null;
  }

  getPreview(): RenderPreview | null {
    if (this.points.length > 0 && this.currentPt) {
      return {
        type: 'polyline',
        data: {
          points: [...this.points, this.currentPt],
          closed: false,
        },
      };
    }
    return null;
  }
}


import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { tr } from '../i18n/lang';

export class ScaleTool extends BaseTool {
  readonly id = 'scale';
  readonly name = 'Skaluj';
  readonly shortcut = 'V';

  private basePt: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private refDist: number = 20;
  private scaleFactor: number = 2.0;
  private selectedEntities: CadEntity[] = [];

  activate(context: ToolContext) {
    this.basePt = null;
    this.currentPt = null;
    this.selectedEntities = context.doc.getSelectedEntities();
    if (this.selectedEntities.length === 0) {
      context.setHint(
        tr(
          'SKALOWANIE (Scale): Najpierw kliknij obiekt na rysunku, który chcesz przeskalować!',
          'SCALE: First click an object on the drawing that you want to scale!'
        )
      );
    } else {
      context.setHint(
        tr(
          `SKALOWANIE (${this.selectedEntities.length} ob.): Wskaż punkt bazowy skalowania`,
          `SCALE (${this.selectedEntities.length} obj.): Click the base point for scaling`
        )
      );
    }
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.basePt = null;
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;

    const sel = context.doc.getSelectedEntities();
    if (sel.length === 0) {
      const tol = 8 / context.transform.zoom;
      for (let i = context.doc.entities.length - 1; i >= 0; i--) {
        const ent = context.doc.entities[i];
        const b = Geometry.entityBounds(ent);
        if (b && pt.x >= b.minX - tol && pt.x <= b.maxX + tol && pt.y >= b.minY - tol && pt.y <= b.maxY + tol) {
          context.doc.selectEntity(ent.id, false);
          this.activate(context);
          context.requestRender();
          return;
        }
      }
      return;
    }

    if (!this.basePt) {
      this.selectedEntities = sel;
      this.basePt = { ...pt };
      this.currentPt = { ...pt };
      const b = Geometry.unionBounds(sel);
      if (b) {
        const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2;
        this.refDist = Math.max(diag, 10);
      }

      context.setHint(
        tr(
          'SKALOWANIE: Wpisz współczynnik skali w okienku HUD (np. 2 lub 0.5) [Enter] lub przesuń mysz i kliknij',
          'SCALE: Type scale factor in HUD (e.g. 2 or 0.5) [Enter] or move mouse and click'
        )
      );

      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showSingleField(
        screenPt,
        tr('Skala (×):', 'Scale (×):'),
        this.scaleFactor,
        factor => {
          if (factor > 0.001 && this.basePt) {
            this.scaleFactor = factor;
            this.commitScale(this.basePt, factor, context);
          }
        },
        () => this.cancel(context)
      );
      context.requestRender();
      return;
    }

    // Commit by mouse click
    const d = VectorMath.distance(this.basePt, pt);
    const factor = d > 1e-3 ? Math.max(0.05, VectorMath.round(d / this.refDist, 2)) : this.scaleFactor;
    this.commitScale(this.basePt, factor, context);
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    this.currentPt = { ...pt };
    if (this.basePt) {
      const d = VectorMath.distance(this.basePt, pt);
      if (d > 1e-3) {
        this.scaleFactor = Math.max(0.05, VectorMath.round(d / this.refDist, 2));
        context.hud.updateLiveValues(this.scaleFactor);
      }
      const screenPt = context.transform.worldToScreen(pt);
      context.hud.updatePosition(screenPt);
      context.requestRender();
    }
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  private commitScale(base: Point2D, factor: number, context: ToolContext) {
    const sel = context.doc.getSelectedEntities();
    if (sel.length === 0 || Math.abs(factor - 1) < 1e-6) {
      this.cancel(context);
      return;
    }

    const beforeStates = sel.map(e => Geometry.cloneEntity(e, e.id));
    const afterStates = sel.map(e => {
      const scaled = Geometry.transformEntity(
        e,
        p => ({
          x: base.x + (p.x - base.x) * factor,
          y: base.y + (p.y - base.y) * factor,
        }),
        { scale: factor }
      );
      scaled.id = e.id;
      scaled.selected = true;
      return scaled;
    });

    const applySnapshots = (snapshots: CadEntity[]) => {
      for (const snap of snapshots) {
        const idx = context.doc.entities.findIndex(ent => ent.id === snap.id);
        if (idx !== -1) {
          context.doc.entities[idx] = Geometry.cloneEntity(snap, snap.id);
          context.doc.entities[idx].selected = true;
        }
      }
      context.doc.notifyChange();
    };

    const cmd: Command = {
      description: tr(`Skaluj obiekty (×${factor})`, `Scale objects (×${factor})`),
      execute: () => applySnapshots(afterStates),
      undo: () => applySnapshots(beforeStates),
    };

    context.history.execute(cmd);
    this.cancel(context);
  }

  getPreview(): RenderPreview | null {
    if (!this.basePt || !this.currentPt || this.selectedEntities.length === 0) return null;
    const factor = this.scaleFactor;
    if (factor <= 0.001) return null;
    const base = this.basePt;
    const ghosts = this.selectedEntities.map(e =>
      Geometry.transformEntity(
        e,
        p => ({
          x: base.x + (p.x - base.x) * factor,
          y: base.y + (p.y - base.y) * factor,
        }),
        { scale: factor }
      )
    );
    return {
      type: 'ghost',
      data: {
        entities: ghosts,
        guideLine: { p1: this.basePt, p2: this.currentPt },
        label: `×${factor}`,
      },
    };
  }
}

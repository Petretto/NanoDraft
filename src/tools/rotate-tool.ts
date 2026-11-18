import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class RotateTool extends BaseTool {
  readonly id = 'rotate';
  readonly name = 'Obróć';
  readonly shortcut = 'O';

  private basePt: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private selectedEntities: CadEntity[] = [];

  activate(context: ToolContext) {
    this.basePt = null;
    this.currentPt = null;
    this.selectedEntities = context.doc.getSelectedEntities();

    if (this.selectedEntities.length === 0) {
      context.setHint('OBRÓĆ: Najpierw zaznacz obiekty do obrócenia');
    } else {
      context.setHint('OBRÓĆ: Wskaż środek obrotu (punkt bazowy)');
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

    if (this.selectedEntities.length === 0) {
      this.selectedEntities = context.doc.getSelectedEntities();
      if (this.selectedEntities.length === 0) {
        context.setHint('OBRÓĆ: Zaznacz przynajmniej 1 obiekt!');
        return;
      }
    }

    if (!this.basePt) {
      this.basePt = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('OBRÓĆ: Wpisz kąt obrotu [°] lub kliknij punkt kierunkowy (Shift/F8: skok 90°)');

      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showSingleField(
        screenPt,
        'Kąt obrotu [°]:',
        90,
        (angleDeg) => this.commitRotation(angleDeg, context),
        () => this.cancel(context)
      );
    } else {
      const effectivePt = context.snapEngine.isOrthoActive()
        ? context.snapEngine.applyOrtho(this.basePt, pt)
        : pt;
      const angleDeg = VectorMath.angleDeg(this.basePt, effectivePt);
      this.commitRotation(angleDeg, context);
    }
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    const effectivePt = (this.basePt && context.snapEngine.isOrthoActive())
      ? context.snapEngine.applyOrtho(this.basePt, pt)
      : pt;

    this.currentPt = { ...effectivePt };

    if (this.basePt) {
      const angleDeg = VectorMath.round(VectorMath.angleDeg(this.basePt, effectivePt), 1);
      context.hud.updateLiveValues(angleDeg);
      const screenPt = context.transform.worldToScreen(effectivePt);
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

  private commitRotation(angleDeg: number, context: ToolContext) {
    if (!this.basePt || this.selectedEntities.length === 0 || Math.abs(angleDeg) < 1e-6) {
      this.cancel(context);
      return;
    }

    const center = { ...this.basePt };
    const beforeStates = this.selectedEntities.map(e => Geometry.cloneEntity(e, e.id));
    const afterStates = this.selectedEntities.map(e => {
      const rotated = Geometry.transformEntity(
        e,
        (p) => Geometry.rotatePoint(p, center, angleDeg),
        { angleDeltaDeg: angleDeg }
      );
      rotated.id = e.id;
      rotated.selected = true;
      return rotated;
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
      description: `Obróć ${afterStates.length} obiekt(ów) o ${VectorMath.round(angleDeg)}°`,
      execute: () => applySnapshots(afterStates),
      undo: () => applySnapshots(beforeStates),
    };

    context.history.execute(cmd);
    this.cancel(context);
  }

  getPreview(): RenderPreview | null {
    if (this.basePt && this.currentPt && this.selectedEntities.length > 0) {
      const angleDeg = VectorMath.angleDeg(this.basePt, this.currentPt);
      const center = this.basePt;
      const ghosts = this.selectedEntities.map(e =>
        Geometry.transformEntity(e, (p) => Geometry.rotatePoint(p, center, angleDeg), { angleDeltaDeg: angleDeg })
      );
      return {
        type: 'ghost',
        data: {
          entities: ghosts,
          guideLine: { p1: this.basePt, p2: this.currentPt },
        },
      };
    }
    return null;
  }
}


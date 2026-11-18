import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class MoveTool extends BaseTool {
  readonly id = 'move';
  readonly name = 'Przesuń';
  readonly shortcut = 'M';

  private basePt: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private movingEntities: CadEntity[] = [];

  activate(context: ToolContext) {
    this.basePt = null;
    this.currentPt = null;
    this.movingEntities = context.doc.getSelectedEntities();

    if (this.movingEntities.length === 0) {
      context.setHint('PRZESUŃ: Najpierw zaznacz obiekty do przesunięcia');
    } else {
      context.setHint('PRZESUŃ: Wskaż punkt bazowy (skąd przesunąć)');
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

    // Refresh selected entities in case user selected after activating
    if (this.movingEntities.length === 0) {
      this.movingEntities = context.doc.getSelectedEntities();
      if (this.movingEntities.length === 0) {
        context.setHint('PRZESUŃ: Zaznacz przynajmniej 1 obiekt!');
        return;
      }
    }

    if (!this.basePt) {
      // Step 1: Base point chosen
      this.basePt = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('PRZESUŃ: Wskaż punkt docelowy LUB wpisz ΔX i ΔY w okienku [Tab/Enter] (Shift/F8: Ortho)');

      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showDoubleFields(
        screenPt,
        'ΔX:',
        0,
        'ΔY:',
        0,
        (dx, dy) => this.commitWithDelta(dx, dy, context),
        () => this.cancel(context)
      );
    } else {
      // Step 2: Destination point clicked
      const effectivePt = context.snapEngine.isOrthoActive()
        ? context.snapEngine.applyOrtho(this.basePt, pt)
        : pt;
      const dx = effectivePt.x - this.basePt.x;
      const dy = effectivePt.y - this.basePt.y;
      this.commitWithDelta(dx, dy, context);
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
      const dx = effectivePt.x - this.basePt.x;
      const dy = effectivePt.y - this.basePt.y;
      context.hud.updateLiveValues(dx, dy);
      const screenPt = context.transform.worldToScreen(effectivePt);
      context.hud.updatePosition(screenPt);
    }
    context.requestRender();
  }

  getBasePoint(): Point2D | null {
    return this.basePt;
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  private commitWithDelta(dx: number, dy: number, context: ToolContext) {
    if (this.movingEntities.length === 0 || (dx === 0 && dy === 0)) {
      this.cancel(context);
      return;
    }

    const entitiesToMove = [...this.movingEntities];

    const applyDelta = (deltaX: number, deltaY: number) => {
      context.doc.moveEntitiesWithAssociativeDimensions(entitiesToMove, deltaX, deltaY);
    };

    const cmd: Command = {
      description: `Przesuń o ΔX=${VectorMath.round(dx)}, ΔY=${VectorMath.round(dy)}`,
      execute: () => applyDelta(dx, dy),
      undo: () => applyDelta(-dx, -dy),
    };

    context.history.execute(cmd);
    this.cancel(context);
  }

  getPreview(): RenderPreview | null {
    if (this.basePt && this.currentPt && this.movingEntities.length > 0) {
      const dx = this.currentPt.x - this.basePt.x;
      const dy = this.currentPt.y - this.basePt.y;
      const ghosts = this.movingEntities.map(e =>
        Geometry.transformEntity(e, (p) => ({ x: p.x + dx, y: p.y + dy }))
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

import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, PointEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Command } from '../model/history';

export class PointTool extends BaseTool {
  readonly id = 'point';
  readonly name = 'Punkt';
  readonly shortcut = 'PO';

  activate(context: ToolContext) {
    context.setHint('PUNKT: Kliknij na płótnie, aby wstawić punkt');
  }

  deactivate(context: ToolContext) {
    context.setHint('');
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;

    const pointEnt: PointEntity = {
      id: 'pt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'point',
      layerId: context.doc.activeLayerId,
      x: pt.x,
      y: pt.y,
    };

    const cmd: Command = {
      description: `Dodaj Punkt (${VectorMath.round(pt.x)}, ${VectorMath.round(pt.y)})`,
      execute: () => context.doc.addEntity(pointEnt),
      undo: () => context.doc.removeEntity(pointEnt.id),
    };
    context.history.execute(cmd);
    context.requestRender();
  }

  onMouseMove() {}
  onMouseUp() {}
  onKeyDown() { return false; }
}


import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity } from '../types/cad';
import { CadDocument } from '../model/document';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class MirrorTool extends BaseTool {
  readonly id = 'mirror';
  readonly name = 'Lustro';
  readonly shortcut = 'I';

  private axisP1: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private selectedEntities: CadEntity[] = [];

  activate(context: ToolContext) {
    this.axisP1 = null;
    this.currentPt = null;
    this.selectedEntities = context.doc.getSelectedEntities();

    if (this.selectedEntities.length === 0) {
      context.setHint('LUSTRO: Najpierw zaznacz obiekty do odbicia lustrzanego');
    } else {
      context.setHint('LUSTRO: Wskaż pierwszy punkt osi odbicia');
    }
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.axisP1 = null;
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
        context.setHint('LUSTRO: Zaznacz przynajmniej 1 obiekt!');
        return;
      }
    }

    if (!this.axisP1) {
      this.axisP1 = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('LUSTRO: Wskaż drugi punkt osi odbicia (Shift/F8: oś pionowa/pozioma)');
    } else {
      const effectivePt = context.snapEngine.isOrthoActive()
        ? context.snapEngine.applyOrtho(this.axisP1, pt)
        : pt;

      if (VectorMath.distance(this.axisP1, effectivePt) < 1e-4) {
        context.setHint('LUSTRO: Drugi punkt osi musi być różny od pierwszego!');
        return;
      }
      this.commitMirror(this.axisP1, effectivePt, context);
    }
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    const effectivePt = (this.axisP1 && context.snapEngine.isOrthoActive())
      ? context.snapEngine.applyOrtho(this.axisP1, pt)
      : pt;

    this.currentPt = { ...effectivePt };
    context.requestRender();
  }

  getBasePoint(): Point2D | null {
    return this.axisP1;
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  private commitMirror(a1: Point2D, a2: Point2D, context: ToolContext) {
    const mirroredEntities: CadEntity[] = this.selectedEntities.map(e => {
      const copy = Geometry.transformEntity(
        e,
        (p) => Geometry.mirrorPoint(p, a1, a2),
        { invertOffset: true }
      );
      copy.selected = false;
      return copy;
    });

    CadDocument.remapClonedGroups(mirroredEntities);

    const cmd: Command = {
      description: `Odbicie lustrzane (${mirroredEntities.length} obiektów)`,
      execute: () => {
        for (const me of mirroredEntities) context.doc.addEntity(me);
      },
      undo: () => {
        for (const me of mirroredEntities) context.doc.removeEntity(me.id);
      },
    };

    context.history.execute(cmd);
    this.cancel(context);
  }

  getPreview(): RenderPreview | null {
    if (this.axisP1 && this.currentPt && this.selectedEntities.length > 0) {
      if (VectorMath.distance(this.axisP1, this.currentPt) < 1e-4) return null;
      const a1 = this.axisP1;
      const a2 = this.currentPt;
      const ghosts = this.selectedEntities.map(e =>
        Geometry.transformEntity(e, (p) => Geometry.mirrorPoint(p, a1, a2), { invertOffset: true })
      );
      return {
        type: 'ghost',
        data: {
          entities: ghosts,
          guideLine: { p1: a1, p2: a2 },
        },
      };
    }
    return null;
  }
}


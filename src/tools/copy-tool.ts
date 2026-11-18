import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity } from '../types/cad';
import { CadDocument } from '../model/document';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';

export class CopyTool extends BaseTool {
  readonly id = 'copy';
  readonly name = 'Kopiuj';
  readonly shortcut = 'K';

  private basePt: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private selectedEntities: CadEntity[] = [];

  activate(context: ToolContext) {
    this.basePt = null;
    this.currentPt = null;
    this.selectedEntities = context.doc.getSelectedEntities();

    if (this.selectedEntities.length === 0) {
      context.setHint('KOPIUJ: Najpierw zaznacz obiekty do skopiowania');
    } else {
      context.setHint('KOPIUJ: Wskaż punkt bazowy (Shift/F8: Ortho)');
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
        context.setHint('KOPIUJ: Zaznacz przynajmniej 1 obiekt!');
        return;
      }
    }

    if (!this.basePt) {
      // Step 1: Base point chosen
      this.basePt = { ...pt };
      this.currentPt = { ...pt };
      context.setHint('KOPIUJ: Wskaż punkt docelowy kopii (klikaj kolejne punkty lub Esc aby zakończyć)');

      const screenPt = context.transform.worldToScreen(pt);
      context.hud.showDoubleFields(
        screenPt,
        'ΔX:',
        0,
        'ΔY:',
        0,
        (dx, dy) => this.commitCopy(dx, dy, context),
        () => this.cancel(context)
      );
    } else {
      // Step 2: Destination clicked
      const effectivePt = context.snapEngine.isOrthoActive()
        ? context.snapEngine.applyOrtho(this.basePt, pt)
        : pt;
      const dx = effectivePt.x - this.basePt.x;
      const dy = effectivePt.y - this.basePt.y;
      this.commitCopy(dx, dy, context);
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
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  private commitCopy(dx: number, dy: number, context: ToolContext) {
    if (this.selectedEntities.length === 0 || (dx === 0 && dy === 0)) return;

    const newEntities: CadEntity[] = [];

    for (const ent of this.selectedEntities) {
      const copyId = ent.type + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      if (ent.type === 'point') {
        newEntities.push({ ...ent, id: copyId, x: ent.x + dx, y: ent.y + dy, selected: false });
      } else if (ent.type === 'line') {
        newEntities.push({
          ...ent,
          id: copyId,
          x1: ent.x1 + dx,
          y1: ent.y1 + dy,
          x2: ent.x2 + dx,
          y2: ent.y2 + dy,
          selected: false,
        });
      } else if (ent.type === 'circle') {
        newEntities.push({
          ...ent,
          id: copyId,
          cx: ent.cx + dx,
          cy: ent.cy + dy,
          selected: false,
        });
      } else if (ent.type === 'polyline') {
        newEntities.push({
          ...ent,
          id: copyId,
          points: ent.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
          selected: false,
        });
      } else if (ent.type === 'text') {
        newEntities.push({
          ...ent,
          id: copyId,
          x: ent.x + dx,
          y: ent.y + dy,
          selected: false,
        });
      } else if (ent.type === 'dimension') {
        newEntities.push({
          ...ent,
          id: copyId,
          p1: { x: ent.p1.x + dx, y: ent.p1.y + dy },
          p2: { x: ent.p2.x + dx, y: ent.p2.y + dy },
          selected: false,
        });
      }
    }

    CadDocument.remapClonedGroups(newEntities);

    const cmd: Command = {
      description: `Kopiuj ${newEntities.length} obiektów (ΔX=${VectorMath.round(dx)}, ΔY=${VectorMath.round(dy)})`,
      execute: () => {
        for (const ne of newEntities) context.doc.addEntity(ne);
      },
      undo: () => {
        for (const ne of newEntities) context.doc.removeEntity(ne.id);
      },
    };

    context.history.execute(cmd);
    context.requestRender();
  }

  getPreview(): RenderPreview | null {
    if (this.basePt && this.currentPt && this.selectedEntities.length > 0) {
      const dx = this.currentPt.x - this.basePt.x;
      const dy = this.currentPt.y - this.basePt.y;
      const ghosts = this.selectedEntities.map(e =>
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


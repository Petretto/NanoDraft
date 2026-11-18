import { CadDocument } from '../model/document';
import { HistoryManager } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { Point2D, SnapPoint } from '../types/cad';
import { RenderPreview } from '../engine/renderer';
import { DynamicHud } from '../ui/hud';
import { SnapEngine } from '../engine/snap';

export interface ToolContext {
  doc: CadDocument;
  history: HistoryManager;
  transform: ViewportTransform;
  hud: DynamicHud;
  snapEngine: SnapEngine;
  setHint: (hint: string) => void;
  requestRender: () => void;
  /** Current cursor position in screen pixels (null when outside canvas) */
  getMouseScreen: () => Point2D | null;
}

export abstract class BaseTool {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly shortcut: string;

  abstract activate(context: ToolContext): void;
  abstract deactivate(context: ToolContext): void;

  abstract onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext): void;
  abstract onMouseMove(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext): void;
  abstract onMouseUp(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext): void;
  abstract onKeyDown(e: KeyboardEvent, context: ToolContext): boolean; // returns true if handled

  getPreview(): RenderPreview | null {
    return null;
  }

  /**
   * Last fixed point of the current operation (used for relative @dx,dy and
   * direct-distance input from the command line). null if not applicable.
   */
  getBasePoint(): Point2D | null {
    return null;
  }

  /** Does this tool accept point input from the command line? */
  acceptsPointInput(): boolean {
    return true;
  }

  cancel(_context: ToolContext): void {
    // Default cancel implementation
  }

  /** Helper: screen position for HUD (cursor or viewport center) */
  protected hudPos(context: ToolContext): Point2D {
    return (
      context.getMouseScreen() || {
        x: context.transform.screenWidth / 2,
        y: context.transform.screenHeight / 2,
      }
    );
  }
}

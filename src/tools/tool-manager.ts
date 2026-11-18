import { BaseTool, ToolContext } from './base-tool';
import { SelectTool } from './select-tool';
import { LineTool } from './line-tool';
import { PolylineTool } from './polyline-tool';
import { RectTool } from './rect-tool';
import { CircleTool } from './circle-tool';
import { ArcTool } from './arc-tool';
import { ShapeTool } from './shape-tool';
import { PointTool } from './point-tool';
import { MoveTool } from './move-tool';
import { CopyTool } from './copy-tool';
import { RotateTool } from './rotate-tool';
import { MirrorTool } from './mirror-tool';
import { OffsetTool } from './offset-tool';
import { FilletTool } from './fillet-tool';
import { TrimTool } from './trim-tool';
import { ArrayTool } from './array-tool';
import { ScaleTool } from './scale-tool';
import { HatchTool } from './hatch-tool';
import { DimTool } from './dim-tool';
import { LeaderTool } from './leader-tool';
import { MeasureTool } from './measure-tool';
import { TextTool } from './text-tool';
import { MatchPropsTool } from './match-props-tool';
import { Point2D, SnapPoint } from '../types/cad';
import { RenderPreview } from '../engine/renderer';

export class ToolManager {
  private tools: Map<string, BaseTool> = new Map();
  private activeTool: BaseTool;
  private context: ToolContext;
  private changeListeners: ((tool: BaseTool) => void)[] = [];

  constructor(context: ToolContext) {
    this.context = context;

    // Register all default CAD tools
    this.registerTool(new SelectTool());
    this.registerTool(new LineTool());
    this.registerTool(new PolylineTool());
    this.registerTool(new RectTool());
    this.registerTool(new CircleTool());
    this.registerTool(new ArcTool());
    this.registerTool(new ShapeTool());
    this.registerTool(new PointTool());
    this.registerTool(new MoveTool());
    this.registerTool(new CopyTool());
    this.registerTool(new RotateTool());
    this.registerTool(new MirrorTool());
    this.registerTool(new OffsetTool());
    this.registerTool(new FilletTool());
    this.registerTool(new TrimTool());
    this.registerTool(new ArrayTool());
    this.registerTool(new ScaleTool());
    this.registerTool(new HatchTool());
    this.registerTool(new DimTool());
    this.registerTool(new LeaderTool());
    this.registerTool(new MeasureTool());
    this.registerTool(new TextTool());
    this.registerTool(new MatchPropsTool());

    // Default active tool is Select
    this.activeTool = this.tools.get('select')!;
    this.activeTool.activate(this.context);
  }

  registerTool(tool: BaseTool) {
    this.tools.set(tool.id, tool);
  }

  getTool(id: string): BaseTool | undefined {
    return this.tools.get(id);
  }

  getActiveTool(): BaseTool {
    return this.activeTool;
  }

  getAllTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  addChangeListener(listener: (tool: BaseTool) => void) {
    this.changeListeners.push(listener);
  }

  setActiveTool(id: string) {
    const nextTool = this.tools.get(id);
    if (!nextTool || nextTool === this.activeTool) return;

    this.activeTool.deactivate(this.context);
    this.activeTool = nextTool;
    this.activeTool.activate(this.context);

    for (const listener of this.changeListeners) {
      listener(this.activeTool);
    }
    this.context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null) {
    this.activeTool.onMouseDown(e, worldPt, snapPt, this.context);
  }

  onMouseMove(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null) {
    this.activeTool.onMouseMove(e, worldPt, snapPt, this.context);
  }

  onMouseUp(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null) {
    this.activeTool.onMouseUp(e, worldPt, snapPt, this.context);
  }

  onKeyDown(e: KeyboardEvent): boolean {
    return this.activeTool.onKeyDown(e, this.context);
  }

  getPreview(): RenderPreview | null {
    return this.activeTool.getPreview();
  }

  getSelectionBox(): { start: Point2D; end: Point2D } | null {
    if (this.activeTool instanceof SelectTool) {
      return this.activeTool.getSelectionBox();
    }
    return null;
  }

  cancelActive() {
    this.activeTool.cancel(this.context);
  }
}


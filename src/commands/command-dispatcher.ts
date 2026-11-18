import { ToolManager } from '../tools/tool-manager';
import { CadDocument } from '../model/document';
import { HistoryManager, Command } from '../model/history';
import { SnapEngine } from '../engine/snap';
import { CadGrid } from '../engine/grid';
import { ViewportTransform } from '../math/transform';
import { Geometry } from '../math/geometry';
import { BlocksManager } from '../ui/blocks-modal';
import { CadEntity, Point2D } from '../types/cad';

export class CommandDispatcher {
  private clipboard: CadEntity[] = [];
  private clipboardCentroid: Point2D = { x: 0, y: 0 };

  constructor(
    private toolManager: ToolManager,
    private doc: CadDocument,
    private history: HistoryManager,
    private snapEngine: SnapEngine,
    private grid: CadGrid,
    private transform: ViewportTransform,
    private requestRender: () => void,
    private getMouseWorldPos?: () => Point2D | null
  ) {
    this.setupKeyboardListeners();
    this.exposeGlobalApi();
  }

  private setupKeyboardListeners() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Escape ALWAYS cancels everything and clears selection immediately
      if (e.key === 'Escape') {
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) {
          (document.activeElement as HTMLElement).blur();
        }
        e.preventDefault();
        this.execute('cmd.cancel');
        return;
      }

      // Don't intercept other keys if user is typing in an input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Global hotkeys (Ctrl+...)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) {
            this.execute('cmd.redo');
          } else {
            this.execute('cmd.undo');
          }
          return;
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          this.execute('cmd.redo');
          return;
        } else if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          this.copyToClipboard();
          return;
        } else if (e.key === 'v' || e.key === 'V') {
          e.preventDefault();
          this.pasteFromClipboard();
          return;
        } else if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          if (e.shiftKey) {
            this.execute('cmd.ungroup');
          } else {
            this.execute('cmd.group');
          }
          return;
        } else if (e.key === 'u' || e.key === 'U') {
          e.preventDefault();
          this.execute('cmd.ungroup');
          return;
        }
      }

      // Check active tool first
      if (this.toolManager.onKeyDown(e)) {
        return;
      }

      const key = e.key.toUpperCase();
      switch (key) {
        case 'L':
          e.preventDefault();
          this.execute('cmd.tool.line');
          break;
        case 'C':
          e.preventDefault();
          this.execute('cmd.tool.circle');
          break;
        case 'A':
          e.preventDefault();
          this.execute('cmd.tool.arc');
          break;
        case 'U':
          e.preventDefault();
          this.execute('cmd.tool.polygon');
          break;
        case 'N':
          e.preventDefault();
          this.execute('cmd.tool.leader');
          break;
        case 'R':
          e.preventDefault();
          this.execute('cmd.tool.rect');
          break;
        case 'M':
          e.preventDefault();
          this.execute('cmd.tool.move');
          break;
        case 'K':
          e.preventDefault();
          this.execute('cmd.tool.copy');
          break;
        case 'D':
          e.preventDefault();
          this.execute('cmd.tool.dimension');
          break;
        case 'T':
          e.preventDefault();
          this.execute('cmd.tool.text');
          break;
        case 'P':
          e.preventDefault();
          this.execute('cmd.tool.point');
          break;
        case 'S':
          e.preventDefault();
          this.execute('cmd.tool.select');
          break;
        case 'W':
          e.preventDefault();
          this.execute('cmd.tool.polyline');
          break;
        case 'O':
          e.preventDefault();
          this.execute('cmd.tool.rotate');
          break;
        case 'I':
          e.preventDefault();
          this.execute('cmd.tool.mirror');
          break;
        case 'F':
          e.preventDefault();
          this.execute('cmd.tool.offset');
          break;
        case 'G':
          e.preventDefault();
          this.execute('cmd.tool.fillet');
          break;
        case 'X':
          e.preventDefault();
          this.execute('cmd.tool.trim');
          break;
        case 'Y':
          e.preventDefault();
          this.execute('cmd.tool.array');
          break;
        case 'V':
          e.preventDefault();
          this.execute('cmd.tool.scale');
          break;
        case 'H':
          e.preventDefault();
          this.execute('cmd.tool.hatch');
          break;
        case 'J':
          e.preventDefault();
          this.execute('cmd.tool.match-props');
          break;
        case 'E':
          e.preventDefault();
          this.execute('cmd.explode');
          break;
        case 'B':
          e.preventDefault();
          this.execute('cmd.blocks.open');
          break;
        case 'Q':
          e.preventDefault();
          this.execute('cmd.tool.measure');
          break;
        case 'Z':
          e.preventDefault();
          this.execute('cmd.view.fit');
          break;
        case 'F3':
          e.preventDefault();
          this.execute('cmd.toggle.snap');
          break;
        case 'F8':
          e.preventDefault();
          this.execute('cmd.toggle.ortho');
          break;
        case 'F7':
          e.preventDefault();
          this.execute('cmd.toggle.grid');
          break;
        case 'HOME':
          e.preventDefault();
          this.execute('cmd.view.reset');
          break;
      }
    });
  }

  private copyToClipboard() {
    const selected = this.doc.getSelectedEntities();
    if (selected.length === 0) return;

    this.clipboard = JSON.parse(JSON.stringify(selected));

    // Compute centroid of copied objects
    let sumX = 0, sumY = 0, count = 0;
    for (const ent of this.clipboard) {
      if (ent.type === 'point' || ent.type === 'text') {
        sumX += ent.x; sumY += ent.y; count++;
      } else if (ent.type === 'line') {
        sumX += (ent.x1 + ent.x2) / 2; sumY += (ent.y1 + ent.y2) / 2; count++;
      } else if (ent.type === 'circle') {
        sumX += ent.cx; sumY += ent.cy; count++;
      } else if (ent.type === 'polyline') {
        for (const p of ent.points) { sumX += p.x; sumY += p.y; count++; }
      } else if (ent.type === 'dimension') {
        sumX += (ent.p1.x + ent.p2.x) / 2; sumY += (ent.p1.y + ent.p2.y) / 2; count++;
      }
    }
    this.clipboardCentroid = count > 0 ? { x: sumX / count, y: sumY / count } : { x: 0, y: 0 };
  }

  private pasteFromClipboard() {
    if (this.clipboard.length === 0) return;

    const mousePt = this.getMouseWorldPos ? this.getMouseWorldPos() : null;
    const targetPt = mousePt || { x: this.clipboardCentroid.x + 15, y: this.clipboardCentroid.y + 15 };
    const dx = targetPt.x - this.clipboardCentroid.x;
    const dy = targetPt.y - this.clipboardCentroid.y;

    const newEntities: CadEntity[] = [];

    for (const ent of this.clipboard) {
      const copyId = ent.type + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      if (ent.type === 'point') {
        newEntities.push({ ...ent, id: copyId, x: ent.x + dx, y: ent.y + dy, selected: true });
      } else if (ent.type === 'line') {
        newEntities.push({ ...ent, id: copyId, x1: ent.x1 + dx, y1: ent.y1 + dy, x2: ent.x2 + dx, y2: ent.y2 + dy, selected: true });
      } else if (ent.type === 'circle') {
        newEntities.push({ ...ent, id: copyId, cx: ent.cx + dx, cy: ent.cy + dy, selected: true });
      } else if (ent.type === 'polyline') {
        newEntities.push({ ...ent, id: copyId, points: ent.points.map(p => ({ x: p.x + dx, y: p.y + dy })), selected: true });
      } else if (ent.type === 'text') {
        newEntities.push({ ...ent, id: copyId, x: ent.x + dx, y: ent.y + dy, selected: true });
      } else if (ent.type === 'dimension') {
        newEntities.push({ ...ent, id: copyId, p1: { x: ent.p1.x + dx, y: ent.p1.y + dy }, p2: { x: ent.p2.x + dx, y: ent.p2.y + dy }, selected: true });
      }
    }

    CadDocument.remapClonedGroups(newEntities);

    const cmd: Command = {
      description: `Wklej ${newEntities.length} obiektów (Ctrl+V)`,
      execute: () => {
        this.doc.clearSelection();
        for (const ne of newEntities) {
          this.doc.addEntity(ne);
          this.doc.selectEntity(ne.id, true);
        }
      },
      undo: () => {
        for (const ne of newEntities) {
          this.doc.removeEntity(ne.id);
        }
      },
    };

    this.history.execute(cmd);
    // Shift centroid slightly for consecutive pastes if mouse doesn't move
    this.clipboardCentroid = { x: targetPt.x, y: targetPt.y };
    this.toolManager.setActiveTool('select');
    this.requestRender();
  }

  execute(commandId: string, _args?: any) {
    switch (commandId) {
      case 'cmd.tool.select':
        this.toolManager.setActiveTool('select');
        break;
      case 'cmd.tool.line':
        this.toolManager.setActiveTool('line');
        break;
      case 'cmd.tool.rect':
        this.toolManager.setActiveTool('rect');
        break;
      case 'cmd.tool.circle':
        this.toolManager.setActiveTool('circle');
        break;
      case 'cmd.tool.arc':
        this.toolManager.setActiveTool('arc');
        break;
      case 'cmd.tool.polygon':
        this.toolManager.setActiveTool('polygon');
        break;
      case 'cmd.tool.leader':
        this.toolManager.setActiveTool('leader');
        break;
      case 'cmd.tool.point':
        this.toolManager.setActiveTool('point');
        break;
      case 'cmd.tool.move':
        this.toolManager.setActiveTool('move');
        break;
      case 'cmd.tool.copy':
        this.toolManager.setActiveTool('copy');
        break;
      case 'cmd.tool.dimension':
        this.toolManager.setActiveTool('dimension');
        break;
      case 'cmd.tool.text':
        this.toolManager.setActiveTool('text');
        break;
      case 'cmd.tool.polyline':
        this.toolManager.setActiveTool('polyline');
        break;
      case 'cmd.tool.rotate':
        this.toolManager.setActiveTool('rotate');
        break;
      case 'cmd.tool.mirror':
        this.toolManager.setActiveTool('mirror');
        break;
      case 'cmd.tool.offset':
        this.toolManager.setActiveTool('offset');
        break;
      case 'cmd.tool.fillet':
        this.toolManager.setActiveTool('fillet');
        break;
      case 'cmd.tool.trim':
        this.toolManager.setActiveTool('trim');
        break;
      case 'cmd.tool.array':
        this.toolManager.setActiveTool('array');
        break;
      case 'cmd.tool.scale':
        this.toolManager.setActiveTool('scale');
        break;
      case 'cmd.tool.hatch':
        this.toolManager.setActiveTool('hatch');
        break;
      case 'cmd.tool.match-props':
        this.toolManager.setActiveTool('match-props');
        break;
      case 'cmd.explode':
        this.doc.explodeSelected(this.history);
        this.requestRender();
        break;
      case 'cmd.blocks.open':
        BlocksManager.openModal(this.doc, this.history, this.transform, () => this.requestRender());
        break;
      case 'cmd.group':
        this.doc.groupSelected(this.history);
        this.requestRender();
        break;
      case 'cmd.ungroup':
        this.doc.ungroupSelected(this.history);
        this.requestRender();
        break;
      case 'cmd.tool.measure':
        this.toolManager.setActiveTool('measure');
        break;
      case 'cmd.view.fit': {
        const bounds = Geometry.unionBounds(this.doc.entities);
        if (bounds) {
          this.transform.zoomToFit(bounds);
        } else {
          this.transform.resetView();
        }
        this.requestRender();
        break;
      }
      case 'cmd.undo':
        this.history.undo();
        this.requestRender();
        break;
      case 'cmd.redo':
        this.history.redo();
        this.requestRender();
        break;
      case 'cmd.cancel':
        this.toolManager.cancelActive();
        this.doc.clearSelection();
        this.toolManager.setActiveTool('select');
        this.requestRender();
        break;
      case 'cmd.toggle.snap':
        this.snapEngine.enabled = !this.snapEngine.enabled;
        this.requestRender();
        break;
      case 'cmd.toggle.ortho':
        this.snapEngine.orthoEnabled = !this.snapEngine.orthoEnabled;
        this.requestRender();
        break;
      case 'cmd.toggle.grid':
        this.grid.visible = !this.grid.visible;
        this.requestRender();
        break;
      case 'cmd.view.reset':
        this.transform.resetView();
        this.requestRender();
        break;
    }
  }

  private exposeGlobalApi() {
    const api = {
      execute: (cmd: string, args?: any) => this.execute(cmd, args),
      doc: this.doc,
      history: this.history,
    };
    (window as any).nanoDraft = api;
    (window as any).miniCad = api;
  }
}

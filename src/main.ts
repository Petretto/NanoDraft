import './style.css';
import { CadDocument } from './model/document';
import { HistoryManager } from './model/history';
import { ViewportTransform } from './math/transform';
import { CadGrid } from './engine/grid';
import { SnapEngine } from './engine/snap';
import { CadRenderer } from './engine/renderer';
import { ToolManager } from './tools/tool-manager';
import { ToolContext } from './tools/base-tool';
import { CommandDispatcher } from './commands/command-dispatcher';
import { DynamicHud } from './ui/hud';
import { Toolbar } from './ui/toolbar';
import { PropertyInspector } from './ui/inspector';
import { StatusBar } from './ui/status-bar';
import { TopBar } from './ui/top-bar';
import { JsonIO } from './io/json-io';
import { AutoSaveManager } from './io/auto-save';
import { PrintManager } from './io/print-pdf';
import { Point2D, SnapPoint } from './types/cad';
import { Geometry } from './math/geometry';

class NanoDraftApp {
  private doc: CadDocument;
  private history: HistoryManager;
  private transform: ViewportTransform;
  private grid: CadGrid;
  private snapEngine: SnapEngine;
  private renderer: CadRenderer;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hud: DynamicHud;
  private toolManager: ToolManager;

  private statusBar: StatusBar;
  private currentSnap: SnapPoint | null = null;
  private mouseScreenPos: Point2D | null = null;
  private currentWorldMousePos: Point2D | null = null;
  private isPanning: boolean = false;
  private isSpaceDown: boolean = false;
  private lastPanPoint: Point2D = { x: 0, y: 0 };

  constructor() {
    const appEl = document.getElementById('app')!;
    appEl.innerHTML = '';

    this.doc = new CadDocument();
    this.history = new HistoryManager();
    this.transform = new ViewportTransform(window.innerWidth, window.innerHeight);
    this.grid = new CadGrid();
    this.snapEngine = new SnapEngine();
    this.renderer = new CadRenderer();

    // 1. Build Top Bar
    new TopBar(this.doc, this.history, this.transform, appEl, () => this.requestRender());

    // 2. Build Workspace (Toolbar + Viewport + Inspector)
    const workspace = document.createElement('div');
    workspace.className = 'cad-workspace';
    appEl.appendChild(workspace);

    // 3. Build Bottom Status Bar (created before tools so setHint is immediately available)
    this.statusBar = new StatusBar(
      this.doc,
      this.transform,
      this.snapEngine,
      this.grid,
      appEl,
      () => this.requestRender()
    );

    // Viewport Container & Canvas
    const viewportContainer = document.createElement('div');
    viewportContainer.className = 'cad-viewport-container';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'cad-canvas';
    viewportContainer.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    // Dynamic HUD
    this.hud = new DynamicHud(viewportContainer);

    // Context for tools
    const toolContext: ToolContext = {
      doc: this.doc,
      history: this.history,
      transform: this.transform,
      hud: this.hud,
      snapEngine: this.snapEngine,
      getMouseScreen: () => this.mouseScreenPos,
      setHint: (hint: string) => {
        if (this.statusBar) this.statusBar.setHint(hint);
      },
      requestRender: () => this.requestRender(),
    };

    this.toolManager = new ToolManager(toolContext);

    // Left Toolbar
    new Toolbar(
      this.toolManager,
      this.doc,
      this.history,
      this.transform,
      workspace,
      () => this.requestRender()
    );

    // Viewport appended in center
    workspace.appendChild(viewportContainer);

    // Right Property Inspector
    new PropertyInspector(this.doc, this.history, workspace, () => this.requestRender(), this.transform);

    // 4. Command Dispatcher (Shortcuts & Stream Deck)
    new CommandDispatcher(
      this.toolManager,
      this.doc,
      this.history,
      this.snapEngine,
      this.grid,
      this.transform,
      () => this.requestRender(),
      () => this.currentWorldMousePos
    );

    this.setupViewportEvents(viewportContainer);
    this.setupSpaceKeyPan();
    this.setupShiftOrtho();
    this.setupUnsavedWarning();
    this.resizeCanvas();
    this.doc.resetToNew('mm');
    this.transform.resetView();
    window.addEventListener('resize', () => this.resizeCanvas());

    const params = new URLSearchParams(window.location.search);
    if (params.get('print_sheet')) {
      this.checkUrlPrintSheet();
    } else {
      // Restore previous auto-saved drawing if present, then enable live Auto-Save
      const restored = AutoSaveManager.restore(this.doc);
      if (restored) {
        const bounds = Geometry.unionBounds(this.doc.entities);
        if (bounds) {
          this.transform.zoomToFit(bounds);
        }
        this.statusBar.updateAutoSaveStatus({
          status: 'restored',
          savedAt: restored.savedAt,
          entityCount: restored.entities.length,
        });
        AutoSaveManager.showRestoreBanner(viewportContainer, restored, () => {
          this.doc.resetToNew('mm');
          this.history.clear();
          this.transform.resetView();
          this.requestRender();
        });
      }
      AutoSaveManager.attach(this.doc, (info) => {
        this.statusBar.updateAutoSaveStatus(info);
      });
    }

    this.requestRender();
  }

  private async checkUrlPrintSheet() {
    const params = new URLSearchParams(window.location.search);
    const sheetName = params.get('print_sheet');
    if (!sheetName) return;

    try {
      let resp = await fetch(`/Projects/${sheetName}.nanodraft`);
      if (!resp.ok) {
        resp = await fetch(`/Projects/${sheetName}.minicad`);
      }
      if (!resp.ok) return;
      const jsonText = await resp.text();
      if (!JsonIO.loadFromJson(jsonText, this.doc)) return;

      // Preload any ImageEntity logos before rendering print sheet
      for (const ent of this.doc.entities) {
        if (ent.type === 'image' && ent.dataUrl) {
          await new Promise<void>(resolve => {
            const img = CadRenderer.getCachedImage(ent.dataUrl, () => resolve());
            if (img) resolve();
            else setTimeout(resolve, 150);
          });
        }
      }

      const canvas = PrintManager.renderSheetToCanvas(this.doc, {
        paperSize: 'A3',
        orientation: 'landscape',
        scale: 'fit',
        invertColors: true,
        showTitleBlock: true,
        plotArea: 'extents',
      });
      const dataUrl = canvas.toDataURL('image/png');
      document.head.insertAdjacentHTML(
        'beforeend',
        `<style>
          @page { size: A3 landscape; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; width: 100%; height: 100%; overflow: hidden; }
        </style>`
      );
      document.body.innerHTML = `<img src="${dataUrl}" style="width:100vw; height:100vh; object-fit:contain; display:block;" />`;
    } catch (e) {
      console.error(e);
    }
  }

  private setupSpaceKeyPan() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.isSpaceDown) {
        if (
          !(document.activeElement instanceof HTMLInputElement) &&
          !(document.activeElement instanceof HTMLTextAreaElement)
        ) {
          this.isSpaceDown = true;
          this.canvas.style.cursor = 'grab';
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpaceDown = false;
        this.canvas.style.cursor = 'none';
      }
    });
  }

  private setupShiftOrtho() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift' && !this.snapEngine.isShiftOrthoActive) {
        this.snapEngine.isShiftOrthoActive = true;
        this.statusBar?.updateToggles();
        this.requestRender();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        this.snapEngine.isShiftOrthoActive = false;
        this.statusBar?.updateToggles();
        this.requestRender();
      }
    });
  }

  private setupUnsavedWarning() {
    window.addEventListener('beforeunload', (e) => {
      if (this.doc.isDirty && this.doc.entities.length > 0) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }

  private setupViewportEvents(container: HTMLElement) {
    // Prevent context menu on canvas for middle/right click CAD navigation
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
      const screenPt: Point2D = { x: e.offsetX, y: e.offsetY };

      // Middle button OR Space+LMB -> Start Pan (double middle click -> Zoom to Fit)
      if (e.button === 1 || (e.button === 0 && this.isSpaceDown)) {
        if (e.button === 1 && e.detail === 2) {
          const bounds = Geometry.unionBounds(this.doc.entities);
          if (bounds) {
            this.transform.zoomToFit(bounds);
          } else {
            this.transform.resetView();
          }
          this.requestRender();
          return;
        }
        this.isPanning = true;
        this.lastPanPoint = screenPt;
        this.canvas.style.cursor = 'grabbing';
        return;
      }

      // Right Click (button === 2) -> Cancel active action / clear selection (AutoCAD standard)
      if (e.button === 2) {
        e.preventDefault();
        this.toolManager.cancelActive();
        this.doc.clearSelection();
        this.toolManager.setActiveTool('select');
        this.requestRender();
        return;
      }

      if (e.button === 0) {
        const worldPt = this.transform.screenToWorld(screenPt);
        this.toolManager.onMouseDown(e, worldPt, this.currentSnap);
        this.requestRender();
      }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const screenPt: Point2D = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (this.isPanning) {
        const dx = screenPt.x - this.lastPanPoint.x;
        const dy = screenPt.y - this.lastPanPoint.y;
        this.transform.pan(dx, dy);
        this.lastPanPoint = screenPt;
        this.requestRender();
        return;
      }

      const isInside =
        screenPt.x >= 0 &&
        screenPt.x <= this.canvas.clientWidth &&
        screenPt.y >= 0 &&
        screenPt.y <= this.canvas.clientHeight;

      if (!isInside) {
        this.mouseScreenPos = null;
        this.currentSnap = null;
        this.requestRender();
        return;
      }

      this.mouseScreenPos = screenPt;
      const worldPt = this.transform.screenToWorld(screenPt);
      this.currentWorldMousePos = worldPt;

      // Detect OSNAP (pass active tool's reference/base point for Perpendicular & Tangent snaps)
      const fromPt = this.toolManager.getActiveTool().getBasePoint();
      this.currentSnap = this.snapEngine.findSnapPoint(
        screenPt,
        this.doc,
        this.transform,
        this.grid,
        fromPt
      );

      // Status bar coordinate update
      const activeWorldPt = this.currentSnap ? this.currentSnap.point : worldPt;
      this.statusBar.updateCursorCoords(activeWorldPt);

      // Dispatch to active tool
      this.toolManager.onMouseMove(e, worldPt, this.currentSnap);
      this.requestRender();
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = this.isSpaceDown ? 'grab' : 'none';
        return;
      }

      if (e.button === 0) {
        const rect = this.canvas.getBoundingClientRect();
        const screenPt: Point2D = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        const worldPt = this.transform.screenToWorld(screenPt);
        this.toolManager.onMouseUp(e, worldPt, this.currentSnap);
        this.requestRender();
      }
    });

    // Zoom on wheel (centered on cursor)
    container.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const cursorScreen: Point2D = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };

        const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.transform.zoomAt(cursorScreen, zoomFactor);

        const worldPt = this.transform.screenToWorld(cursorScreen);
        this.statusBar.updateCursorCoords(worldPt);
        this.requestRender();
      },
      { passive: false }
    );
  }

  private resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);

    this.transform.setScreenSize(width, height);
    this.requestRender();
  }

  private requestRender() {
    requestAnimationFrame(() => {
      this.renderer.render(
        this.ctx,
        this.doc,
        this.transform,
        this.grid,
        this.snapEngine,
        this.currentSnap,
        this.mouseScreenPos,
        this.toolManager.getPreview(),
        this.toolManager.getSelectionBox()
      );
    });
  }
}

// Start application
new NanoDraftApp();

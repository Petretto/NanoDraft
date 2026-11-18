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
import { LispIntegration } from './io/lisp-gen';
import { LayersModal } from './ui/layers-modal';
import { BomManager } from './ui/bom-modal';
import { UnderlayManager } from './ui/underlay-modal';
import { svgIcon } from './ui/icons';
import { i18n, tr } from './i18n/lang';
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

    // Viewport Wrapper (Canvas + Overlays + Dockable Command Line)
    const viewportWrapper = document.createElement('div');
    viewportWrapper.className = 'cad-viewport-wrapper';

    const viewportContainer = document.createElement('div');
    viewportContainer.className = 'cad-viewport-container';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'cad-canvas';
    viewportContainer.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    // Dynamic HUD
    this.hud = new DynamicHud(viewportContainer);
    this.statusBar.attachHud(this.hud);

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

    // Top-Left & Top-Right Floating Viewport Overlays
    this.setupViewportOverlays(viewportContainer);

    // Dockable AutoCAD-style Command Bar at bottom of Viewport
    const commandDock = this.createCommandDock(toolContext);

    viewportWrapper.appendChild(viewportContainer);
    viewportWrapper.appendChild(commandDock);

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
    workspace.appendChild(viewportWrapper);

    // Right Property Inspector
    new PropertyInspector(this.doc, this.history, workspace, () => this.requestRender(), this.transform, this.toolManager);

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

  private setupViewportOverlays(viewportContainer: HTMLElement) {
    // 1. Top-Left UCS / Fit / Origin Overlay
    const topLeft = document.createElement('div');
    topLeft.className = 'viewport-top-left-overlay';
    topLeft.addEventListener('mousedown', e => e.stopPropagation());

    const renderTopLeft = () => {
      topLeft.innerHTML = `
        <button type="button" id="vp-fit-btn" class="vp-overlay-btn" title="${tr('Dopasuj wszystko (Zoom Extents) [Z / 2x ŚPM]', 'Zoom Extents [Z / Double MMB]')}">
          ${svgIcon('zoom_out_map', 14)}
          <span>${tr('Dopasuj [Z]', 'Fit [Z]')}</span>
        </button>
        <div class="vp-overlay-sep"></div>
        <button type="button" id="vp-origin-btn" class="vp-overlay-btn" title="${tr('Początek układu współrzędnych (0,0) [Home]', 'Origin (0,0) [Home]')}">
          ${svgIcon('my_location', 14)}
          <span>(0, 0)</span>
        </button>
        <div class="vp-overlay-sep"></div>
        <span class="vp-overlay-btn cyan" style="cursor:default;">
          ${tr('Widok: Z Góry (2D)', 'View: Top (2D)')}
        </span>
      `;

      topLeft.querySelector('#vp-fit-btn')?.addEventListener('click', () => {
        const bounds = Geometry.unionBounds(this.doc.entities);
        if (bounds) {
          this.transform.zoomToFit(bounds);
        } else {
          this.transform.resetView();
        }
        this.requestRender();
      });

      topLeft.querySelector('#vp-origin-btn')?.addEventListener('click', () => {
        this.transform.resetView();
        this.requestRender();
      });
    };

    renderTopLeft();
    viewportContainer.appendChild(topLeft);

    // 2. Top-Right Quick Stats Strip
    const topRight = document.createElement('div');
    topRight.className = 'viewport-top-right-overlay';
    topRight.addEventListener('mousedown', e => e.stopPropagation());

    const renderTopRight = () => {
      topRight.innerHTML = `
        <div style="display:flex; align-items:center; gap:5px;">
          <span style="color:#94A3B8;">${tr('Skala:', 'Scale:')}</span>
          <strong style="color:#ffffff;">1:1</strong>
        </div>
        <div class="vp-overlay-sep"></div>
        <div style="display:flex; align-items:center; gap:5px;">
          <span style="color:#94A3B8;">${tr('Elementów:', 'Entities:')}</span>
          <strong style="color:#00E5FF;">${this.doc.entities.length}</strong>
        </div>
      `;
    };

    renderTopRight();
    viewportContainer.appendChild(topRight);

    this.doc.addChangeListener(() => renderTopRight());
    i18n.onChange(() => {
      renderTopLeft();
      renderTopRight();
    });
  }

  private createCommandDock(toolContext: ToolContext): HTMLElement {
    const dock = document.createElement('div');
    dock.className = 'cad-command-dock';

    const renderDock = () => {
      dock.innerHTML = `
        <span class="cmd-dock-label">${tr('POLECENIE:', 'COMMAND:')}</span>
        <input
          id="cad-cmd-line-input"
          type="text"
          class="cmd-dock-input"
          placeholder="${tr(
            'Wpisz komendę CAD (np. LINE, TRIM, OFFSET, DIST, BOM, X,Y lub @dx,dy) i naciśnij Enter...',
            'Type CAD command (e.g. LINE, TRIM, OFFSET, DIST, BOM, X,Y or @dx,dy) and press Enter...'
          )}"
        />
        <div class="cmd-dock-hints">
          <span class="cmd-kbd">Enter ↵</span>
          <span>${tr('zatwierdza', 'execute')}</span>
          <span class="cmd-kbd" style="margin-left:4px;">Esc</span>
          <span>${tr('anuluje', 'cancel')}</span>
        </div>
      `;

      const inp = dock.querySelector('#cad-cmd-line-input') as HTMLInputElement;
      inp?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          inp.value = '';
          inp.blur();
          this.toolManager.cancelActive();
          this.doc.clearSelection();
          this.toolManager.setActiveTool('select');
          this.requestRender();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const raw = inp.value.trim();
          inp.value = '';
          if (!raw) return;
          this.handleCommandLineInput(raw, toolContext);
        }
      });
    };

    renderDock();
    i18n.onChange(() => renderDock());
    return dock;
  }

  private handleCommandLineInput(raw: string, toolContext: ToolContext) {
    // 1. AutoLISP expression
    if (raw.startsWith('(')) {
      const msg = LispIntegration.runLisp(raw, this.doc);
      this.statusBar.setHint(msg);
      this.requestRender();
      return;
    }

    // 2. Relative coordinate @dx,dy or absolute coordinate X,Y
    const relMatch = raw.match(/^@([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
    if (relMatch) {
      const base = this.toolManager.getActiveTool().getBasePoint() || { x: 0, y: 0 };
      const pt: Point2D = {
        x: base.x + parseFloat(relMatch[1]),
        y: base.y + parseFloat(relMatch[2]),
      };
      this.toolManager.onMouseDown(new MouseEvent('mousedown', { button: 0 }), pt, null);
      this.requestRender();
      return;
    }

    const absMatch = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
    if (absMatch) {
      const pt: Point2D = {
        x: parseFloat(absMatch[1]),
        y: parseFloat(absMatch[2]),
      };
      this.toolManager.onMouseDown(new MouseEvent('mousedown', { button: 0 }), pt, null);
      this.requestRender();
      return;
    }

    // 3. Named CAD command
    const cmd = raw.toUpperCase().replace(/^_/, '');
    const map: Record<string, string> = {
      S: 'select', SELECT: 'select',
      Q: 'measure', DIST: 'measure', MEASURE: 'measure', AREA: 'measure',
      L: 'line', LINE: 'line',
      W: 'polyline', PL: 'polyline', PLINE: 'polyline', POLYLINE: 'polyline',
      R: 'rect', REC: 'rect', RECT: 'rect', RECTANGLE: 'rect',
      C: 'circle', CIRCLE: 'circle',
      A: 'arc', ARC: 'arc',
      U: 'polygon', SLOT: 'polygon', POLYGON: 'polygon', POLY: 'polygon',
      P: 'point', POINT: 'point',
      H: 'hatch', HATCH: 'hatch',
      M: 'move', MOVE: 'move',
      K: 'copy', CO: 'copy', COPY: 'copy',
      O: 'rotate', RO: 'rotate', ROTATE: 'rotate',
      I: 'mirror', MI: 'mirror', MIRROR: 'mirror',
      V: 'scale', SC: 'scale', SCALE: 'scale',
      F: 'offset', OFFSET: 'offset',
      Y: 'array', AR: 'array', ARRAY: 'array',
      G: 'fillet', FILLET: 'fillet', CHAMFER: 'fillet',
      X: 'trim', TR: 'trim', TRIM: 'trim', EX: 'trim', EXTEND: 'trim',
      J: 'match-props', MA: 'match-props', MATCHPROP: 'match-props',
      D: 'dimension', DIM: 'dimension',
      N: 'leader', LE: 'leader', LEADER: 'leader',
      T: 'text', TEXT: 'text', MTEXT: 'text',
    };

    if (map[cmd]) {
      this.toolManager.setActiveTool(map[cmd]);
      this.requestRender();
      return;
    }

    if (cmd === 'E' || cmd === 'EXPLODE') {
      this.doc.explodeSelected(this.history);
      this.requestRender();
    } else if (cmd === 'Z' || cmd === 'ZOOM' || cmd === 'FIT') {
      const bounds = Geometry.unionBounds(this.doc.entities);
      if (bounds) this.transform.zoomToFit(bounds);
      else this.transform.resetView();
      this.requestRender();
    } else if (cmd === 'UNDO') {
      this.history.undo();
      this.requestRender();
    } else if (cmd === 'REDO') {
      this.history.redo();
      this.requestRender();
    } else if (cmd === 'BOM') {
      BomManager.openModal(this.doc, this.history, this.transform, () => this.requestRender());
    } else if (cmd === 'LA' || cmd === 'LAYER' || cmd === 'LAYERS') {
      LayersModal.open(this.doc, () => this.requestRender());
    } else if (cmd === 'UNDERLAY' || cmd === 'IMAGE') {
      UnderlayManager.openModal(this.doc, this.history, this.transform, () => this.requestRender());
    } else if (cmd === 'PRINT' || cmd === 'PLOT' || cmd === 'PDF') {
      PrintManager.openModal(this.doc, this.transform, this.history, () => this.requestRender());
    } else {
      toolContext.setHint(tr(`Nieznane polecenie: ${raw}`, `Unknown command: ${raw}`));
    }
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
      if (e.key === 'F12') {
        e.preventDefault();
        this.hud.setEnabled(!this.hud.enabled);
        this.statusBar?.updateToggles();
        this.requestRender();
        return;
      }
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

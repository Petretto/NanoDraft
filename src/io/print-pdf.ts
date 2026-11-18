import { CadDocument } from '../model/document';
import { HistoryManager } from '../model/history';
import { ViewportTransform, UNIT_SCALE_TO_MM } from '../math/transform';
import { CadRenderer } from '../engine/renderer';
import { CadGrid } from '../engine/grid';
import { SnapEngine } from '../engine/snap';
import { Geometry, Bounds } from '../math/geometry';
import { VectorMath } from '../math/vector';
import { TitleBlockManager } from '../ui/title-block-modal';
import { tr } from '../i18n/lang';

export type PaperFormatId =
  | 'A4'
  | 'A3'
  | 'A2'
  | 'A1'
  | 'A0'
  | 'A5'
  | 'B4'
  | 'B3'
  | 'Letter'
  | 'Tabloid';

export interface PaperFormatSpec {
  id: PaperFormatId;
  labelPl: string;
  labelEn: string;
  widthMm: number;  // shorter side in portrait (mm)
  heightMm: number; // longer side in portrait (mm)
  cssPageSize: string;
}

export const PAPER_FORMATS: PaperFormatSpec[] = [
  { id: 'A4', labelPl: 'ISO A4 (210 × 297 mm)', labelEn: 'ISO A4 (210 × 297 mm)', widthMm: 210, heightMm: 297, cssPageSize: 'A4' },
  { id: 'A3', labelPl: 'ISO A3 (297 × 420 mm)', labelEn: 'ISO A3 (297 × 420 mm)', widthMm: 297, heightMm: 420, cssPageSize: 'A3' },
  { id: 'A2', labelPl: 'ISO A2 (420 × 594 mm)', labelEn: 'ISO A2 (420 × 594 mm)', widthMm: 420, heightMm: 594, cssPageSize: '420mm 594mm' },
  { id: 'A1', labelPl: 'ISO A1 (594 × 841 mm)', labelEn: 'ISO A1 (594 × 841 mm)', widthMm: 594, heightMm: 841, cssPageSize: '594mm 841mm' },
  { id: 'A0', labelPl: 'ISO A0 (841 × 1189 mm)', labelEn: 'ISO A0 (841 × 1189 mm)', widthMm: 841, heightMm: 1189, cssPageSize: '841mm 1189mm' },
  { id: 'A5', labelPl: 'ISO A5 (148 × 210 mm)', labelEn: 'ISO A5 (148 × 210 mm)', widthMm: 148, heightMm: 210, cssPageSize: 'A5' },
  { id: 'B4', labelPl: 'ISO B4 (250 × 353 mm)', labelEn: 'ISO B4 (250 × 353 mm)', widthMm: 250, heightMm: 353, cssPageSize: '250mm 353mm' },
  { id: 'B3', labelPl: 'ISO B3 (353 × 500 mm)', labelEn: 'ISO B3 (353 × 500 mm)', widthMm: 353, heightMm: 500, cssPageSize: '353mm 500mm' },
  { id: 'Letter', labelPl: 'ANSI Letter (216 × 279 mm)', labelEn: 'ANSI Letter (216 × 279 mm)', widthMm: 216, heightMm: 279, cssPageSize: 'letter' },
  { id: 'Tabloid', labelPl: 'ANSI Tabloid / Ledger (279 × 432 mm)', labelEn: 'ANSI Tabloid / Ledger (279 × 432 mm)', widthMm: 279, heightMm: 432, cssPageSize: 'ledger' },
];

export type PrintScaleOption =
  | 'fit'
  | '1:1'
  | '1:2'
  | '1:5'
  | '1:10'
  | '1:20'
  | '1:25'
  | '1:50'
  | '1:100'
  | '1:200'
  | '1:500'
  | '2:1'
  | '5:1';

export type PlotAreaMode = 'extents' | 'window' | 'display';

export interface PrintOptions {
  paperSize: PaperFormatId;
  orientation: 'landscape' | 'portrait';
  scale: PrintScaleOption;
  invertColors: boolean;
  showTitleBlock: boolean;
  plotArea?: PlotAreaMode;
  windowBounds?: Bounds;
}

export class PrintManager {
  private static savedWindowBounds: Bounds | null = null;
  private static savedOptions: Partial<PrintOptions> = {};

  static openModal(
    doc: CadDocument,
    transform: ViewportTransform,
    history?: HistoryManager,
    requestRender?: () => void
  ) {
    const existing = document.getElementById('cad-print-modal-overlay');
    if (existing) existing.remove();

    // Ensure logo image (if any) is preloaded into cache
    TitleBlockManager.loadTemplate();

    const curFormat = this.savedOptions.paperSize || 'A4';
    const curOrient = this.savedOptions.orientation || 'landscape';
    const curScale = this.savedOptions.scale || 'fit';
    const curInvert = this.savedOptions.invertColors !== undefined ? this.savedOptions.invertColors : true;
    const curShowTb = this.savedOptions.showTitleBlock !== undefined ? this.savedOptions.showTitleBlock : true;
    const curPlotArea: PlotAreaMode = this.savedOptions.plotArea || (this.savedWindowBounds ? 'window' : 'extents');

    const overlay = document.createElement('div');
    overlay.id = 'cad-print-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    const scaleOptions: { val: PrintScaleOption; labelPl: string; labelEn: string }[] = [
      { val: 'fit', labelPl: 'Dopasuj do arkusza (Fit to Page)', labelEn: 'Fit to Page (Auto-scale)' },
      { val: '1:1', labelPl: '1:1 (Skala rzeczywista)', labelEn: '1:1 (Full scale)' },
      { val: '1:2', labelPl: '1:2', labelEn: '1:2' },
      { val: '1:5', labelPl: '1:5', labelEn: '1:5' },
      { val: '1:10', labelPl: '1:10', labelEn: '1:10' },
      { val: '1:20', labelPl: '1:20', labelEn: '1:20' },
      { val: '1:25', labelPl: '1:25', labelEn: '1:25' },
      { val: '1:50', labelPl: '1:50 (Architektura / Hala)', labelEn: '1:50 (Architectural / Hall)' },
      { val: '1:100', labelPl: '1:100 (Plan hali / Budynek)', labelEn: '1:100 (Floor plan / Building)' },
      { val: '1:200', labelPl: '1:200', labelEn: '1:200' },
      { val: '1:500', labelPl: '1:500', labelEn: '1:500' },
      { val: '2:1', labelPl: '2:1 (Powiększenie 2x)', labelEn: '2:1 (Enlarged 2x)' },
      { val: '5:1', labelPl: '5:1 (Powiększenie 5x)', labelEn: '5:1 (Enlarged 5x)' },
    ];

    const winLabel = this.savedWindowBounds
      ? `(${VectorMath.round(this.savedWindowBounds.maxX - this.savedWindowBounds.minX, 1)} × ${VectorMath.round(this.savedWindowBounds.maxY - this.savedWindowBounds.minY, 1)} ${doc.unit})`
      : '';

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 660px; max-width: 96vw;">
        <div class="modal-header">
          <h3>🖨️ ${tr('Ustawienia Wydruku / PDF oraz Podgląd z Tabelką', 'Print / PDF Settings & Title Block Preview')}</h3>
          <button class="modal-close-btn" id="print-modal-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:10px; max-height:82vh; overflow-y:auto;">

          <!-- Plot Area (Extents / Window / Display) - ZWCAD/AutoCAD style -->
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; background:rgba(0, 229, 255, 0.06); border:1px solid var(--border-color); border-radius:6px; padding:8px 10px;">
            <div class="prop-row" style="flex:1; margin:0;">
              <span style="font-weight:600; color:var(--text-main);">${tr('Obszar wydruku:', 'Plot Area:')}</span>
              <select id="print-area-select" class="prop-input" style="width: 245px; text-align:left;">
                <option value="extents" ${curPlotArea === 'extents' ? 'selected' : ''}>📐 ${tr('Cały rysunek (Zakres / Extents)', 'All Entities (Extents)')}</option>
                <option value="window" ${curPlotArea === 'window' ? 'selected' : ''}>🔲 ${tr('Okno — wskazany prostokąt (Window)', 'Window — Picked Rectangle')} ${winLabel}</option>
                <option value="display" ${curPlotArea === 'display' ? 'selected' : ''}>🖥️ ${tr('Aktualny widok ekranu (Display)', 'Current Screen View (Display)')}</option>
              </select>
            </div>
            <button class="top-btn highlight" id="print-pick-window-btn" type="button" title="${tr('Wskaż myszką na rysunku prostokątny obszar (Okno), który ma zostać wydrukowany', 'Click two corners on the drawing to define the rectangular Print Window')}">
              🔲 ${tr('Wskaż Okno na rysunku...', 'Pick Window on Drawing...')}
            </button>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div class="prop-row">
              <span>${tr('Format arkusza:', 'Paper Format:')}</span>
              <select id="print-format-select" class="prop-input" style="width: 175px; text-align:left;">
                ${PAPER_FORMATS.map(
                  f => `<option value="${f.id}" ${f.id === curFormat ? 'selected' : ''}>${tr(f.labelPl, f.labelEn)}</option>`
                ).join('')}
              </select>
            </div>

            <div class="prop-row">
              <span>${tr('Orientacja:', 'Orientation:')}</span>
              <select id="print-orientation-select" class="prop-input" style="width: 175px; text-align:left;">
                <option value="landscape" ${curOrient === 'landscape' ? 'selected' : ''}>${tr('Pozioma (Landscape)', 'Landscape (Horizontal)')}</option>
                <option value="portrait" ${curOrient === 'portrait' ? 'selected' : ''}>${tr('Pionowa (Portrait)', 'Portrait (Vertical)')}</option>
              </select>
            </div>

            <div class="prop-row">
              <span>${tr('Skala wydruku:', 'Print Scale:')}</span>
              <select id="print-scale-select" class="prop-input" style="width: 175px; text-align:left;">
                ${scaleOptions
                  .map(s => `<option value="${s.val}" ${s.val === curScale ? 'selected' : ''}>${tr(s.labelPl, s.labelEn)}</option>`)
                  .join('')}
              </select>
            </div>

            <div class="prop-row">
              <span>${tr('Tryb kolorów:', 'Color Mode:')}</span>
              <select id="print-color-select" class="prop-input" style="width: 175px; text-align:left;">
                <option value="bw" ${curInvert ? 'selected' : ''}>${tr('Czarno-biały (Techniczny)', 'Monochrome (B&W)')}</option>
                <option value="color" ${!curInvert ? 'selected' : ''}>${tr('Kolorowy (Warstwy)', 'Color (Layers)')}</option>
              </select>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div class="prop-row" style="flex:1; margin:0;">
              <span>${tr('Tabliczka i ramka:', 'Border & Title Block:')}</span>
              <select id="print-titleblock-select" class="prop-input" style="width: 230px; text-align:left;">
                <option value="yes" ${curShowTb ? 'selected' : ''}>${tr('Tak (Ramka + Tabliczka rysunkowa)', 'Yes (Border + Title Block)')}</option>
                <option value="no" ${!curShowTb ? 'selected' : ''}>${tr('Nie (Tylko czysty rysunek)', 'No (Drawing Only)')}</option>
              </select>
            </div>
            <button class="top-btn" id="print-edit-tb-btn" type="button">
              📋 ${tr('Edytuj tabliczkę / logo...', 'Edit Title Block / Logo...')}
            </button>
          </div>

          <!-- Live Print Sheet Preview with Title Block -->
          <div style="display:flex; flex-direction:column; gap:4px; margin-top:2px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:11px; font-weight:600; color:var(--text-muted);">
                👁️ ${tr('Podgląd wydruku z tabelką (na żywo):', 'Live Print Preview with Title Block:')}
              </span>
              <span id="print-preview-info" style="font-size:11px; color:var(--accent-color); font-family:var(--font-mono);"></span>
            </div>
            <div style="background:#141518; border:1px solid var(--border-color); border-radius:6px; padding:12px; display:flex; justify-content:center; align-items:center; min-height:270px;">
              <div id="print-preview-holder" style="display:flex; justify-content:center; align-items:center; box-shadow:0 6px 20px rgba(0,0,0,0.65);"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="gap: 8px;">
          <button class="top-btn" id="print-cancel-btn">${tr('Anuluj', 'Cancel')}</button>
          <button class="top-btn highlight" id="print-confirm-btn">🖨️ ${tr('Drukuj / Zapisz PDF', 'Print / Save PDF')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const readOptions = (): PrintOptions => {
      const paperSize = (overlay.querySelector('#print-format-select') as HTMLSelectElement).value as PaperFormatId;
      const orientation = (overlay.querySelector('#print-orientation-select') as HTMLSelectElement).value as 'landscape' | 'portrait';
      const scale = (overlay.querySelector('#print-scale-select') as HTMLSelectElement).value as PrintScaleOption;
      const colorMode = (overlay.querySelector('#print-color-select') as HTMLSelectElement).value;
      const titleBlock = (overlay.querySelector('#print-titleblock-select') as HTMLSelectElement).value;
      const plotArea = (overlay.querySelector('#print-area-select') as HTMLSelectElement).value as PlotAreaMode;

      const opts: PrintOptions = {
        paperSize,
        orientation,
        scale,
        invertColors: colorMode === 'bw',
        showTitleBlock: titleBlock === 'yes',
        plotArea,
        windowBounds: this.savedWindowBounds || undefined,
      };
      this.savedOptions = { ...opts };
      return opts;
    };

    const updatePreview = () => {
      const opts = readOptions();
      if (opts.plotArea === 'window' && !this.savedWindowBounds) {
        // Prompt user to pick window on canvas immediately
        startWindowPicker();
        return;
      }

      const spec = PAPER_FORMATS.find(f => f.id === opts.paperSize) || PAPER_FORMATS[0];
      const isLandscape = opts.orientation === 'landscape';
      const wMm = isLandscape ? spec.heightMm : spec.widthMm;
      const hMm = isLandscape ? spec.widthMm : spec.heightMm;
      const areaText =
        opts.plotArea === 'window'
          ? tr('Okno', 'Window')
          : opts.plotArea === 'display'
          ? tr('Widok ekranu', 'Display')
          : tr('Cały rysunek', 'Extents');

      const infoEl = overlay.querySelector('#print-preview-info');
      if (infoEl) {
        infoEl.textContent = `${opts.paperSize} (${wMm}×${hMm} mm) • ${areaText} • ${opts.scale === 'fit' ? tr('Dopasowano', 'Fit') : opts.scale}`;
      }

      const previewCanvas = this.renderSheetToCanvas(doc, opts, 540, transform);
      previewCanvas.style.maxWidth = '100%';
      previewCanvas.style.maxHeight = '300px';
      previewCanvas.style.height = 'auto';
      previewCanvas.style.width = 'auto';
      previewCanvas.style.display = 'block';

      const holder = overlay.querySelector('#print-preview-holder');
      if (holder) {
        holder.innerHTML = '';
        holder.appendChild(previewCanvas);
      }
    };

    const close = () => overlay.remove();

    const startWindowPicker = () => {
      readOptions();
      close();
      this.pickWindowOnCanvas(doc, transform, (bounds) => {
        if (bounds) {
          this.savedWindowBounds = bounds;
          this.savedOptions.plotArea = 'window';
        }
        this.openModal(doc, transform, history, requestRender);
      });
    };

    updatePreview();

    overlay.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', () => updatePreview());
    });

    overlay.querySelector('#print-pick-window-btn')?.addEventListener('click', () => {
      startWindowPicker();
    });

    overlay.querySelector('#print-modal-close')?.addEventListener('click', close);
    overlay.querySelector('#print-cancel-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#print-edit-tb-btn')?.addEventListener('click', () => {
      readOptions();
      close();
      TitleBlockManager.openModal(
        doc,
        history || new HistoryManager(),
        transform,
        requestRender || (() => {})
      );
    });

    overlay.querySelector('#print-confirm-btn')?.addEventListener('click', () => {
      const opts = readOptions();
      close();
      PrintManager.printDrawing(doc, transform, opts);
    });
  }

  /**
   * Interactive 2-corner Window Picker on the CAD viewport (ZWCAD / AutoCAD "Okno / Window" print region).
   */
  private static pickWindowOnCanvas(
    doc: CadDocument,
    transform: ViewportTransform,
    onDone: (bounds: Bounds | null) => void
  ) {
    const viewport = document.querySelector('.cad-viewport-container') as HTMLElement;
    if (!viewport) {
      onDone(null);
      return;
    }

    const pickerCanvas = document.createElement('canvas');
    pickerCanvas.width = viewport.clientWidth;
    pickerCanvas.height = viewport.clientHeight;
    pickerCanvas.style.cssText = 'position:absolute; inset:0; z-index:40; cursor:crosshair;';
    viewport.appendChild(pickerCanvas);

    const banner = document.createElement('div');
    banner.className = 'cad-dim-mode-bar';
    banner.style.zIndex = '45';
    banner.innerHTML = `
      <span class="dim-bar-title" style="color:var(--accent-yellow);">
        🔲 ${tr('OBSZAR WYDRUKU (OKNO): Kliknij 1. narożnik, a następnie 2. narożnik prostokąta wydruku', 'PRINT WINDOW: Click 1st corner, then 2nd corner of the print window')}
      </span>
      <button type="button" class="top-btn" id="win-picker-cancel">${tr('Anuluj (Esc)', 'Cancel (Esc)')}</button>
    `;
    viewport.appendChild(banner);

    const ctx = pickerCanvas.getContext('2d')!;
    let corner1World: { x: number; y: number } | null = null;
    let currentScreen: { x: number; y: number } | null = null;

    const drawOverlay = () => {
      ctx.clearRect(0, 0, pickerCanvas.width, pickerCanvas.height);
      if (!currentScreen) return;

      // Crosshair
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 235, 59, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, currentScreen.y);
      ctx.lineTo(pickerCanvas.width, currentScreen.y);
      ctx.moveTo(currentScreen.x, 0);
      ctx.lineTo(currentScreen.x, pickerCanvas.height);
      ctx.stroke();

      if (corner1World) {
        const s1 = transform.worldToScreen(corner1World);
        const x = Math.min(s1.x, currentScreen.x);
        const y = Math.min(s1.y, currentScreen.y);
        const w = Math.abs(currentScreen.x - s1.x);
        const h = Math.abs(currentScreen.y - s1.y);

        ctx.fillStyle = 'rgba(0, 229, 255, 0.14)';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        const wWorld = transform.screenToWorld(currentScreen);
        const dw = VectorMath.round(Math.abs(wWorld.x - corner1World.x), 1);
        const dh = VectorMath.round(Math.abs(wWorld.y - corner1World.y), 1);
        ctx.setLineDash([]);
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`🔲 ${dw} × ${dh} ${doc.unit}`, x + 6, Math.max(16, y - 6));
      }
      ctx.restore();
    };

    const cleanup = () => {
      window.removeEventListener('keydown', onKeyDown, true);
      pickerCanvas.remove();
      banner.remove();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        onDone(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    banner.querySelector('#win-picker-cancel')?.addEventListener('click', () => {
      cleanup();
      onDone(null);
    });

    pickerCanvas.addEventListener('mousemove', e => {
      const rect = pickerCanvas.getBoundingClientRect();
      currentScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      drawOverlay();
    });

    pickerCanvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const rect = pickerCanvas.getBoundingClientRect();
      const sPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const wPt = transform.screenToWorld(sPt);

      if (!corner1World) {
        corner1World = wPt;
        currentScreen = sPt;
        drawOverlay();
      } else {
        const minX = Math.min(corner1World.x, wPt.x);
        const maxX = Math.max(corner1World.x, wPt.x);
        const minY = Math.min(corner1World.y, wPt.y);
        const maxY = Math.max(corner1World.y, wPt.y);
        cleanup();
        if (maxX - minX > 1e-3 && maxY - minY > 1e-3) {
          onDone({ minX, minY, maxX, maxY });
        } else {
          onDone(null);
        }
      }
    });
  }

  /**
   * Renders the full sheet (CAD drawing + border + title block) onto an HTMLCanvasElement.
   * Used both for the live modal preview (maxCanvasSide ~ 540) and final 300 DPI print/PDF (maxCanvasSide = 4200).
   */
  static renderSheetToCanvas(
    doc: CadDocument,
    options: PrintOptions,
    maxCanvasSide: number = 4200,
    viewportTransform?: ViewportTransform
  ): HTMLCanvasElement {
    const spec = PAPER_FORMATS.find(f => f.id === options.paperSize) || PAPER_FORMATS[0];
    const isLandscape = options.orientation === 'landscape';
    const paperW_mm = isLandscape ? spec.heightMm : spec.widthMm;
    const paperH_mm = isLandscape ? spec.widthMm : spec.heightMm;

    const targetPxPerMm = Math.min(300 / 25.4, maxCanvasSide / Math.max(paperW_mm, paperH_mm));
    const canvasW = Math.max(100, Math.round(paperW_mm * targetPxPerMm));
    const canvasH = Math.max(100, Math.round(paperH_mm * targetPxPerMm));

    const printCanvas = document.createElement('canvas');
    printCanvas.width = canvasW;
    printCanvas.height = canvasH;
    const pctx = printCanvas.getContext('2d');
    if (!pctx) return printCanvas;

    pctx.fillStyle = '#ffffff';
    pctx.fillRect(0, 0, canvasW, canvasH);

    const hasCadTitleBlockLayer = doc.entities.some(e => {
      if (e.layerId !== 'title_block') return false;
      const l = doc.layers.find(lay => lay.id === 'title_block');
      return !l || l.visible;
    });
    const useEmbeddedCadTitleBlock =
      hasCadTitleBlockLayer && options.showTitleBlock && options.plotArea !== 'window';

    // Determine target world bounds based on plotArea ('extents' | 'window' | 'display')
    let bounds: Bounds;
    if (options.plotArea === 'window' && options.windowBounds) {
      bounds = options.windowBounds;
    } else if (options.plotArea === 'display' && viewportTransform) {
      const tl = viewportTransform.screenToWorld({ x: 0, y: 0 });
      const br = viewportTransform.screenToWorld({
        x: viewportTransform.screenWidth,
        y: viewportTransform.screenHeight,
      });
      bounds = {
        minX: Math.min(tl.x, br.x),
        maxX: Math.max(tl.x, br.x),
        minY: Math.min(tl.y, br.y),
        maxY: Math.max(tl.y, br.y),
      };
    } else {
      const visibleEntities = doc.entities.filter(e => {
        if (!useEmbeddedCadTitleBlock && e.layerId === 'title_block') return false;
        const l = doc.layers.find(lay => lay.id === e.layerId);
        return !l || l.visible;
      });
      bounds = Geometry.unionBounds(visibleEntities) || { minX: -50, maxX: 50, minY: -50, maxY: 50 };
    }

    const margin_mm = useEmbeddedCadTitleBlock ? 4 : 12;
    const marginPx = Math.round(margin_mm * targetPxPerMm);
    const usableW_mm = paperW_mm - margin_mm * 2;
    const usableH_mm = paperH_mm - margin_mm * 2;

    const drawingW_units = Math.max(bounds.maxX - bounds.minX, 1e-3);
    const drawingH_units = Math.max(bounds.maxY - bounds.minY, 1e-3);

    let scaleFactor: number; // canvas pixels per 1 model unit
    if (options.scale === 'fit') {
      const scaleX = (usableW_mm * 0.92 * targetPxPerMm) / drawingW_units;
      const scaleY = (usableH_mm * 0.88 * targetPxPerMm) / drawingH_units;
      scaleFactor = Math.min(scaleX, scaleY);
    } else {
      const parts = options.scale.split(':').map(Number);
      const scaleRatio = (parts[0] || 1) / (parts[1] || 1);
      const mmPerUnitOnPaper = UNIT_SCALE_TO_MM[doc.unit] * scaleRatio;
      scaleFactor = mmPerUnitOnPaper * targetPxPerMm;
    }

    const printTransform = new ViewportTransform(canvasW, canvasH);
    printTransform.zoom = scaleFactor;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    printTransform.panX = canvasW / 2 - centerX * scaleFactor;
    printTransform.panY = canvasH / 2 + centerY * scaleFactor;

    const printRenderer = new CadRenderer();
    printRenderer.fullScreenCrosshair = false;
    printRenderer.backgroundColor = '#ffffff';
    printRenderer.drawUCS = false;
    printRenderer.drawCircleCenterMarks = false; // Hide circle center crosshairs on printed output
    printRenderer.pixelScale = Math.max(canvasW / 1600, 0.75);

    const printGrid = new CadGrid();
    printGrid.visible = false;
    const dummySnap = new SnapEngine();

    const tbLayer = doc.layers.find(l => l.id === 'title_block');
    const prevTbVisible = tbLayer ? tbLayer.visible : true;
    if (tbLayer && !useEmbeddedCadTitleBlock) {
      tbLayer.visible = false;
    }

    const originalColors = doc.entities.map(e => ({ id: e.id, color: e.color }));
    if (options.invertColors) {
      for (const e of doc.entities) {
        e.color = '#000000';
      }
    }

    pctx.save();
    // Clip to inner frame (or to the exact picked window rectangle when plotArea === 'window')
    if (options.plotArea === 'window' && options.windowBounds) {
      const sTL = printTransform.worldToScreen({ x: bounds.minX, y: bounds.maxY });
      const sBR = printTransform.worldToScreen({ x: bounds.maxX, y: bounds.minY });
      const clipX = Math.max(marginPx, Math.min(sTL.x, sBR.x));
      const clipY = Math.max(marginPx, Math.min(sTL.y, sBR.y));
      const clipR = Math.min(canvasW - marginPx, Math.max(sTL.x, sBR.x));
      const clipB = Math.min(canvasH - marginPx, Math.max(sTL.y, sBR.y));
      pctx.beginPath();
      pctx.rect(clipX, clipY, Math.max(1, clipR - clipX), Math.max(1, clipB - clipY));
      pctx.clip();
    } else if (options.showTitleBlock && !useEmbeddedCadTitleBlock) {
      pctx.beginPath();
      pctx.rect(marginPx, marginPx, canvasW - marginPx * 2, canvasH - marginPx * 2);
      pctx.clip();
    }

    printRenderer.render(
      pctx,
      doc,
      printTransform,
      printGrid,
      dummySnap,
      null,
      null,
      null,
      null
    );
    pctx.restore();

    if (tbLayer) {
      tbLayer.visible = prevTbVisible;
    }

    for (const oc of originalColors) {
      const e = doc.getEntity(oc.id);
      if (e) e.color = oc.color;
    }

    // Draw print border & customized company title block if enabled (and not already embedded in CAD entities)
    if (options.showTitleBlock && !useEmbeddedCadTitleBlock) {
      const scaleText = options.scale === 'fit' ? tr('Dopasowano', 'Fit') : options.scale;
      TitleBlockManager.drawOnPrintCanvas(
        pctx,
        canvasW,
        canvasH,
        targetPxPerMm,
        margin_mm,
        options.paperSize,
        options.orientation,
        scaleText,
        doc.unit
      );
    }

    return printCanvas;
  }

  static printDrawing(
    doc: CadDocument,
    transform: ViewportTransform,
    options: PrintOptions = {
      paperSize: 'A4',
      orientation: 'landscape',
      scale: 'fit',
      invertColors: true,
      showTitleBlock: true,
      plotArea: 'extents',
    }
  ) {
    const spec = PAPER_FORMATS.find(f => f.id === options.paperSize) || PAPER_FORMATS[0];
    const printCanvas = this.renderSheetToCanvas(doc, options, 4200, transform);
    const dataUrl = printCanvas.toDataURL('image/png');

    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>NanoDraft 2D — ${options.paperSize} (${options.orientation})</title>
          <style>
            @page {
              size: ${spec.cssPageSize} ${options.orientation};
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              background: #fff;
            }
            img {
              width: 100vw;
              height: 100vh;
              object-fit: contain;
            }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" onload="window.print();" />
        </body>
        </html>
      `);
      printWin.document.close();
    }
  }
}

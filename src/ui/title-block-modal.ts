import { CadDocument } from '../model/document';
import { HistoryManager, Command } from '../model/history';
import { ViewportTransform, UNIT_SCALE_TO_MM } from '../math/transform';
import { PAPER_FORMATS, PaperFormatId } from '../io/print-pdf';
import { CadEntity, ImageEntity, Layer, LineEntity, PolylineEntity, TextEntity, UnitType } from '../types/cad';
import { Geometry } from '../math/geometry';
import { CadRenderer } from '../engine/renderer';
import { tr } from '../i18n/lang';

export interface TitleBlockTemplate {
  companyName: string;
  department: string;
  drawingTitle: string;
  drawingNumber: string;
  revision: string;
  author: string;
  checker: string;
  date: string;
  scaleText: string;
  materialOrNotes: string;
  custom1Label: string;
  custom1Value: string;
  custom2Label: string;
  custom2Value: string;
  tableWidthMm: number;
  /** Optional base64 data URL of uploaded company logo image */
  logoDataUrl?: string;
  /** Whether to use the user's custom CAD-drawn title block instead of the parametric table */
  useCustomDrawn?: boolean;
  /** Entities of the custom CAD-drawn title block, normalized in millimeters with bottom-right at (0, 0) (so x in [-W, 0], y in [0, H]) */
  customDrawnEntitiesMm?: CadEntity[];
  customDrawnWidthMm?: number;
  customDrawnHeightMm?: number;
}

const STORAGE_KEY = 'nanodraft_company_title_block_v1';

export class TitleBlockManager {
  static getDefaultTemplate(): TitleBlockTemplate {
    return {
      companyName: 'NAZWA FIRMY Sp. z o.o.',
      department: 'Dział Inżynieryjny / Projektowy',
      drawingTitle: 'Rysunek Techniczny / Layout',
      drawingNumber: 'RYS-001/2026',
      revision: 'Rev. A',
      author: 'inż. Projektant',
      checker: 'Kierownik Projektu',
      date: new Date().toISOString().slice(0, 10),
      scaleText: '1:100',
      materialOrNotes: 'ISO 2768-mK',
      custom1Label: 'Klient / Inwestor',
      custom1Value: 'Zakład Produkcyjny Nr 1',
      custom2Label: 'Nr Zlecenia',
      custom2Value: 'ZL-2026-04',
      tableWidthMm: 180,
      logoDataUrl: undefined,
      useCustomDrawn: false,
      customDrawnEntitiesMm: undefined,
      customDrawnWidthMm: undefined,
      customDrawnHeightMm: undefined,
    };
  }

  static loadTemplate(): TitleBlockTemplate {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.getDefaultTemplate();
      const parsed = { ...this.getDefaultTemplate(), ...JSON.parse(raw) };
      if (parsed.logoDataUrl) {
        CadRenderer.getCachedImage(parsed.logoDataUrl);
      }
      return parsed;
    } catch {
      return this.getDefaultTemplate();
    }
  }

  static saveTemplate(tpl: TitleBlockTemplate) {
    try {
      if (tpl.logoDataUrl) {
        CadRenderer.getCachedImage(tpl.logoDataUrl);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tpl));
    } catch {
      // ignore storage quota errors
    }
  }

  /**
   * Captures currently selected entities (or entities on layer 'title_block') from the CAD document,
   * converts their coordinates into millimeters relative to the bottom-right corner (maxX, minY) -> (0, 0),
   * and saves them as the user's Custom Drawn Title Block!
   */
  static captureCustomTitleBlockFromSelection(doc: CadDocument): { count: number; widthMm: number; heightMm: number } | null {
    let source = doc.getSelectedEntities();
    if (source.length === 0) {
      source = doc.entities.filter(e => e.layerId === 'title_block');
    }
    if (source.length === 0) return null;

    const bounds = Geometry.unionBounds(source);
    if (!bounds) return null;

    const wUnits = bounds.maxX - bounds.minX;
    const hUnits = bounds.maxY - bounds.minY;
    if (wUnits < 1e-3 || hUnits < 1e-3) return null;

    const unitToMm = UNIT_SCALE_TO_MM[doc.unit];
    const widthMm = Math.round(wUnits * unitToMm * 10) / 10;
    const heightMm = Math.round(hUnits * unitToMm * 10) / 10;

    // Normalize relative to bottom-right corner (bounds.maxX, bounds.minY) in millimeters
    // So xMm is in [-widthMm, 0] and yMm is in [0, heightMm]
    const brX = bounds.maxX;
    const brY = bounds.minY;

    const normalizedMm = source.map(ent => {
      const copy = Geometry.transformEntity(
        ent,
        p => ({
          x: Math.round((p.x - brX) * unitToMm * 1000) / 1000,
          y: Math.round((p.y - brY) * unitToMm * 1000) / 1000,
        }),
        { scale: unitToMm }
      );
      copy.selected = false;
      delete copy.groupId;
      delete copy.groupName;
      return copy;
    });

    const tpl = this.loadTemplate();
    tpl.useCustomDrawn = true;
    tpl.customDrawnEntitiesMm = normalizedMm;
    tpl.customDrawnWidthMm = widthMm;
    tpl.customDrawnHeightMm = heightMm;
    this.saveTemplate(tpl);

    return { count: normalizedMm.length, widthMm, heightMm };
  }

  /**
   * Renders the sheet frame and Company Title Block (either parametric with logo OR custom-drawn CAD title block)
   * onto a 2D Print / Preview Canvas in either Landscape or Portrait orientation.
   */
  static drawOnPrintCanvas(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    targetPxPerMm: number,
    marginMm: number,
    paperSize: PaperFormatId,
    orientation: 'landscape' | 'portrait',
    scaleLabel: string,
    unitLabel: string,
    overrideTemplate?: TitleBlockTemplate
  ) {
    const tpl = overrideTemplate || this.loadTemplate();
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';

    const lineW = Math.max(Math.round(0.45 * targetPxPerMm), 1.5);
    const thinLineW = Math.max(Math.round(0.25 * targetPxPerMm), 1);
    const marginPx = Math.round(marginMm * targetPxPerMm);

    const frameX = marginPx;
    const frameY = marginPx;
    const frameW = canvasW - marginPx * 2;
    const frameH = canvasH - marginPx * 2;

    // Outer drawing frame
    ctx.lineWidth = lineW;
    ctx.strokeRect(frameX, frameY, frameW, frameH);

    const maxTbWidthMm = canvasW / targetPxPerMm - marginMm * 2;

    // Case A: Custom User-Drawn CAD Title Block
    if (
      tpl.useCustomDrawn &&
      tpl.customDrawnEntitiesMm &&
      tpl.customDrawnEntitiesMm.length > 0 &&
      tpl.customDrawnWidthMm &&
      tpl.customDrawnHeightMm
    ) {
      const fitScale = tpl.customDrawnWidthMm > maxTbWidthMm ? maxTbWidthMm / tpl.customDrawnWidthMm : 1.0;
      const tbW = Math.round(tpl.customDrawnWidthMm * fitScale * targetPxPerMm);
      const tbH = Math.round(tpl.customDrawnHeightMm * fitScale * targetPxPerMm);
      const tbX = frameX + frameW - tbW;
      const tbY = frameY + frameH - tbH;

      // White background behind custom title block
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(tbX, tbY, tbW, tbH);

      // Render custom CAD entities using a temporary CadDocument & ViewportTransform anchored at bottom-right (frameX + frameW, frameY + frameH)
      const tempDoc = new CadDocument();
      tempDoc.unit = 'mm';
      for (const e of tpl.customDrawnEntitiesMm) {
        const clone = Geometry.cloneEntity(e);
        clone.color = '#000000';
        clone.layerId = '0';
        tempDoc.entities.push(clone);
      }

      const tbTransform = new ViewportTransform(canvasW, canvasH);
      tbTransform.zoom = targetPxPerMm * fitScale;
      // World (0, 0) is bottom-right corner of inner frame: screen (frameX + frameW, frameY + frameH)
      tbTransform.panX = frameX + frameW;
      tbTransform.panY = frameY + frameH;

      const tbRenderer = new CadRenderer();
      tbRenderer.fullScreenCrosshair = false;
      tbRenderer.drawUCS = false;
      tbRenderer.drawCircleCenterMarks = false;
      tbRenderer.pixelScale = Math.max(canvasW / 1600, 1.0);

      for (const ent of tempDoc.entities) {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.fillStyle = '#000000';
        ctx.lineWidth = thinLineW;
        (tbRenderer as any).renderEntity(ctx, ent, tbTransform, 'mm', '#000000');
        ctx.restore();
      }

      ctx.restore();
      return;
    }

    // Case B: Parametric Multi-Cell Company Title Block (with optional Logo image!)
    const tbW_mm = Math.min(tpl.tableWidthMm || 180, maxTbWidthMm);
    const tbH_mm = 36; // 4 rows x 9mm standard technical title block

    const tbW = Math.round(tbW_mm * targetPxPerMm);
    const tbH = Math.round(tbH_mm * targetPxPerMm);
    const tbX = frameX + frameW - tbW;
    const tbY = frameY + frameH - tbH;

    // White background behind title block so drawing lines don't show through
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tbX, tbY, tbW, tbH);

    // Outer border of title block
    ctx.lineWidth = lineW;
    ctx.strokeRect(tbX, tbY, tbW, tbH);

    // 4 horizontal rows (each 9 mm high)
    const rowH = tbH / 4;
    ctx.lineWidth = thinLineW;
    for (let r = 1; r < 4; r++) {
      const y = Math.round(tbY + r * rowH);
      ctx.beginPath();
      ctx.moveTo(tbX, y);
      ctx.lineTo(tbX + tbW, y);
      ctx.stroke();
    }

    // Vertical column dividers
    const c1 = Math.round(tbX + tbW * 0.38);
    const c2 = Math.round(tbX + tbW * 0.72);

    ctx.beginPath();
    ctx.moveTo(c1, tbY);
    ctx.lineTo(c1, tbY + tbH);
    ctx.moveTo(c2, tbY);
    ctx.lineTo(c2, tbY + tbH);
    ctx.stroke();

    const drawCell = (
      x0: number,
      y0: number,
      w: number,
      h: number,
      label: string,
      val: string,
      boldVal: boolean = false,
      valFontScale: number = 1.0
    ) => {
      const padX = Math.round(2.0 * targetPxPerMm);
      const labelFontPx = Math.max(Math.round(1.9 * targetPxPerMm), 7);
      const valFontPx = Math.max(Math.round(2.9 * valFontScale * targetPxPerMm), 9);

      ctx.fillStyle = '#444444';
      ctx.font = `${labelFontPx}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x0 + padX, y0 + Math.round(1.0 * targetPxPerMm), Math.max(10, w - padX * 2));

      ctx.fillStyle = '#000000';
      ctx.font = `${boldVal ? 'bold ' : ''}${valFontPx}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(val, x0 + padX, y0 + h - Math.round(1.3 * targetPxPerMm), Math.max(10, w - padX * 2));
    };

    const r0 = tbY;
    const r1 = tbY + rowH;
    const r2 = tbY + rowH * 2;
    const r3 = tbY + rowH * 3;
    const w1 = c1 - tbX;
    const w2 = c2 - c1;
    const w3 = tbX + tbW - c2;

    // Row 0 (top): Company Name (+ optional Logo!) | Drawing Title | Drawing Number
    let companyTextX = tbX;
    let companyTextW = w1;
    if (tpl.logoDataUrl) {
      const logoImg = CadRenderer.getCachedImage(tpl.logoDataUrl);
      const logoBoxW = Math.round(Math.min(w1 * 0.36, rowH * 1.8));
      const pad = Math.max(2, Math.round(1.0 * targetPxPerMm));
      if (logoImg) {
        const availW = logoBoxW - pad * 2;
        const availH = rowH - pad * 2;
        const imgAspect = logoImg.naturalWidth / Math.max(1, logoImg.naturalHeight);
        let drawW = availW;
        let drawH = drawW / imgAspect;
        if (drawH > availH) {
          drawH = availH;
          drawW = drawH * imgAspect;
        }
        const lx = tbX + pad + (availW - drawW) / 2;
        const ly = r0 + pad + (availH - drawH) / 2;
        ctx.drawImage(logoImg, lx, ly, drawW, drawH);
      }
      // Vertical divider after logo box
      ctx.beginPath();
      ctx.moveTo(tbX + logoBoxW, r0);
      ctx.lineTo(tbX + logoBoxW, r0 + rowH);
      ctx.stroke();
      companyTextX = tbX + logoBoxW;
      companyTextW = w1 - logoBoxW;
    }

    drawCell(companyTextX, r0, companyTextW, rowH, tr('Firma:', 'Company:'), tpl.companyName, true, 1.0);
    drawCell(c1, r0, w2, rowH, tr('Tytuł rysunku:', 'Drawing Title:'), tpl.drawingTitle, true, 1.08);
    drawCell(c2, r0, w3, rowH, tr('Nr rysunku:', 'Drawing No.:'), `${tpl.drawingNumber} (${tpl.revision})`, true, 1.0);

    // Row 1: Department | Custom 1 | Custom 2
    drawCell(tbX, r1, w1, rowH, tr('Dział / Jednostka:', 'Department:'), tpl.department);
    drawCell(c1, r1, w2, rowH, `${tpl.custom1Label}:`, tpl.custom1Value);
    drawCell(c2, r1, w3, rowH, `${tpl.custom2Label}:`, tpl.custom2Value);

    // Row 2: Author | Checker | Material / Notes
    drawCell(tbX, r2, w1, rowH, tr('Projektował:', 'Designed by:'), tpl.author);
    drawCell(c1, r2, w2, rowH, tr('Sprawdził:', 'Checked by:'), tpl.checker);
    drawCell(c2, r2, w3, rowH, tr('Norma / Uwagi:', 'Standard / Notes:'), tpl.materialOrNotes);

    // Row 3 (bottom): Date | Scale & Unit | Format & Orientation
    const orientShort = orientation === 'landscape' ? tr('Poziom', 'Land.') : tr('Pion', 'Port.');
    drawCell(tbX, r3, w1, rowH, tr('Data:', 'Date:'), tpl.date);
    drawCell(c1, r3, w2, rowH, tr('Skala / Jedn.:', 'Scale / Unit:'), `${scaleLabel} [${unitLabel}]`, true);
    drawCell(c2, r3, w3, rowH, tr('Format:', 'Format:'), `${paperSize} (${orientShort})`, true);

    ctx.restore();
  }

  /**
   * Builds the CAD entities for the Title Block alone (without outer sheet border),
   * positioned so its bottom-right corner is at (brX, brY) in the target unit & scale.
   */
  static buildTitleBlockEntities(
    tpl: TitleBlockTemplate,
    brX: number,
    brY: number,
    mmToUnit: number,
    maxTbW_mm: number,
    layerId: string,
    color: string,
    formatId: string,
    orientName: string,
    scaleRatioDenom: number,
    unit: UnitType,
    groupId?: string,
    groupName?: string
  ): CadEntity[] {
    let idSeq = 1;
    const genId = (prefix: string) => `${prefix}_${Date.now()}_${idSeq++}`;
    const createdEntities: CadEntity[] = [];

    // If user has enabled their Custom-Drawn CAD Title Block, dock it at (brX, brY)!
    if (
      tpl.useCustomDrawn &&
      tpl.customDrawnEntitiesMm &&
      tpl.customDrawnEntitiesMm.length > 0 &&
      tpl.customDrawnWidthMm
    ) {
      const fitScale = tpl.customDrawnWidthMm > maxTbW_mm ? maxTbW_mm / tpl.customDrawnWidthMm : 1.0;
      const totalScale = mmToUnit * fitScale;

      for (const srcEnt of tpl.customDrawnEntitiesMm) {
        const cloned = Geometry.transformEntity(
          srcEnt,
          p => ({
            x: Math.round((brX + p.x * totalScale) * 1000) / 1000,
            y: Math.round((brY + p.y * totalScale) * 1000) / 1000,
          }),
          { scale: totalScale }
        );
        cloned.id = genId('tb_cust');
        cloned.layerId = layerId;
        if (groupId) {
          cloned.groupId = groupId;
          cloned.groupName = groupName;
        }
        createdEntities.push(cloned);
      }
      return createdEntities;
    }

    // Otherwise generate parametric multi-cell Title Block (with optional Logo ImageEntity)
    const tbW_mm = Math.min(tpl.tableWidthMm || 180, maxTbW_mm);
    const tbH_mm = 36; // 4 rows x 9 mm

    const tbW = tbW_mm * mmToUnit;
    const tbH = tbH_mm * mmToUnit;
    const tbX = brX - tbW;
    const tbY = brY;

    const addRect = (x: number, y: number, w: number, h: number) => {
      const poly: PolylineEntity = {
        id: genId('tb_rect'),
        type: 'polyline',
        layerId,
        color,
        lineType: 'continuous',
        groupId,
        groupName,
        selected: false,
        closed: true,
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      };
      createdEntities.push(poly);
    };

    const addLine = (x1: number, y1: number, x2: number, y2: number) => {
      const ln: LineEntity = {
        id: genId('tb_line'),
        type: 'line',
        layerId,
        color,
        lineType: 'continuous',
        groupId,
        groupName,
        selected: false,
        x1,
        y1,
        x2,
        y2,
      };
      createdEntities.push(ln);
    };

    const addCellText = (
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      value: string,
      valueFontMm: number = 3.0
    ) => {
      const pad = 1.8 * mmToUnit;
      const lblH = 1.7 * mmToUnit;
      const valH = valueFontMm * mmToUnit;

      const lblEnt: TextEntity = {
        id: genId('tb_lbl'),
        type: 'text',
        layerId,
        color: '#94a3b8',
        lineType: 'continuous',
        groupId,
        groupName,
        selected: false,
        x: x + pad,
        y: y + h - pad - lblH * 1.15,
        text: label,
        height: lblH,
        rotation: 0,
        align: 'left',
        baseline: 'bottom',
      };
      createdEntities.push(lblEnt);

      const valEnt: TextEntity = {
        id: genId('tb_val'),
        type: 'text',
        layerId,
        color,
        lineType: 'continuous',
        groupId,
        groupName,
        selected: false,
        x: x + pad,
        y: y + pad * 0.7,
        text: value,
        height: valH,
        rotation: 0,
        boxWidth: Math.max(w - pad * 2, valH),
        boxHeight: Math.max(h * 0.58, valH * 1.2),
        align: 'left',
        baseline: 'middle',
      };
      createdEntities.push(valEnt);
    };

    addRect(tbX, tbY, tbW, tbH);

    const rowH = tbH / 4;
    for (let r = 1; r < 4; r++) {
      addLine(tbX, tbY + r * rowH, tbX + tbW, tbY + r * rowH);
    }

    const c1 = tbX + tbW * 0.38;
    const c2 = tbX + tbW * 0.72;
    addLine(c1, tbY, c1, tbY + tbH);
    addLine(c2, tbY, c2, tbY + tbH);

    const w1 = c1 - tbX;
    const w2 = c2 - c1;
    const w3 = tbX + tbW - c2;

    const rTop = tbY + rowH * 3;
    const rMid2 = tbY + rowH * 2;
    const rMid1 = tbY + rowH * 1;
    const rBot = tbY;

    let companyCellX = tbX;
    let companyCellW = w1;
    if (tpl.logoDataUrl) {
      const logoBoxW = Math.min(w1 * 0.36, rowH * 1.8);
      const pad = 1.0 * mmToUnit;
      addLine(tbX + logoBoxW, rTop, tbX + logoBoxW, rTop + rowH);
      const imgEnt: ImageEntity = {
        id: genId('tb_logo'),
        type: 'image',
        layerId,
        groupId,
        groupName,
        selected: false,
        x: tbX + pad,
        y: rTop + pad,
        width: Math.max(logoBoxW - pad * 2, 2 * mmToUnit),
        height: Math.max(rowH - pad * 2, 2 * mmToUnit),
        dataUrl: tpl.logoDataUrl,
      };
      createdEntities.push(imgEnt);
      companyCellX = tbX + logoBoxW;
      companyCellW = w1 - logoBoxW;
    }

    addCellText(companyCellX, rTop, companyCellW, rowH, tr('Firma:', 'Company:'), tpl.companyName, 3.0);
    addCellText(c1, rTop, w2, rowH, tr('Tytuł rysunku:', 'Drawing Title:'), tpl.drawingTitle, 3.2);
    addCellText(c2, rTop, w3, rowH, tr('Nr rysunku:', 'Drawing No.:'), `${tpl.drawingNumber} (${tpl.revision})`, 2.8);

    addCellText(tbX, rMid2, w1, rowH, tr('Dział / Jednostka:', 'Department:'), tpl.department, 2.5);
    addCellText(c1, rMid2, w2, rowH, `${tpl.custom1Label}:`, tpl.custom1Value, 2.5);
    addCellText(c2, rMid2, w3, rowH, `${tpl.custom2Label}:`, tpl.custom2Value, 2.5);

    addCellText(tbX, rMid1, w1, rowH, tr('Projektował:', 'Designed by:'), tpl.author, 2.5);
    addCellText(c1, rMid1, w2, rowH, tr('Sprawdził:', 'Checked by:'), tpl.checker, 2.5);
    addCellText(c2, rMid1, w3, rowH, tr('Norma / Uwagi:', 'Standard / Notes:'), tpl.materialOrNotes, 2.5);

    addCellText(tbX, rBot, w1, rowH, tr('Data:', 'Date:'), tpl.date, 2.5);
    addCellText(c1, rBot, w2, rowH, tr('Skala / Jedn.:', 'Scale / Unit:'), `1:${scaleRatioDenom} [${unit}]`, 2.7);
    addCellText(c2, rBot, w3, rowH, tr('Format:', 'Format:'), `${formatId} (${orientName})`, 2.7);

    return createdEntities;
  }

  /**
   * Opens the Title Block geometry directly on the CAD canvas at (0, 0) for visual CAD editing,
   * so the user can freely draw/modify lines, cells, and texts and then save it as their custom template.
   */
  static openOnCanvasForEditing(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform
  ) {
    const tpl = this.loadTemplate();
    let tbLayer: Layer | undefined = doc.layers.find(l => l.id === 'title_block');
    if (!tbLayer) {
      tbLayer = {
        id: 'title_block',
        name: tr('Ramka i Tabliczka', 'Border & Title Block'),
        color: '#f8fafc',
        lineType: 'continuous',
        lineWidth: 0.35,
        visible: true,
        locked: false,
      };
      doc.layers.push(tbLayer);
    }
    doc.activeLayerId = tbLayer.id;

    const mmToUnit = 1 / UNIT_SCALE_TO_MM[doc.unit];
    const tbW_mm = tpl.useCustomDrawn && tpl.customDrawnWidthMm ? tpl.customDrawnWidthMm : tpl.tableWidthMm || 180;
    const brX = tbW_mm * mmToUnit;
    const brY = 0;

    // Build ungrouped entities so every line and text is individually editable!
    const entities = this.buildTitleBlockEntities(
      tpl,
      brX,
      brY,
      mmToUnit,
      190,
      tbLayer.id,
      tbLayer.color,
      'A3',
      tr('Poziom', 'Land.'),
      1,
      doc.unit
    );

    const cmd: Command = {
      description: tr('Wstaw szablon tabliczki do edycji CAD', 'Insert title block template for CAD editing'),
      execute: () => {
        doc.clearSelection();
        entities.forEach(e => {
          doc.addEntity(e);
          doc.selectedEntityIds.add(e.id);
          e.selected = true;
        });
        doc.notifyChange();
      },
      undo: () => {
        entities.forEach(e => doc.removeEntity(e.id));
      },
    };
    history.execute(cmd);

    const b = Geometry.unionBounds(entities);
    if (b) {
      transform.zoomToFit(b);
    }
  }

  /**
   * Inserts the sheet border and Company Title Block directly into the CAD drawing
   * as editable CAD geometry in either Horizontal (landscape) or Vertical (portrait) orientation.
   */
  static insertIntoDrawing(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    formatId: PaperFormatId,
    orientation: 'landscape' | 'portrait',
    scaleRatioDenom: number
  ) {
    const tpl = this.loadTemplate();
    const spec = PAPER_FORMATS.find(f => f.id === formatId) || PAPER_FORMATS[0];

    const isLandscape = orientation === 'landscape';
    const sheetW_mm = isLandscape ? spec.heightMm : spec.widthMm;
    const sheetH_mm = isLandscape ? spec.widthMm : spec.heightMm;

    const mmToUnit = scaleRatioDenom / UNIT_SCALE_TO_MM[doc.unit];

    const sheetW = sheetW_mm * mmToUnit;
    const sheetH = sheetH_mm * mmToUnit;
    const margin = 10 * mmToUnit;

    let originX = 0;
    let originY = 0;
    const existingWithoutTb = doc.entities.filter(e => e.layerId !== 'title_block');
    const bounds = Geometry.unionBounds(existingWithoutTb);
    if (bounds) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      originX = Math.round((cx - sheetW / 2) * 100) / 100;
      originY = Math.round((cy - sheetH / 2) * 100) / 100;
    }

    let tbLayer: Layer | undefined = doc.layers.find(l => l.id === 'title_block');
    if (!tbLayer) {
      tbLayer = {
        id: 'title_block',
        name: tr('Ramka i Tabliczka', 'Border & Title Block'),
        color: '#f8fafc',
        lineType: 'continuous',
        lineWidth: 0.35,
        visible: true,
        locked: false,
      };
      doc.layers.push(tbLayer);
    }

    const layerId = tbLayer.id;
    const color = tbLayer.color;
    const orientName = orientation === 'landscape' ? tr('Poziom', 'Land.') : tr('Pion', 'Port.');
    const groupId = `grp_tb_${Date.now()}`;
    const groupName = tr(`Tabliczka ${formatId} (${orientName})`, `Title Block ${formatId} (${orientName})`);

    const makeRect = (id: string, x: number, y: number, w: number, h: number): PolylineEntity => ({
      id,
      type: 'polyline',
      layerId,
      color,
      lineType: 'continuous',
      groupId,
      groupName,
      selected: false,
      closed: true,
      points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    });

    const fx = originX + margin;
    const fy = originY + margin;
    const fw = sheetW - margin * 2;
    const fh = sheetH - margin * 2;

    const createdEntities: CadEntity[] = [
      makeRect(`tb_outer_${Date.now()}_1`, originX, originY, sheetW, sheetH),
      makeRect(`tb_inner_${Date.now()}_2`, fx, fy, fw, fh),
    ];

    const maxTbW_mm = sheetW_mm - 20;
    const tbEntities = this.buildTitleBlockEntities(
      tpl,
      fx + fw,
      fy,
      mmToUnit,
      maxTbW_mm,
      layerId,
      color,
      formatId,
      orientName,
      scaleRatioDenom,
      doc.unit,
      groupId,
      groupName
    );
    createdEntities.push(...tbEntities);

    const cmd: Command = {
      description: tr(
        `Wstaw tabliczkę rysunkową ${formatId} (${orientName})`,
        `Insert title block ${formatId} (${orientName})`
      ),
      execute: () => {
        createdEntities.forEach(e => doc.addEntity(e));
      },
      undo: () => {
        createdEntities.forEach(e => doc.removeEntity(e.id));
      },
    };
    history.execute(cmd);

    const allBounds = Geometry.unionBounds(doc.entities);
    if (allBounds) {
      transform.zoomToFit(allBounds);
    }
  }

  /**
   * Opens the interactive Company Title Block Configurator, Logo Uploader & Custom CAD Editor Modal.
   */
  static openModal(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    requestRender: () => void
  ) {
    const existing = document.getElementById('cad-titleblock-modal-overlay');
    if (existing) existing.remove();

    const tpl = this.loadTemplate();
    let currentLogoDataUrl: string | undefined = tpl.logoDataUrl;
    let currentUseCustomDrawn: boolean = !!tpl.useCustomDrawn;

    const defaultScaleDenom = doc.unit === 'm' ? 100 : doc.unit === 'cm' ? 20 : 1;
    const selCount = doc.getSelectedEntities().length;
    const hasCustomSaved = !!(tpl.customDrawnEntitiesMm && tpl.customDrawnEntitiesMm.length > 0);

    const overlay = document.createElement('div');
    overlay.id = 'cad-titleblock-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 680px; max-width: 96vw;">
        <div class="modal-header">
          <h3>📋 ${tr('Konfigurator i Edytor Tabliczki Rysunkowej', 'Title Block Configurator & Editor')}</h3>
          <button class="modal-close-btn" id="tb-modal-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:10px; max-height:78vh; overflow-y:auto;">

          <!-- Mode Selector: Parametric Table vs Custom CAD Drawn Title Block -->
          <div style="display:flex; gap:8px; align-items:center; background:var(--bg-primary); padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); flex-wrap:wrap;">
            <span style="font-size:12px; font-weight:600; color:var(--text-main);">${tr('Źródło tabliczki:', 'Title Block Source:')}</span>
            <button type="button" id="tb-mode-standard" class="dim-mode-btn ${!currentUseCustomDrawn ? 'active' : ''}">
              📋 ${tr('Standardowa tabela z polami i logo', 'Standard Table with Fields & Logo')}
            </button>
            <button type="button" id="tb-mode-custom" class="dim-mode-btn ${currentUseCustomDrawn ? 'active' : ''}" ${!hasCustomSaved ? 'disabled' : ''}>
              ✏️ ${tr('Własna narysowana tabliczka CAD', 'Custom CAD-Drawn Title Block')}
              ${hasCustomSaved ? `(${tpl.customDrawnWidthMm}×${tpl.customDrawnHeightMm} mm)` : `(${tr('brak zapisanej', 'none saved')})`}
            </button>
          </div>

          <!-- Custom CAD Drawing Editor Section -->
          <div style="background:rgba(0, 229, 255, 0.06); border:1px solid var(--border-color); border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:6px;">
            <div style="font-weight:600; font-size:12px; color:var(--accent-color);">
              ✏️ ${tr('Edytor Rysunkowy Własnej Tabliczki (Narysuj swoją tabelkę na płótnie CAD):', 'Custom CAD Title Block Editor (Draw your own table on CAD canvas):')}
            </div>
            <div style="font-size:11px; color:var(--text-muted); line-height:1.4;">
              ${tr(
                'Możesz otworzyć szablon tabliczki bezpośrednio na płótnie CAD, dowolnie zmieniać linie, komórki i napisy narzędziami CAD, a następnie zaznaczyć swoją tabelkę i zapisać ją poniżej. Program będzie automatycznie doklejał ją w prawym dolnym rogu każdego arkusza!',
                'You can open the title block on the CAD canvas, freely edit lines, cells and texts using CAD tools, then select your table and save it below. The app will automatically dock it in the bottom-right corner of any sheet!'
              )}
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:2px;">
              <button type="button" class="top-btn" id="tb-open-on-canvas-btn">
                ✏️ ${tr('1. Wstaw szablon na płótno do edycji CAD', '1. Place Template on Canvas for CAD Editing')}
              </button>
              <button type="button" class="top-btn highlight" id="tb-capture-canvas-btn">
                📌 ${tr(`2. Zapisz zaznaczone z rysunku jako własną tabliczkę (${selCount} zazn.)`, `2. Save Selection as Custom Title Block (${selCount} sel.)`)}
              </button>
            </div>
          </div>

          <!-- Company Logo Upload Section -->
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:6px; padding:8px 12px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <div id="tb-logo-thumb" style="width:68px; height:36px; border:1px dashed var(--border-color); border-radius:4px; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                ${
                  currentLogoDataUrl
                    ? `<img src="${currentLogoDataUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />`
                    : `<span style="font-size:10px; color:#666;">${tr('Brak logo', 'No Logo')}</span>`
                }
              </div>
              <div>
                <div style="font-size:12px; font-weight:600; color:var(--text-main);">🖼️ ${tr('Logo firmy w tabliczce rysunkowej', 'Company Logo in Title Block')}</div>
                <div style="font-size:11px; color:var(--text-muted);">${tr('Obsługiwane formaty: PNG, JPG, SVG, WEBP', 'Supported formats: PNG, JPG, SVG, WEBP')}</div>
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              <input type="file" id="tb-logo-input" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none;" />
              <button type="button" class="top-btn highlight" id="tb-logo-upload-btn">📂 ${tr('Wgraj logo...', 'Upload Logo...')}</button>
              <button type="button" class="top-btn" id="tb-logo-clear-btn" ${!currentLogoDataUrl ? 'disabled' : ''}>🗑️ ${tr('Usuń', 'Remove')}</button>
            </div>
          </div>

          <!-- Live Visual Preview of Title Block -->
          <div style="display:flex; flex-direction:column; gap:4px;">
            <span style="font-size:11px; color:var(--text-muted); font-weight:600;">👁️ ${tr('Podgląd tabliczki na żywo:', 'Live Title Block Preview:')}</span>
            <div style="background:#ffffff; border:1px solid var(--border-color); border-radius:6px; padding:6px; display:flex; justify-content:center;">
              <canvas id="tb-live-preview-canvas" width="620" height="140" style="max-width:100%; height:auto;"></canvas>
            </div>
          </div>

          <!-- Parametric Fields Grid -->
          <div id="tb-fields-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; ${currentUseCustomDrawn ? 'opacity:0.5;' : ''}">
            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Nazwa firmy:', 'Company Name:')}</label>
              <input id="tb-company" type="text" class="prop-input prop-input-full" value="${tpl.companyName.replace(/"/g, '&quot;')}" />
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Dział / Adres / Zakład:', 'Department / Division:')}</label>
              <input id="tb-dept" type="text" class="prop-input prop-input-full" value="${tpl.department.replace(/"/g, '&quot;')}" />
            </div>

            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Tytuł rysunku / Projekt:', 'Drawing Title / Project:')}</label>
              <input id="tb-title" type="text" class="prop-input prop-input-full" value="${tpl.drawingTitle.replace(/"/g, '&quot;')}" />
            </div>
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap: 6px;">
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Nr rysunku:', 'Drawing No.:')}</label>
                <input id="tb-number" type="text" class="prop-input prop-input-full" value="${tpl.drawingNumber.replace(/"/g, '&quot;')}" />
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Rewizja:', 'Revision:')}</label>
                <input id="tb-rev" type="text" class="prop-input prop-input-full" value="${tpl.revision.replace(/"/g, '&quot;')}" />
              </div>
            </div>

            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Projektował (Autor):', 'Designed by (Author):')}</label>
              <input id="tb-author" type="text" class="prop-input prop-input-full" value="${tpl.author.replace(/"/g, '&quot;')}" />
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Sprawdził / Zatwierdził:', 'Checked / Approved by:')}</label>
              <input id="tb-checker" type="text" class="prop-input prop-input-full" value="${tpl.checker.replace(/"/g, '&quot;')}" />
            </div>

            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Etykieta pola firmowego 1:', 'Custom Field 1 Label:')}</label>
              <input id="tb-c1-label" type="text" class="prop-input prop-input-full" value="${tpl.custom1Label.replace(/"/g, '&quot;')}" />
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Wartość pola firmowego 1:', 'Custom Field 1 Value:')}</label>
              <input id="tb-c1-val" type="text" class="prop-input prop-input-full" value="${tpl.custom1Value.replace(/"/g, '&quot;')}" />
            </div>

            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Etykieta pola firmowego 2:', 'Custom Field 2 Label:')}</label>
              <input id="tb-c2-label" type="text" class="prop-input prop-input-full" value="${tpl.custom2Label.replace(/"/g, '&quot;')}" />
            </div>
            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Wartość pola firmowego 2:', 'Custom Field 2 Value:')}</label>
              <input id="tb-c2-val" type="text" class="prop-input prop-input-full" value="${tpl.custom2Value.replace(/"/g, '&quot;')}" />
            </div>

            <div>
              <label style="font-size:11px; color:var(--text-muted);">${tr('Norma / Materiał / Uwagi:', 'Standard / Material / Notes:')}</label>
              <input id="tb-notes" type="text" class="prop-input prop-input-full" value="${tpl.materialOrNotes.replace(/"/g, '&quot;')}" />
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 6px;">
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Data:', 'Date:')}</label>
                <input id="tb-date" type="text" class="prop-input prop-input-full" value="${tpl.date.replace(/"/g, '&quot;')}" />
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Szer. tabliczki [mm]:', 'Table Width [mm]:')}</label>
                <input id="tb-width" type="number" min="100" max="190" step="5" class="prop-input prop-input-full" value="${tpl.tableWidthMm}" />
              </div>
            </div>
          </div>

          <!-- Insert Frame & Title Block into CAD Drawing -->
          <div style="background:rgba(59,130,246,0.08); border:1px solid var(--border-color); border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;">
            <div style="font-weight:600; font-size:12px; color:var(--text-main);">
              📐 ${tr('Doklej Ramkę i Tabliczkę bezpośrednio do rysunku CAD:', 'Dock Frame & Title Block directly into CAD Drawing:')}
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px;">
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Format arkusza:', 'Sheet Format:')}</label>
                <select id="tb-insert-format" class="prop-input prop-input-full" style="text-align:left;">
                  ${PAPER_FORMATS.map(f => `<option value="${f.id}" ${f.id === 'A3' ? 'selected' : ''}>${f.id} (${f.widthMm}×${f.heightMm}mm)</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Orientacja w rysunku:', 'Orientation in Drawing:')}</label>
                <select id="tb-insert-orient" class="prop-input prop-input-full" style="text-align:left;">
                  <option value="landscape" selected>↔ ${tr('Pozioma (Landscape)', 'Landscape (Horizontal)')}</option>
                  <option value="portrait">↕ ${tr('Pionowa (Portrait)', 'Portrait (Vertical)')}</option>
                </select>
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-muted);">${tr('Skala arkusza:', 'Sheet Scale:')}</label>
                <select id="tb-insert-scale" class="prop-input prop-input-full" style="text-align:left;">
                  ${[1, 2, 5, 10, 20, 25, 50, 100, 200, 500]
                    .map(s => `<option value="${s}" ${s === defaultScaleDenom ? 'selected' : ''}>1:${s}</option>`)
                    .join('')}
                </select>
              </div>
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">
              <button type="button" class="top-btn highlight" id="tb-insert-landscape-btn">
                ↔ ${tr('Wstaw do rysunku (Poziomo)', 'Insert into Drawing (Landscape)')}
              </button>
              <button type="button" class="top-btn highlight" id="tb-insert-portrait-btn">
                ↕ ${tr('Wstaw do rysunku (Pionowo)', 'Insert into Drawing (Portrait)')}
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="gap: 8px; justify-content:space-between;">
          <button type="button" class="top-btn" id="tb-reset-btn">${tr('Przywróć domyślne', 'Reset Defaults')}</button>
          <div style="display:flex; gap:8px;">
            <button type="button" class="top-btn" id="tb-cancel-btn">${tr('Zamknij', 'Close')}</button>
            <button type="button" class="top-btn highlight" id="tb-save-btn">💾 ${tr('Zapisz szablon firmy', 'Save Company Template')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const readForm = (): TitleBlockTemplate => ({
      ...tpl,
      companyName: (overlay.querySelector('#tb-company') as HTMLInputElement).value.trim() || 'FIRMA',
      department: (overlay.querySelector('#tb-dept') as HTMLInputElement).value.trim(),
      drawingTitle: (overlay.querySelector('#tb-title') as HTMLInputElement).value.trim(),
      drawingNumber: (overlay.querySelector('#tb-number') as HTMLInputElement).value.trim(),
      revision: (overlay.querySelector('#tb-rev') as HTMLInputElement).value.trim(),
      author: (overlay.querySelector('#tb-author') as HTMLInputElement).value.trim(),
      checker: (overlay.querySelector('#tb-checker') as HTMLInputElement).value.trim(),
      custom1Label: (overlay.querySelector('#tb-c1-label') as HTMLInputElement).value.trim() || 'Pole 1',
      custom1Value: (overlay.querySelector('#tb-c1-val') as HTMLInputElement).value.trim(),
      custom2Label: (overlay.querySelector('#tb-c2-label') as HTMLInputElement).value.trim() || 'Pole 2',
      custom2Value: (overlay.querySelector('#tb-c2-val') as HTMLInputElement).value.trim(),
      materialOrNotes: (overlay.querySelector('#tb-notes') as HTMLInputElement).value.trim(),
      date: (overlay.querySelector('#tb-date') as HTMLInputElement).value.trim(),
      scaleText: `1:${(overlay.querySelector('#tb-insert-scale') as HTMLSelectElement).value}`,
      tableWidthMm: Math.max(100, Math.min(190, parseFloat((overlay.querySelector('#tb-width') as HTMLInputElement).value) || 180)),
      logoDataUrl: currentLogoDataUrl,
      useCustomDrawn: currentUseCustomDrawn,
    });

    const renderLivePreview = () => {
      const pCanvas = overlay.querySelector('#tb-live-preview-canvas') as HTMLCanvasElement | null;
      if (!pCanvas) return;
      const pctx = pCanvas.getContext('2d');
      if (!pctx) return;

      const curTpl = readForm();
      pctx.fillStyle = '#ffffff';
      pctx.fillRect(0, 0, pCanvas.width, pCanvas.height);

      // Render bottom-right corner of sheet with the title block at ~3.2 px/mm
      const pxPerMm = 3.2;
      this.drawOnPrintCanvas(
        pctx,
        pCanvas.width,
        pCanvas.height,
        pxPerMm,
        2,
        'A3',
        'landscape',
        curTpl.scaleText,
        doc.unit,
        curTpl
      );
    };

    renderLivePreview();

    // Update live preview when any input changes
    overlay.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => renderLivePreview());
    });

    // Mode toggle buttons
    const btnStd = overlay.querySelector('#tb-mode-standard') as HTMLButtonElement | null;
    const btnCust = overlay.querySelector('#tb-mode-custom') as HTMLButtonElement | null;
    const fieldsGrid = overlay.querySelector('#tb-fields-grid') as HTMLElement | null;

    btnStd?.addEventListener('click', () => {
      currentUseCustomDrawn = false;
      btnStd.classList.add('active');
      btnCust?.classList.remove('active');
      if (fieldsGrid) fieldsGrid.style.opacity = '1';
      renderLivePreview();
    });

    btnCust?.addEventListener('click', () => {
      if (!hasCustomSaved) return;
      currentUseCustomDrawn = true;
      btnCust.classList.add('active');
      btnStd?.classList.remove('active');
      if (fieldsGrid) fieldsGrid.style.opacity = '0.5';
      renderLivePreview();
    });

    // Logo upload & clear
    const logoInput = overlay.querySelector('#tb-logo-input') as HTMLInputElement;
    overlay.querySelector('#tb-logo-upload-btn')?.addEventListener('click', () => logoInput.click());
    logoInput?.addEventListener('change', e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          currentLogoDataUrl = dataUrl;
          CadRenderer.getCachedImage(dataUrl, () => {
            const thumb = overlay.querySelector('#tb-logo-thumb');
            if (thumb) {
              thumb.innerHTML = `<img src="${dataUrl}" style="max-width:100%; max-height:100%; object-fit:contain;" />`;
            }
            (overlay.querySelector('#tb-logo-clear-btn') as HTMLButtonElement).disabled = false;
            renderLivePreview();
          });
        }
      };
      reader.readAsDataURL(file);
    });

    overlay.querySelector('#tb-logo-clear-btn')?.addEventListener('click', () => {
      currentLogoDataUrl = undefined;
      const thumb = overlay.querySelector('#tb-logo-thumb');
      if (thumb) {
        thumb.innerHTML = `<span style="font-size:10px; color:#666;">${tr('Brak logo', 'No Logo')}</span>`;
      }
      (overlay.querySelector('#tb-logo-clear-btn') as HTMLButtonElement).disabled = true;
      renderLivePreview();
    });

    const close = () => overlay.remove();
    overlay.querySelector('#tb-modal-close')?.addEventListener('click', close);
    overlay.querySelector('#tb-cancel-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    // Place template on canvas for CAD editing
    overlay.querySelector('#tb-open-on-canvas-btn')?.addEventListener('click', () => {
      this.saveTemplate(readForm());
      close();
      this.openOnCanvasForEditing(doc, history, transform);
      requestRender();
    });

    // Capture custom drawn title block from canvas selection
    overlay.querySelector('#tb-capture-canvas-btn')?.addEventListener('click', () => {
      this.saveTemplate(readForm());
      const res = this.captureCustomTitleBlockFromSelection(doc);
      if (!res) {
        alert(
          tr(
            'Najpierw narysuj i zaznacz elementy swojej tabliczki na płótnie CAD (lub umieść je na warstwie „Ramka i Tabliczka”)!',
            'First draw and select the elements of your title block on the CAD canvas!'
          )
        );
        return;
      }
      alert(
        tr(
          `Zapisano własną tabliczkę rysunkową (${res.count} elem., wymiar: ${res.widthMm} × ${res.heightMm} mm)! Będzie ona automatycznie doklejana w prawym dolnym rogu arkusza.`,
          `Saved custom drawn title block (${res.count} items, size: ${res.widthMm} × ${res.heightMm} mm)! It will be automatically docked in the bottom-right corner of the sheet.`
        )
      );
      close();
      this.openModal(doc, history, transform, requestRender);
    });

    overlay.querySelector('#tb-reset-btn')?.addEventListener('click', () => {
      this.saveTemplate(this.getDefaultTemplate());
      close();
      this.openModal(doc, history, transform, requestRender);
    });

    overlay.querySelector('#tb-save-btn')?.addEventListener('click', () => {
      this.saveTemplate(readForm());
      close();
    });

    const handleInsert = (forcedOrient?: 'landscape' | 'portrait') => {
      const currentTpl = readForm();
      this.saveTemplate(currentTpl);
      const formatId = (overlay.querySelector('#tb-insert-format') as HTMLSelectElement).value as PaperFormatId;
      const orientSelect = (overlay.querySelector('#tb-insert-orient') as HTMLSelectElement).value as 'landscape' | 'portrait';
      const orient = forcedOrient || orientSelect;
      const scaleDenom = parseFloat((overlay.querySelector('#tb-insert-scale') as HTMLSelectElement).value) || 1;

      close();
      this.insertIntoDrawing(doc, history, transform, formatId, orient, scaleDenom);
      requestRender();
    };

    overlay.querySelector('#tb-insert-landscape-btn')?.addEventListener('click', () => handleInsert('landscape'));
    overlay.querySelector('#tb-insert-portrait-btn')?.addEventListener('click', () => handleInsert('portrait'));
  }
}

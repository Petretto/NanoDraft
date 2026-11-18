import { CadDocument } from '../model/document';
import { HistoryManager, Command } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { CadEntity, LineEntity, PolylineEntity, TextEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { tr } from '../i18n/lang';

export interface BomGroupRow {
  name: string;
  count: number;
  subEntitiesPerInstance: number;
  layerName: string;
}

export interface BomLayerRow {
  layerName: string;
  entityCount: number;
  totalLength: number;
}

export class BomManager {
  static computeBom(doc: CadDocument): { groupRows: BomGroupRow[]; layerRows: BomLayerRow[] } {
    // 1. Aggregate named groups / blocks (excluding title blocks, hatch groups, and BOM tables)
    const groupInstances = new Map<string, { name: string; countEntities: number; layerId: string }>();

    for (const ent of doc.entities) {
      if (!ent.groupId) continue;
      if (
        ent.groupId.startsWith('grp_title_block') ||
        ent.groupId.startsWith('grp_tb_') ||
        ent.groupId.startsWith('grp_hatch_') ||
        ent.groupId.startsWith('grp_bom_')
      ) {
        continue;
      }
      const existing = groupInstances.get(ent.groupId);
      if (existing) {
        existing.countEntities++;
      } else {
        groupInstances.set(ent.groupId, {
          name: ent.groupName || ent.groupId,
          countEntities: 1,
          layerId: ent.layerId,
        });
      }
    }

    // Aggregate identical group names (e.g. 6 copies of "Stół montażowy (2000 × 800 mm)" -> count: 6)
    const byName = new Map<string, BomGroupRow>();
    for (const inst of groupInstances.values()) {
      const layer = doc.layers.find(l => l.id === inst.layerId);
      const layerName = layer ? layer.name : inst.layerId;
      const key = inst.name.trim();
      const row = byName.get(key);
      if (row) {
        row.count++;
      } else {
        byName.set(key, {
          name: key,
          count: 1,
          subEntitiesPerInstance: inst.countEntities,
          layerName,
        });
      }
    }

    const groupRows = Array.from(byName.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    // 2. Summarize entities & total contour lengths by layer
    const layerMap = new Map<string, BomLayerRow>();
    for (const layer of doc.layers) {
      if (layer.id === 'title_block' || layer.id === 'underlay') continue;
      layerMap.set(layer.id, { layerName: layer.name, entityCount: 0, totalLength: 0 });
    }

    for (const ent of doc.entities) {
      if (ent.layerId === 'title_block' || ent.layerId === 'underlay') continue;
      let row = layerMap.get(ent.layerId);
      if (!row) {
        row = { layerName: ent.layerId, entityCount: 0, totalLength: 0 };
        layerMap.set(ent.layerId, row);
      }
      row.entityCount++;
      if (ent.type === 'line') {
        row.totalLength += VectorMath.distance({ x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 });
      } else if (ent.type === 'circle') {
        row.totalLength += 2 * Math.PI * ent.radius;
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        const segs = ent.closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segs; i++) {
          row.totalLength += VectorMath.distance(pts[i], pts[(i + 1) % pts.length]);
        }
      }
    }

    const layerRows = Array.from(layerMap.values()).filter(r => r.entityCount > 0);
    return { groupRows, layerRows };
  }

  static exportCsv(doc: CadDocument) {
    const { groupRows, layerRows } = this.computeBom(doc);
    const lines: string[] = [];

    lines.push(`${tr('ZESTAWIENIE BLOKÓW I GRUP (BOM)', 'BLOCKS & GROUPS BILL OF MATERIALS (BOM)')}`);
    lines.push(`${tr('Lp.', 'No.')};${tr('Nazwa bloku / grupy', 'Block / Group Name')};${tr('Ilość [szt.]', 'Qty [pcs]')};${tr('Warstwa', 'Layer')}`);
    groupRows.forEach((r, i) => {
      lines.push(`${i + 1};"${r.name.replace(/"/g, '""')}";${r.count};"${r.layerName.replace(/"/g, '""')}"`);
    });

    lines.push('');
    lines.push(`${tr('PODSUMOWANIE WEDŁUG WARSTW', 'SUMMARY BY LAYER')}`);
    lines.push(`${tr('Warstwa', 'Layer')};${tr('Liczba obiektów', 'Object Count')};${tr(`Łączna długość [${doc.unit}]`, `Total Length [${doc.unit}]`)}`);
    layerRows.forEach(r => {
      lines.push(`"${r.layerName.replace(/"/g, '""')}";${r.entityCount};${VectorMath.round(r.totalLength, 2).toString().replace('.', ',')}`);
    });

    // UTF-8 BOM for Polish Excel compatibility
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zestawienie_BOM_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static insertTableIntoDrawing(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform
  ) {
    const { groupRows, layerRows } = this.computeBom(doc);
    const useGroups = groupRows.length > 0;
    const dataRows = useGroups
      ? groupRows.map((r, i) => ({ col1: `${i + 1}`, col2: r.name, col3: `${r.count} ${tr('szt.', 'pcs')}` }))
      : layerRows.map((r, i) => ({
          col1: `${i + 1}`,
          col2: r.layerName,
          col3: `${r.entityCount} (${VectorMath.round(r.totalLength, 1)} ${doc.unit})`,
        }));

    if (dataRows.length === 0) return;

    // Determine reasonable table scale relative to current drawing or unit
    const unitScale = doc.unit === 'm' ? 0.1 : doc.unit === 'cm' ? 0.2 : doc.unit === 'in' ? 0.08 : 1.0;
    const tableW = 92 * unitScale;
    const rowH = 7.5 * unitScale;
    const hdrH = 9.5 * unitScale;
    const totalH = hdrH + rowH * (dataRows.length + 1);

    // Place table cleanly to the right of existing geometry or at viewport center
    const existingBounds = Geometry.unionBounds(doc.entities);
    let x0 = 0;
    let y0 = 0;
    if (existingBounds) {
      x0 = VectorMath.round(existingBounds.maxX + 10 * unitScale, 2);
      y0 = VectorMath.round(existingBounds.maxY - totalH, 2);
    } else {
      const center = transform.screenToWorld({ x: transform.screenWidth / 2, y: transform.screenHeight / 2 });
      x0 = VectorMath.round(center.x - tableW / 2, 2);
      y0 = VectorMath.round(center.y - totalH / 2, 2);
    }

    const layerId = doc.layers.some(l => l.id === 'annotations') ? 'annotations' : doc.activeLayerId;
    const groupId = `grp_bom_${Date.now()}`;
    const groupName = tr('Tabela Zestawieniowa BOM', 'BOM Table');
    const created: CadEntity[] = [];
    let seq = 1;
    const gid = (p: string) => `${p}_${Date.now()}_${seq++}`;

    // Outer table frame
    const outerRect: PolylineEntity = {
      id: gid('bom_box'),
      type: 'polyline',
      layerId,
      groupId,
      groupName,
      selected: true,
      closed: true,
      points: [
        { x: x0, y: y0 },
        { x: x0 + tableW, y: y0 },
        { x: x0 + tableW, y: y0 + totalH },
        { x: x0, y: y0 + totalH },
      ],
    };
    created.push(outerRect);

    const addLine = (x1: number, y1: number, x2: number, y2: number) => {
      const ln: LineEntity = {
        id: gid('bom_ln'),
        type: 'line',
        layerId,
        groupId,
        groupName,
        selected: true,
        x1,
        y1,
        x2,
        y2,
      };
      created.push(ln);
    };

    const addText = (x: number, y: number, w: number, h: number, text: string, fontH: number, align: 'left' | 'center' | 'right' = 'left') => {
      const t: TextEntity = {
        id: gid('bom_txt'),
        type: 'text',
        layerId,
        groupId,
        groupName,
        selected: true,
        x,
        y,
        boxWidth: w,
        boxHeight: h,
        text,
        height: fontH,
        rotation: 0,
        align,
        baseline: 'middle',
      };
      created.push(t);
    };

    // Title row at top: y from y0 + totalH - hdrH to y0 + totalH
    const titleY = y0 + totalH - hdrH;
    addLine(x0, titleY, x0 + tableW, titleY);
    addText(
      x0 + 1.5 * unitScale,
      titleY,
      tableW - 3 * unitScale,
      hdrH,
      useGroups ? tr('ZESTAWIENIE ELEMENTÓW (BOM)', 'BILL OF MATERIALS (BOM)') : tr('ZESTAWIENIE WARSTW', 'LAYER SUMMARY'),
      3.0 * unitScale,
      'center'
    );

    // Column dividers (Col1: 12%, Col2: 64%, Col3: 24%)
    const col1X = x0 + tableW * 0.12;
    const col2X = x0 + tableW * 0.74;
    addLine(col1X, y0, col1X, titleY);
    addLine(col2X, y0, col2X, titleY);

    // Sub-header row
    const subHdrY = titleY - rowH;
    addLine(x0, subHdrY, x0 + tableW, subHdrY);
    addText(x0 + 1 * unitScale, subHdrY, tableW * 0.12 - 2 * unitScale, rowH, tr('Lp.', 'No.'), 2.4 * unitScale, 'center');
    addText(col1X + 2 * unitScale, subHdrY, col2X - col1X - 4 * unitScale, rowH, useGroups ? tr('Nazwa elementu / grupy', 'Element / Group Name') : tr('Warstwa', 'Layer'), 2.4 * unitScale, 'left');
    addText(col2X + 1 * unitScale, subHdrY, x0 + tableW - col2X - 2 * unitScale, rowH, useGroups ? tr('Ilość', 'Qty') : tr('Obiekty', 'Count'), 2.4 * unitScale, 'center');

    // Data rows
    dataRows.forEach((r, idx) => {
      const ry = subHdrY - (idx + 1) * rowH;
      if (idx < dataRows.length - 1) {
        addLine(x0, ry, x0 + tableW, ry);
      }
      addText(x0 + 1 * unitScale, ry, tableW * 0.12 - 2 * unitScale, rowH, r.col1, 2.2 * unitScale, 'center');
      addText(col1X + 2 * unitScale, ry, col2X - col1X - 4 * unitScale, rowH, r.col2, 2.2 * unitScale, 'left');
      addText(col2X + 1 * unitScale, ry, x0 + tableW - col2X - 2 * unitScale, rowH, r.col3, 2.2 * unitScale, 'center');
    });

    const cmd: Command = {
      description: tr('Wstaw tabelę zestawieniową BOM', 'Insert BOM table'),
      execute: () => {
        doc.clearSelection();
        created.forEach(e => {
          doc.addEntity(e);
          doc.selectedEntityIds.add(e.id);
          e.selected = true;
        });
        doc.notifyChange();
      },
      undo: () => {
        created.forEach(e => doc.removeEntity(e.id));
      },
    };
    history.execute(cmd);

    const allBounds = Geometry.unionBounds(doc.entities);
    if (allBounds) transform.zoomToFit(allBounds);
  }

  static openModal(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    requestRender: () => void
  ) {
    const existing = document.getElementById('cad-bom-modal-overlay');
    if (existing) existing.remove();

    const { groupRows, layerRows } = this.computeBom(doc);

    const overlay = document.createElement('div');
    overlay.id = 'cad-bom-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 620px; max-width: 96vw;">
        <div class="modal-header">
          <h3>📊 ${tr('Automatyczne Zestawienie Elementów (BOM)', 'Automatic Bill of Materials (BOM)')}</h3>
          <button class="modal-close-btn" id="bom-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:14px; max-height:74vh; overflow-y:auto;">

          <div>
            <div style="font-weight:600; font-size:12px; color:var(--accent-color); margin-bottom:6px;">
              📦 ${tr('Zliczone Bloki, Szyki i Grupy obiektów:', 'Counted Blocks, Arrays & Object Groups:')}
            </div>
            ${
              groupRows.length === 0
                ? `<div style="padding:10px; font-size:12px; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:6px;">
                    ${tr('Brak nazwanych bloków lub grup na rysunku (użyj Ctrl+G lub Biblioteki Bloków B, aby zgrupować powtarzalne elementy).', 'No named blocks or groups found (use Ctrl+G or Blocks Library B to group repeating items).')}
                  </div>`
                : `<table class="layers-table">
                    <thead>
                      <tr>
                        <th>${tr('Lp.', 'No.')}</th>
                        <th>${tr('Nazwa bloku / grupy', 'Block / Group Name')}</th>
                        <th>${tr('Warstwa', 'Layer')}</th>
                        <th style="text-align:right;">${tr('Ilość', 'Qty')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${groupRows
                        .map(
                          (r, i) => `
                        <tr>
                          <td>${i + 1}</td>
                          <td style="font-weight:600; color:#fff;">${r.name}</td>
                          <td style="color:var(--text-muted);">${r.layerName}</td>
                          <td style="text-align:right; font-weight:700; color:var(--accent-color);">${r.count} ${tr('szt.', 'pcs')}</td>
                        </tr>
                      `
                        )
                        .join('')}
                    </tbody>
                  </table>`
            }
          </div>

          <div>
            <div style="font-weight:600; font-size:12px; color:var(--text-main); margin-bottom:6px;">
              🎨 ${tr('Podsumowanie geometrii według warstw (z łączną długością konturów):', 'Geometry Summary by Layer (with total contour length):')}
            </div>
            <table class="layers-table">
              <thead>
                <tr>
                  <th>${tr('Warstwa', 'Layer')}</th>
                  <th style="text-align:right;">${tr('Liczba obiektów', 'Objects')}</th>
                  <th style="text-align:right;">${tr(`Łączna długość [${doc.unit}]`, `Total Length [${doc.unit}]`)}</th>
                </tr>
              </thead>
              <tbody>
                ${layerRows
                  .map(
                    r => `
                  <tr>
                    <td>${r.layerName}</td>
                    <td style="text-align:right;">${r.entityCount}</td>
                    <td style="text-align:right; font-family:var(--font-mono);">${VectorMath.round(r.totalLength, 2)} ${doc.unit}</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between; gap:8px;">
          <button type="button" class="top-btn" id="bom-csv-btn">📥 ${tr('Eksportuj CSV (Excel)', 'Export CSV (Excel)')}</button>
          <div style="display:flex; gap:8px;">
            <button type="button" class="top-btn" id="bom-cancel-btn">${tr('Zamknij', 'Close')}</button>
            <button type="button" class="top-btn highlight" id="bom-insert-btn">📋 ${tr('Wstaw Tabelę BOM na rysunek', 'Insert BOM Table into Drawing')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#bom-close')?.addEventListener('click', close);
    overlay.querySelector('#bom-cancel-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#bom-csv-btn')?.addEventListener('click', () => {
      this.exportCsv(doc);
    });

    overlay.querySelector('#bom-insert-btn')?.addEventListener('click', () => {
      close();
      this.insertTableIntoDrawing(doc, history, transform);
      requestRender();
    });
  }
}

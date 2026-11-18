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
    const totalLengthAll = layerRows.reduce((acc, r) => acc + r.totalLength, 0);
    const totalEntitiesAll = layerRows.reduce((acc, r) => acc + r.entityCount, 0);

    const overlay = document.createElement('div');
    overlay.id = 'cad-bom-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    let filterQuery = '';

    const renderModalBody = () => {
      const q = filterQuery.trim().toLowerCase();
      const filteredGroups = q
        ? groupRows.filter(r => r.name.toLowerCase().includes(q) || r.layerName.toLowerCase().includes(q))
        : groupRows;
      const filteredLayers = q
        ? layerRows.filter(r => r.layerName.toLowerCase().includes(q))
        : layerRows;

      const bodyEl = overlay.querySelector('#bom-tables-container') as HTMLElement | null;
      if (!bodyEl) return;

      bodyEl.innerHTML = `
        <div>
          <div style="font-weight:600; font-size:12px; color:var(--accent-color); margin-bottom:6px;">
            📦 ${tr('Zliczone Bloki, Szyki i Grupy obiektów:', 'Counted Blocks, Arrays & Object Groups:')} (${filteredGroups.length})
          </div>
          ${
            filteredGroups.length === 0
              ? `<div style="padding:10px; font-size:12px; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:6px;">
                  ${tr('Brak pasujących bloków lub grup na rysunku (użyj Ctrl+G lub Biblioteki Bloków B, aby zgrupować powtarzalne elementy).', 'No matching blocks or groups found (use Ctrl+G or Blocks Library B to group repeating items).')}
                </div>`
              : `<table class="layers-table">
                  <thead>
                    <tr>
                      <th style="width:52px; text-align:center;">${tr('Poz.', 'No.')}</th>
                      <th>${tr('Element / Oznaczenie techniczne', 'Element / Technical Designation')}</th>
                      <th>${tr('Warstwa CAD', 'CAD Layer')}</th>
                      <th style="text-align:right;">${tr('Ilość', 'Qty')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredGroups
                      .map(
                        (r, i) => `
                      <tr>
                        <td style="text-align:center; color:var(--text-muted); font-family:var(--font-mono);">${i + 1}</td>
                        <td style="font-weight:600; color:#fff;">${r.name}</td>
                        <td style="color:#38BDF8; font-family:var(--font-mono);">${r.layerName}</td>
                        <td style="text-align:right; font-weight:700; font-family:var(--font-mono); color:var(--accent-color);">${r.count} ${tr('szt.', 'pcs')}</td>
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
                <th>${tr('Warstwa CAD', 'CAD Layer')}</th>
                <th style="text-align:right;">${tr('Liczba obiektów', 'Object Count')}</th>
                <th style="text-align:right;">${tr(`Łączna długość [${doc.unit}]`, `Total Length [${doc.unit}]`)}</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLayers
                .map(
                  r => `
                <tr>
                  <td style="font-weight:500; color:#fff;">${r.layerName}</td>
                  <td style="text-align:right; font-family:var(--font-mono);">${r.entityCount}</td>
                  <td style="text-align:right; font-family:var(--font-mono); font-weight:600; color:var(--accent-color);">${VectorMath.round(r.totalLength, 2)} ${doc.unit}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    };

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 780px; max-width: 96vw;">
        <div class="modal-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:32px; height:32px; border-radius:6px; background:rgba(129,140,248,0.18); border:1px solid rgba(129,140,248,0.45); color:#818CF8; display:flex; align-items:center; justify-content:center; font-size:16px;">
              📊
            </div>
            <div>
              <h3 style="margin:0;">${tr('Zestawienie Materiałowe (BOM / Bill of Materials)', 'Bill of Materials (BOM)')}</h3>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                ${tr('Automatyczny audyt bloków przemysłowych, szyków, grup i długości konturów', 'Automatic audit of industrial blocks, arrays, groups & contour lengths')}
              </div>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:10px;">
            <div style="padding:4px 10px; border-radius:5px; background:#16181D; border:1px solid var(--border-subtle); font-family:var(--font-mono); font-size:11px; color:#CBD5E1;">
              ${tr('Elementów:', 'Entities:')} <strong style="color:#fff;">${totalEntitiesAll}</strong>
              <span style="margin:0 6px; color:#64748B;">|</span>
              ${tr('Długość łączna:', 'Total length:')} <strong style="color:var(--accent-color);">${VectorMath.round(totalLengthAll, 1)} ${doc.unit}</strong>
            </div>
            <button class="modal-close-btn" id="bom-close">&times;</button>
          </div>
        </div>

        <!-- Filter Toolbar -->
        <div style="padding:9px 20px; background:rgba(17,19,23,0.75); border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="font-size:11px; color:var(--text-muted);">
            ${tr('Zestawienie gotowe do eksportu CSV (Excel / ERP) oraz wstawienia na arkusz CAD.', 'Summary ready for CSV (Excel / ERP) export and CAD drawing insertion.')}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:11px; color:var(--text-muted);">${tr('Szukaj:', 'Filter:')}</span>
            <input type="text" id="bom-filter-input" placeholder="${tr('Filtruj tabelę...', 'Filter table...')}" class="prop-input" style="width:175px; text-align:left;" />
          </div>
        </div>

        <div id="bom-tables-container" class="modal-body" style="display:flex; flex-direction:column; gap:14px; max-height:64vh; overflow-y:auto;"></div>

        <div class="modal-footer">
          <div style="font-family:var(--font-mono); font-size:11px; color:#10B981;">
            ✓ ${tr('Kodowanie UTF-8 z BOM (zgodne z polskim Excelem)', 'UTF-8 with BOM encoding (Excel compatible)')}
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" class="top-btn" id="bom-cancel-btn">${tr('Zamknij', 'Close')}</button>
            <button type="button" class="top-btn highlight" id="bom-insert-btn">📋 ${tr('Wstaw tabelę na rysunek', 'Insert Table into Drawing')}</button>
            <button type="button" class="top-btn btn-portable" id="bom-csv-btn">📥 ${tr('Eksportuj CSV (Excel)', 'Export CSV (Excel)')}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    renderModalBody();

    const filterInp = overlay.querySelector('#bom-filter-input') as HTMLInputElement | null;
    filterInp?.addEventListener('keydown', e => e.stopPropagation());
    filterInp?.addEventListener('input', () => {
      filterQuery = filterInp.value;
      renderModalBody();
    });

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

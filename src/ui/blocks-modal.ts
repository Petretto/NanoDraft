import { CadDocument } from '../model/document';
import { HistoryManager, Command } from '../model/history';
import { ViewportTransform, UNIT_SCALE_TO_MM } from '../math/transform';
import { CadEntity, UnitType } from '../types/cad';
import { Geometry } from '../math/geometry';
import { tr } from '../i18n/lang';

export interface CadBlockDefinition {
  id: string;
  namePl: string;
  nameEn: string;
  category: string;
  baseUnit: UnitType;
  isCustom?: boolean;
  entities: CadEntity[]; // centered around (0, 0) in baseUnit
}

const CUSTOM_BLOCKS_KEY = 'nanodraft_custom_blocks_v1';

export class BlocksManager {
  static getBuiltInBlocks(): CadBlockDefinition[] {
    // Helper to create arc points
    const makeArc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number, steps = 16) => {
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const deg = startDeg + ((endDeg - startDeg) * i) / steps;
        const rad = (deg * Math.PI) / 180;
        pts.push({ x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r });
      }
      return pts;
    };

    return [
      {
        id: 'builtin_worktable_2000x800',
        namePl: 'Stół montażowy (2000 × 800 mm)',
        nameEn: 'Assembly Table (2000 × 800 mm)',
        category: 'Halowe / Produkcyjne',
        baseUnit: 'mm',
        entities: [
          {
            id: 'wt_1',
            type: 'polyline',
            layerId: 'elements',
            closed: true,
            points: [
              { x: -1000, y: -400 },
              { x: 1000, y: -400 },
              { x: 1000, y: 400 },
              { x: -1000, y: 400 },
            ],
          },
          {
            id: 'wt_2',
            type: 'line',
            layerId: 'elements',
            x1: -1000,
            y1: 220,
            x2: 1000,
            y2: 220,
          },
          {
            id: 'wt_3',
            type: 'text',
            layerId: 'elements',
            x: -900,
            y: -300,
            boxWidth: 1800,
            boxHeight: 450,
            text: 'STÓŁ 2000x800',
            height: 110,
            rotation: 0,
            align: 'center',
            baseline: 'middle',
          },
        ],
      },
      {
        id: 'builtin_eur_pallet_1200x800',
        namePl: 'Paleta EUR (1200 × 800 mm)',
        nameEn: 'EUR Pallet (1200 × 800 mm)',
        category: 'Logistyka / Magazyn',
        baseUnit: 'mm',
        entities: [
          {
            id: 'pal_1',
            type: 'polyline',
            layerId: 'elements',
            closed: true,
            points: [
              { x: -600, y: -400 },
              { x: 600, y: -400 },
              { x: 600, y: 400 },
              { x: -600, y: 400 },
            ],
          },
          { id: 'pal_2', type: 'line', layerId: 'elements', x1: -600, y1: -260, x2: 600, y2: -260 },
          { id: 'pal_3', type: 'line', layerId: 'elements', x1: -600, y1: 260, x2: 600, y2: 260 },
          {
            id: 'pal_4',
            type: 'text',
            layerId: 'elements',
            x: -500,
            y: -200,
            boxWidth: 1000,
            boxHeight: 400,
            text: 'EUR 1200x800',
            height: 100,
            rotation: 0,
            align: 'center',
            baseline: 'middle',
          },
        ],
      },
      {
        id: 'builtin_rack_2700x1000',
        namePl: 'Regał magazynowy (2700 × 1000 mm)',
        nameEn: 'Storage Rack (2700 × 1000 mm)',
        category: 'Logistyka / Magazyn',
        baseUnit: 'mm',
        entities: [
          {
            id: 'rk_1',
            type: 'polyline',
            layerId: 'elements',
            closed: true,
            points: [
              { x: -1350, y: -500 },
              { x: 1350, y: -500 },
              { x: 1350, y: 500 },
              { x: -1350, y: 500 },
            ],
          },
          { id: 'rk_2', type: 'line', layerId: 'elements', x1: -1350, y1: -500, x2: 1350, y2: 500 },
          { id: 'rk_3', type: 'line', layerId: 'elements', x1: -1350, y1: 500, x2: 1350, y2: -500 },
        ],
      },
      {
        id: 'builtin_column_heb300',
        namePl: 'Słup stalowy HEB (300 × 300 mm)',
        nameEn: 'Steel Column HEB (300 × 300 mm)',
        category: 'Budynek / Konstrukcja',
        baseUnit: 'mm',
        entities: [
          {
            id: 'col_1',
            type: 'polyline',
            layerId: 'elements',
            closed: true,
            points: [
              { x: -150, y: -150 },
              { x: 150, y: -150 },
              { x: 150, y: 150 },
              { x: -150, y: 150 },
            ],
          },
          { id: 'col_2', type: 'line', layerId: 'elements', x1: -120, y1: 120, x2: 120, y2: 120 },
          { id: 'col_3', type: 'line', layerId: 'elements', x1: -120, y1: -120, x2: 120, y2: -120 },
          { id: 'col_4', type: 'line', layerId: 'elements', x1: 0, y1: -120, x2: 0, y2: 120 },
        ],
      },
      {
        id: 'builtin_door_900',
        namePl: 'Drzwi 900 mm (otwarcie 90°)',
        nameEn: 'Door 900 mm (90° swing)',
        category: 'Budynek / Konstrukcja',
        baseUnit: 'mm',
        entities: [
          { id: 'dr_1', type: 'line', layerId: 'elements', x1: -450, y1: -450, x2: -450, y2: 450 },
          {
            id: 'dr_2',
            type: 'polyline',
            layerId: 'elements',
            closed: false,
            lineType: 'dashed',
            points: makeArc(-450, -450, 900, 0, 90, 16),
          },
        ],
      },
    ];
  }

  static loadCustomBlocks(): CadBlockDefinition[] {
    try {
      const raw = localStorage.getItem(CUSTOM_BLOCKS_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static saveCustomBlocks(blocks: CadBlockDefinition[]) {
    try {
      localStorage.setItem(CUSTOM_BLOCKS_KEY, JSON.stringify(blocks));
    } catch {
      // ignore storage quota errors
    }
  }

  static saveSelectionAsBlock(doc: CadDocument, name: string): CadBlockDefinition | null {
    const sel = doc.getSelectedEntities();
    if (sel.length === 0) return null;

    const bounds = Geometry.unionBounds(sel);
    if (!bounds) return null;

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;

    const centeredEntities = sel.map(ent => {
      const copy = Geometry.transformEntity(ent, p => ({
        x: Math.round((p.x - cx) * 1000) / 1000,
        y: Math.round((p.y - cy) * 1000) / 1000,
      }));
      copy.selected = false;
      delete copy.groupId;
      delete copy.groupName;
      return copy;
    });

    const newBlock: CadBlockDefinition = {
      id: `custom_blk_${Date.now()}`,
      namePl: name,
      nameEn: name,
      category: tr('Własne bloki', 'Custom Blocks'),
      baseUnit: doc.unit,
      isCustom: true,
      entities: centeredEntities,
    };

    const custom = this.loadCustomBlocks();
    custom.push(newBlock);
    this.saveCustomBlocks(custom);
    return newBlock;
  }

  static insertBlock(
    block: CadBlockDefinition,
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    rotationDeg: number = 0,
    scaleFactor: number = 1.0
  ) {
    // Convert from block.baseUnit to doc.unit
    const unitRatio = UNIT_SCALE_TO_MM[block.baseUnit] / UNIT_SCALE_TO_MM[doc.unit];
    const totalScale = unitRatio * scaleFactor;
    const rad = (rotationDeg * Math.PI) / 180;

    // Insert at current viewport center
    const centerScreen = { x: transform.screenWidth / 2, y: transform.screenHeight / 2 };
    const insertPt = transform.screenToWorld(centerScreen);

    const groupId = `grp_blk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const groupName = tr(block.namePl, block.nameEn);
    const activeLayerId = doc.activeLayerId;

    const inserted: CadEntity[] = block.entities.map(ent => {
      const copy = Geometry.transformEntity(
        ent,
        p => {
          const sx = p.x * totalScale;
          const sy = p.y * totalScale;
          const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
          const ry = sx * Math.sin(rad) + sy * Math.cos(rad);
          return {
            x: Math.round((insertPt.x + rx) * 1000) / 1000,
            y: Math.round((insertPt.y + ry) * 1000) / 1000,
          };
        },
        { scale: totalScale, angleDeltaDeg: rotationDeg }
      );
      copy.layerId = activeLayerId;
      copy.groupId = groupId;
      copy.groupName = groupName;
      copy.selected = true;
      return copy;
    });

    const cmd: Command = {
      description: tr(`Wstaw blok: ${groupName}`, `Insert block: ${groupName}`),
      execute: () => {
        doc.clearSelection();
        inserted.forEach(e => {
          doc.addEntity(e);
          doc.selectedEntityIds.add(e.id);
          e.selected = true;
        });
        doc.notifyChange();
      },
      undo: () => {
        inserted.forEach(e => doc.removeEntity(e.id));
      },
    };
    history.execute(cmd);
  }

  static openModal(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    requestRender: () => void
  ) {
    const existing = document.getElementById('cad-blocks-modal-overlay');
    if (existing) existing.remove();

    const builtIn = this.getBuiltInBlocks();
    const custom = this.loadCustomBlocks();
    const allBlocks = [...custom, ...builtIn];
    const selCount = doc.getSelectedEntities().length;

    const overlay = document.createElement('div');
    overlay.id = 'cad-blocks-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 560px; max-width: 95vw;">
        <div class="modal-header">
          <h3>📦 ${tr('Biblioteka Bloków i Symboli CAD (B)', 'CAD Blocks & Symbols Library (B)')}</h3>
          <button class="modal-close-btn" id="blk-modal-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:12px; max-height:72vh; overflow-y:auto;">
          <!-- Create custom block from current selection -->
          <div style="background:rgba(0, 229, 255, 0.07); border:1px solid var(--border-color); border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:6px;">
            <div style="font-size:12px; font-weight:600; color:var(--text-main);">
              ➕ ${tr('Utwórz własny blok z aktualnie zaznaczonych obiektów', 'Create Custom Block from Current Selection')} (${selCount} ${tr('zazn.', 'sel.')})
            </div>
            <div style="display:flex; gap:8px;">
              <input id="blk-new-name" type="text" class="prop-input prop-input-full" placeholder="${tr('Nazwa nowego bloku, np. Stanowisko Montażowe A...', 'New block name, e.g. Workstation A...')}" ${selCount === 0 ? 'disabled' : ''} />
              <button id="blk-save-sel-btn" class="top-btn highlight" ${selCount === 0 ? 'disabled' : ''} style="white-space:nowrap;">
                💾 ${tr('Zapisz jako blok', 'Save as Block')}
              </button>
            </div>
            ${
              selCount === 0
                ? `<small style="color:var(--text-muted); font-size:11px;">${tr('Wskazówka: Zaznacz dowolne elementy na rysunku, aby zapisać je tutaj jako blok wielokrotnego użytku.', 'Tip: Select any objects on the drawing to save them here as a reusable block.')}</small>`
                : ''
            }
          </div>

          <!-- Insert options -->
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div class="prop-row">
              <span>${tr('Kąt wstawienia [°]:', 'Insertion Angle [°]:')}</span>
              <select id="blk-angle" class="prop-input" style="width:110px;">
                <option value="0" selected>0°</option>
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </div>
            <div class="prop-row">
              <span>${tr('Skala bloku:', 'Block Scale:')}</span>
              <input id="blk-scale" type="number" step="0.1" min="0.1" value="1.0" class="prop-input" style="width:90px;" />
            </div>
          </div>

          <!-- List of available blocks -->
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${allBlocks
              .map(
                b => `
              <div class="layer-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-primary);">
                <div>
                  <div style="font-weight:600; font-size:13px; color:var(--text-main);">
                    ${b.isCustom ? '⭐ ' : '📦 '}${tr(b.namePl, b.nameEn)}
                  </div>
                  <div style="font-size:11px; color:var(--text-muted);">
                    ${b.category} • ${b.entities.length} ${tr('elem.', 'items')} • ${tr('jedn. bazowa:', 'base unit:')} ${b.baseUnit}
                  </div>
                </div>
                <div style="display:flex; gap:6px;">
                  ${
                    b.isCustom
                      ? `<button class="top-btn blk-del-btn" data-id="${b.id}" title="${tr('Usuń własny blok', 'Delete custom block')}">🗑️</button>`
                      : ''
                  }
                  <button class="top-btn highlight blk-insert-btn" data-id="${b.id}">
                    📥 ${tr('Wstaw', 'Insert')}
                  </button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="top-btn" id="blk-close-btn">${tr('Zamknij', 'Close')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#blk-modal-close')?.addEventListener('click', close);
    overlay.querySelector('#blk-close-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#blk-save-sel-btn')?.addEventListener('click', () => {
      const inp = overlay.querySelector('#blk-new-name') as HTMLInputElement;
      const name = inp.value.trim() || `${tr('Własny blok', 'Custom Block')} #${custom.length + 1}`;
      this.saveSelectionAsBlock(doc, name);
      close();
      this.openModal(doc, history, transform, requestRender);
    });

    overlay.querySelectorAll('.blk-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).getAttribute('data-id');
        const nextCustom = this.loadCustomBlocks().filter(b => b.id !== id);
        this.saveCustomBlocks(nextCustom);
        close();
        this.openModal(doc, history, transform, requestRender);
      });
    });

    overlay.querySelectorAll('.blk-insert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).getAttribute('data-id');
        const blk = allBlocks.find(b => b.id === id);
        if (!blk) return;

        const ang = parseFloat((overlay.querySelector('#blk-angle') as HTMLSelectElement).value) || 0;
        const sc = parseFloat((overlay.querySelector('#blk-scale') as HTMLInputElement).value) || 1.0;

        close();
        this.insertBlock(blk, doc, history, transform, ang, sc);
        requestRender();
      });
    });
  }
}

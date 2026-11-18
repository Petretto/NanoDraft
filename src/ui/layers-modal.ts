import { CadDocument } from '../model/document';
import { Layer } from '../types/cad';
import { svgIcon } from './icons';
import { tr } from '../i18n/lang';

export class LayersModal {
  static open(doc: CadDocument, onUpdate: () => void) {
    const existing = document.getElementById('cad-layers-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cad-layers-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'cad-modal';
    modal.style.width = '760px';

    const close = () => {
      if (overlay.parentElement) overlay.remove();
    };

    const renderContent = () => {
      modal.innerHTML = `
        <div class="modal-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:32px; height:32px; border-radius:6px; background:rgba(0,229,255,0.18); border:1px solid rgba(0,229,255,0.4); color:#00E5FF; display:flex; align-items:center; justify-content:center;">
              ${svgIcon('layers', 18)}
            </div>
            <div>
              <h3 style="margin:0;">${tr('Menedżer Warstw Rysunku (AutoCAD Layers)', 'Drawing Layer Manager (AutoCAD Layers)')}</h3>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                ${tr('Konfiguruj nazwy, kolory wektorów, typy linii i blokady dla DXF', 'Configure names, vector colors, linetypes and locks for DXF')}
              </div>
            </div>
          </div>
          <button class="modal-close-btn" id="lay-close-top" title="${tr('Zamknij', 'Close')}">${svgIcon('close', 18)}</button>
        </div>

        <!-- Layer Quick Actions Bar -->
        <div style="padding:10px 20px; background:rgba(17,19,23,0.75); border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px; flex:1;">
            <input type="text" id="new-layer-name" placeholder="${tr('Nazwa nowej warstwy (np. 05_Instalacje)...', 'New layer name (e.g. 05_HVAC)...')}" class="prop-input" style="width:220px; text-align:left;" />
            <input type="color" id="new-layer-color" value="#00E5FF" style="width:28px; height:26px; border:1px solid var(--border-subtle); border-radius:4px; background:transparent; cursor:pointer;" />
            <button id="btn-add-layer" class="top-btn cta-dxf" style="padding:5px 10px;">
              ${svgIcon('add', 14)}
              <span>${tr('Nowa warstwa', 'New Layer')}</span>
            </button>
          </div>
          <div style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted);">
            ${tr('Warstw łącznie:', 'Total layers:')} <strong style="color:#fff;">${doc.layers.length}</strong>
          </div>
        </div>

        <div class="modal-body" style="max-height:62vh; overflow-y:auto;">
          <table class="layers-table">
            <thead>
              <tr>
                <th style="width:58px; text-align:center;">${tr('Bieżąca', 'Active')}</th>
                <th>${tr('Nazwa warstwy', 'Layer Name')}</th>
                <th>${tr('Kolor DXF', 'DXF Color')}</th>
                <th>${tr('Rodzaj linii', 'Line Type')}</th>
                <th>${tr('Grubość', 'Width')}</th>
                <th style="width:68px; text-align:center;">${tr('Widoczna', 'Visible')}</th>
                <th style="width:68px; text-align:center;">${tr('Zablokuj', 'Lock')}</th>
              </tr>
            </thead>
            <tbody>
              ${doc.layers
                .map(
                  l => `
                <tr class="${l.id === doc.activeLayerId ? 'active-row' : ''}" data-id="${l.id}">
                  <td style="text-align:center;">
                    <input type="radio" name="active-layer" value="${l.id}" ${l.id === doc.activeLayerId ? 'checked' : ''} style="accent-color:#00E5FF; cursor:pointer;" />
                  </td>
                  <td>
                    <input type="text" class="prop-input layer-name-input" data-id="${l.id}" value="${l.name.replace(/"/g, '&quot;')}" style="width:160px; text-align:left; font-family:var(--font-sans); font-weight:${l.id === doc.activeLayerId ? '600' : '400'}; color:${l.id === doc.activeLayerId ? '#fff' : '#E2E8F0'};" />
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <input type="color" class="layer-color-input" data-id="${l.id}" value="${l.color}" style="width:24px; height:22px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; background:transparent; cursor:pointer;" />
                      <span style="font-family:var(--font-mono); font-size:11px; color:${l.color};">${l.color.toUpperCase()}</span>
                    </div>
                  </td>
                  <td>
                    <select class="layer-linetype-select" data-id="${l.id}">
                      <option value="continuous" ${l.lineType === 'continuous' ? 'selected' : ''}>${tr('Continuous (Ciągła)', 'Continuous')}</option>
                      <option value="dashed" ${l.lineType === 'dashed' ? 'selected' : ''}>${tr('Dashed (Kreskowa)', 'Dashed')}</option>
                      <option value="dashdot" ${l.lineType === 'dashdot' ? 'selected' : ''}>${tr('Center (Osiowa _._)', 'Center (_._)')}</option>
                      <option value="dotted" ${l.lineType === 'dotted' ? 'selected' : ''}>${tr('Dotted (Kropkowana)', 'Dotted')}</option>
                    </select>
                  </td>
                  <td>
                    <select class="layer-width-select" data-id="${l.id}">
                      <option value="0.5" ${l.lineWidth === 0.5 ? 'selected' : ''}>0.50 mm</option>
                      <option value="0.8" ${l.lineWidth === 0.8 ? 'selected' : ''}>0.80 mm</option>
                      <option value="1.0" ${l.lineWidth === 1.0 ? 'selected' : ''}>1.00 mm</option>
                      <option value="1.5" ${l.lineWidth === 1.5 ? 'selected' : ''}>1.50 mm</option>
                      <option value="2.0" ${l.lineWidth === 2.0 ? 'selected' : ''}>2.00 mm</option>
                      <option value="2.5" ${l.lineWidth === 2.5 ? 'selected' : ''}>2.50 mm</option>
                    </select>
                  </td>
                  <td style="text-align:center;">
                    <button class="layer-toggle-btn toggle-vis" data-id="${l.id}" style="color:${l.visible ? '#00E5FF' : '#64748B'};" title="${tr('Przełącz widoczność warstwy', 'Toggle layer visibility')}">
                      ${svgIcon(l.visible ? 'visibility' : 'visibility_off', 17)}
                    </button>
                  </td>
                  <td style="text-align:center;">
                    <button class="layer-toggle-btn toggle-lock" data-id="${l.id}" style="color:${l.locked ? '#F59E0B' : '#94A3B8'};" title="${tr('Zablokuj / Odblokuj edycję warstwy', 'Lock / Unlock layer editing')}">
                      ${svgIcon(l.locked ? 'lock' : 'lock_open', 17)}
                    </button>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <div class="modal-footer">
          <span style="font-family:var(--font-mono); font-size:11px; color:var(--text-muted);">
            ${tr('Zmiany zapisywane automatycznie w strukturze projektu.', 'Changes are automatically saved in the project structure.')}
          </span>
          <button id="modal-btn-close" class="top-btn cta-dxf">${tr('Zatwierdź', 'Done')}</button>
        </div>
      `;

      modal.querySelector('#lay-close-top')?.addEventListener('click', close);
      modal.querySelector('#modal-btn-close')?.addEventListener('click', close);

      // Active layer radio
      modal.querySelectorAll('input[name="active-layer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
          doc.activeLayerId = (e.target as HTMLInputElement).value;
          doc.notifyChange();
          renderContent();
          onUpdate();
        });
      });

      // Layer name edit
      modal.querySelectorAll('.layer-name-input').forEach(inp => {
        inp.addEventListener('keydown', e => e.stopPropagation());
        inp.addEventListener('change', (e) => {
          const id = (inp as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          const val = (e.target as HTMLInputElement).value.trim();
          if (l && val) {
            l.name = val;
            doc.notifyChange();
            onUpdate();
          }
        });
      });

      // Visibility toggle
      modal.querySelectorAll('.toggle-vis').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = (btn as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          if (l) {
            l.visible = !l.visible;
            doc.notifyChange();
            renderContent();
            onUpdate();
          }
        });
      });

      // Lock toggle
      modal.querySelectorAll('.toggle-lock').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = (btn as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          if (l) {
            l.locked = !l.locked;
            doc.notifyChange();
            renderContent();
            onUpdate();
          }
        });
      });

      // Color change
      modal.querySelectorAll('.layer-color-input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const id = (inp as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          if (l) {
            l.color = (e.target as HTMLInputElement).value;
            doc.notifyChange();
            renderContent();
            onUpdate();
          }
        });
      });

      // Line type change
      modal.querySelectorAll('.layer-linetype-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const id = (sel as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          if (l) {
            l.lineType = (e.target as HTMLSelectElement).value as Layer['lineType'];
            doc.notifyChange();
            onUpdate();
          }
        });
      });

      // Width change
      modal.querySelectorAll('.layer-width-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const id = (sel as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          if (l) {
            l.lineWidth = parseFloat((e.target as HTMLSelectElement).value);
            doc.notifyChange();
            onUpdate();
          }
        });
      });

      // Add new layer
      const nameInp = modal.querySelector('#new-layer-name') as HTMLInputElement;
      nameInp?.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          (modal.querySelector('#btn-add-layer') as HTMLButtonElement)?.click();
        }
      });

      modal.querySelector('#btn-add-layer')?.addEventListener('click', () => {
        const colorInp = modal.querySelector('#new-layer-color') as HTMLInputElement;
        const name = nameInp?.value.trim() || `${tr('Warstwa', 'Layer')}_${doc.layers.length + 1}`;
        doc.addLayer(name, colorInp?.value || '#00E5FF');
        renderContent();
        onUpdate();
      });
    };

    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    renderContent();
  }
}

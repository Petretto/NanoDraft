import { CadDocument } from '../model/document';
import { Layer } from '../types/cad';
import { tr } from '../i18n/lang';

export class LayersModal {
  static open(doc: CadDocument, onUpdate: () => void) {
    const overlay = document.createElement('div');
    overlay.className = 'cad-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'cad-modal';

    const renderContent = () => {
      modal.innerHTML = `
        <div class="modal-header">
          <h3>🎨 ${tr('Menedżer Warstw', 'Layer Manager')}</h3>
          <button class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <table class="layers-table">
            <thead>
              <tr>
                <th>${tr('Aktywna', 'Active')}</th>
                <th>${tr('Nazwa', 'Name')}</th>
                <th>${tr('Widoczna', 'Visible')}</th>
                <th>${tr('Kolor', 'Color')}</th>
                <th>${tr('Rodzaj linii', 'Line Type')}</th>
                <th>${tr('Grubość', 'Width')}</th>
              </tr>
            </thead>
            <tbody>
              ${doc.layers.map(l => `
                <tr class="${l.id === doc.activeLayerId ? 'active-row' : ''}" data-id="${l.id}">
                  <td style="text-align:center;">
                    <input type="radio" name="active-layer" value="${l.id}" ${l.id === doc.activeLayerId ? 'checked' : ''} />
                  </td>
                  <td><b>${l.name}</b></td>
                  <td style="text-align:center;">
                    <button class="layer-toggle-btn toggle-vis" data-id="${l.id}">
                      ${l.visible ? '👁️' : '🙈'}
                    </button>
                  </td>
                  <td style="text-align:center;">
                    <input type="color" class="layer-color-input" data-id="${l.id}" value="${l.color}" />
                  </td>
                  <td>
                    <select class="layer-linetype-select" data-id="${l.id}">
                      <option value="continuous" ${l.lineType === 'continuous' ? 'selected' : ''}>${tr('Ciągła ———', 'Continuous ———')}</option>
                      <option value="dashed" ${l.lineType === 'dashed' ? 'selected' : ''}>${tr('Przerywana - - -', 'Dashed - - -')}</option>
                      <option value="dashdot" ${l.lineType === 'dashdot' ? 'selected' : ''}>${tr('Oś — · —', 'Centerline — · —')}</option>
                      <option value="dotted" ${l.lineType === 'dotted' ? 'selected' : ''}>${tr('Kropkowana · · ·', 'Dotted · · ·')}</option>
                    </select>
                  </td>
                  <td>
                    <select class="layer-width-select" data-id="${l.id}">
                      <option value="0.8" ${l.lineWidth === 0.8 ? 'selected' : ''}>0.8 mm</option>
                      <option value="1.0" ${l.lineWidth === 1.0 ? 'selected' : ''}>1.0 mm</option>
                      <option value="1.5" ${l.lineWidth === 1.5 ? 'selected' : ''}>1.5 mm</option>
                      <option value="2.0" ${l.lineWidth === 2.0 ? 'selected' : ''}>2.0 mm</option>
                    </select>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="new-layer-form">
            <h4>➕ ${tr('Dodaj nową warstwę', 'Add New Layer')}</h4>
            <div style="display:flex; gap:8px; margin-top:6px; align-items:center;">
              <input type="text" id="new-layer-name" placeholder="${tr('Nazwa warstwy (np. Meble, Elektryka)', 'Layer name (e.g. Furniture, Electrical)')}" class="hud-input" style="flex:1;" />
              <input type="color" id="new-layer-color" value="#ff00ff" style="width:34px; height:28px; border:none; cursor:pointer;" />
              <button id="btn-add-layer" class="top-btn highlight">+ ${tr('Utwórz', 'Create')}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="modal-btn-close" class="top-btn">${tr('Zamknij', 'Close')}</button>
        </div>
      `;

      // Event listeners
      modal.querySelector('.modal-close-btn')?.addEventListener('click', close);
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

      // Color change
      modal.querySelectorAll('.layer-color-input').forEach(inp => {
        inp.addEventListener('change', (e) => {
          const id = (inp as HTMLElement).dataset.id;
          const l = doc.layers.find(x => x.id === id);
          if (l) {
            l.color = (e.target as HTMLInputElement).value;
            doc.notifyChange();
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
      modal.querySelector('#btn-add-layer')?.addEventListener('click', () => {
        const nameInp = modal.querySelector('#new-layer-name') as HTMLInputElement;
        const colorInp = modal.querySelector('#new-layer-color') as HTMLInputElement;
        const name = nameInp?.value.trim();
        if (name) {
          doc.addLayer(name, colorInp?.value || '#00e5ff');
          renderContent();
          onUpdate();
        }
      });
    };

    const close = () => {
      document.body.removeChild(overlay);
    };

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    renderContent();
  }
}


import { CadDocument } from '../model/document';
import { HistoryManager, Command } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { ImageEntity, Layer, Point2D } from '../types/cad';
import { VectorMath } from '../math/vector';
import { CadRenderer } from '../engine/renderer';
import { tr } from '../i18n/lang';

export class UnderlayManager {
  static ensureUnderlayLayer(doc: CadDocument): Layer {
    let layer = doc.layers.find(l => l.id === 'underlay');
    if (!layer) {
      layer = {
        id: 'underlay',
        name: tr('Podkład rastrowy', 'Raster Underlay'),
        color: '#94a3b8',
        lineWidth: 1.0,
        lineType: 'continuous',
        visible: true,
        locked: false,
      };
      doc.layers.push(layer);
    }
    return layer;
  }

  static getUnderlays(doc: CadDocument): ImageEntity[] {
    return doc.entities.filter(
      (e): e is ImageEntity => e.type === 'image' && (!!e.isUnderlay || e.layerId === 'underlay')
    );
  }

  static openModal(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    requestRender: () => void
  ) {
    const existing = document.getElementById('cad-underlay-modal-overlay');
    if (existing) existing.remove();

    const underlays = this.getUnderlays(doc);
    const underlayLayer = doc.layers.find(l => l.id === 'underlay');
    const isLocked = underlayLayer ? underlayLayer.locked : false;

    const overlay = document.createElement('div');
    overlay.id = 'cad-underlay-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 560px; max-width: 95vw;">
        <div class="modal-header">
          <h3>🖼️ ${tr('Podkład Rastrowy i Kalibracja Skali (2 punkty)', 'Raster Underlay & 2-Point Scale Calibration')}</h3>
          <button class="modal-close-btn" id="ul-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:12px; max-height:75vh; overflow-y:auto;">
          <div style="font-size:12px; color:var(--text-muted); line-height:1.45;">
            ${tr(
              'Wczytaj skan rzutu hali, plan budynku lub zdjęcie detalu (PNG, JPG, WEBP, SVG). Następnie użyj <b>Kalibracji 2 punktami</b>: kliknij 2 punkty o znanej odległości na obrazku i wpisz wymiar rzeczywisty, aby dopasować podkład do skali 1:1.',
              'Load a floor plan scan, building drawing or photo (PNG, JPG, WEBP, SVG). Then use <b>2-Point Calibration</b>: click 2 points of known distance on the image and enter the real-world length to scale it 1:1.'
            )}
          </div>

          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <input type="file" id="ul-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none;" />
            <button type="button" class="top-btn highlight" id="ul-upload-btn">
              📂 ${tr('Wczytaj obraz podkładu...', 'Load Underlay Image...')}
            </button>
            <label style="font-size:12px; color:var(--text-main); display:flex; align-items:center; gap:5px; cursor:pointer; margin-left:auto;">
              <input type="checkbox" id="ul-lock-layer" ${isLocked ? 'checked' : ''} />
              🔒 ${tr('Zablokuj podkład podczas rysowania', 'Lock underlay while drawing')}
            </label>
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            ${
              underlays.length === 0
                ? `<div style="padding:16px; text-align:center; color:var(--text-muted); border:1px dashed var(--border-color); border-radius:6px;">
                    ${tr('Brak wczytanych podkładów rastrowych w tym rysunku.', 'No raster underlays loaded in this drawing.')}
                  </div>`
                : underlays
                    .map(
                      (u, idx) => `
                  <div style="border:1px solid var(--border-color); border-radius:6px; padding:10px; background:var(--bg-primary); display:flex; flex-direction:column; gap:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                      <div style="display:flex; align-items:center; gap:10px;">
                        <img src="${u.dataUrl}" style="width:52px; height:40px; object-fit:contain; background:#fff; border-radius:4px; border:1px solid var(--border-color);" />
                        <div>
                          <div style="font-weight:600; font-size:13px; color:var(--text-main);">${tr('Podkład rastrowy', 'Raster Underlay')} #${idx + 1}</div>
                          <div style="font-size:11px; color:var(--text-muted);">
                            ${tr('Rozmiar:', 'Size:')} <b>${VectorMath.round(u.width, 2)} × ${VectorMath.round(u.height, 2)} ${doc.unit}</b>
                          </div>
                        </div>
                      </div>
                      <div style="display:flex; gap:6px;">
                        <button type="button" class="top-btn highlight ul-cal-btn" data-id="${u.id}">
                          📏 ${tr('Kalibruj skalę (2 pkt)', 'Calibrate Scale (2 pts)')}
                        </button>
                        <button type="button" class="top-btn ul-del-btn" data-id="${u.id}" title="${tr('Usuń podkład', 'Delete underlay')}">🗑️</button>
                      </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; font-size:11px; color:var(--text-muted);">
                      <span>${tr('Przezroczystość:', 'Opacity:')}</span>
                      <input type="range" class="ul-opacity-slider" data-id="${u.id}" min="10" max="100" value="${Math.round((u.opacity ?? 0.55) * 100)}" style="flex:1;" />
                      <span class="ul-opacity-val" style="min-width:34px; text-align:right; color:var(--text-main);">${Math.round((u.opacity ?? 0.55) * 100)}%</span>
                    </div>
                  </div>
                `
                    )
                    .join('')
            }
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="top-btn" id="ul-cancel-btn">${tr('Zamknij', 'Close')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#ul-close')?.addEventListener('click', close);
    overlay.querySelector('#ul-cancel-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    const lockChk = overlay.querySelector('#ul-lock-layer') as HTMLInputElement;
    lockChk?.addEventListener('change', () => {
      const layer = this.ensureUnderlayLayer(doc);
      layer.locked = lockChk.checked;
      doc.notifyChange();
      requestRender();
    });

    const fileInput = overlay.querySelector('#ul-file-input') as HTMLInputElement;
    overlay.querySelector('#ul-upload-btn')?.addEventListener('click', () => fileInput.click());
    fileInput?.addEventListener('change', e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
          const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
          // Fit initial underlay comfortably to ~65% of current viewport width
          const targetW = Math.max(transform.screenDistToWorld(transform.screenWidth * 0.65), 10);
          const targetH = targetW / aspect;
          const centerWorld = transform.screenToWorld({
            x: transform.screenWidth / 2,
            y: transform.screenHeight / 2,
          });

          const layer = this.ensureUnderlayLayer(doc);
          const newImg: ImageEntity = {
            id: `underlay_${Date.now()}`,
            type: 'image',
            layerId: layer.id,
            x: VectorMath.round(centerWorld.x - targetW / 2, 3),
            y: VectorMath.round(centerWorld.y - targetH / 2, 3),
            width: VectorMath.round(targetW, 3),
            height: VectorMath.round(targetH, 3),
            dataUrl,
            opacity: 0.55,
            isUnderlay: true,
            selected: false,
          };

          CadRenderer.getCachedImage(dataUrl);
          const cmd: Command = {
            description: tr('Dodaj podkład rastrowy', 'Add raster underlay'),
            execute: () => doc.addEntity(newImg),
            undo: () => doc.removeEntity(newImg.id),
          };
          history.execute(cmd);
          requestRender();
          close();
          this.openModal(doc, history, transform, requestRender);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });

    overlay.querySelectorAll('.ul-opacity-slider').forEach(slider => {
      slider.addEventListener('input', e => {
        const inp = e.target as HTMLInputElement;
        const id = inp.getAttribute('data-id');
        const valPct = parseInt(inp.value, 10) || 55;
        const ent = doc.getEntity(id || '');
        if (ent && ent.type === 'image') {
          ent.opacity = valPct / 100;
          const valSpan = inp.parentElement?.querySelector('.ul-opacity-val');
          if (valSpan) valSpan.textContent = `${valPct}%`;
          doc.notifyChange();
          requestRender();
        }
      });
    });

    overlay.querySelectorAll('.ul-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).getAttribute('data-id');
        const ent = doc.getEntity(id || '');
        if (!ent) return;
        const cmd: Command = {
          description: tr('Usuń podkład rastrowy', 'Delete raster underlay'),
          execute: () => doc.removeEntity(ent.id),
          undo: () => doc.addEntity(ent),
        };
        history.execute(cmd);
        requestRender();
        close();
        this.openModal(doc, history, transform, requestRender);
      });
    });

    overlay.querySelectorAll('.ul-cal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).getAttribute('data-id');
        const ent = doc.getEntity(id || '');
        if (!ent || ent.type !== 'image') return;
        close();
        this.startTwoPointCalibration(ent, doc, history, transform, requestRender);
      });
    });
  }

  /**
   * Interactive 2-Point Scale Calibration directly on the CAD viewport.
   */
  static startTwoPointCalibration(
    imgEnt: ImageEntity,
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    requestRender: () => void
  ) {
    const viewport = document.querySelector('.cad-viewport-container') as HTMLElement;
    if (!viewport) return;

    const calCanvas = document.createElement('canvas');
    calCanvas.width = viewport.clientWidth;
    calCanvas.height = viewport.clientHeight;
    calCanvas.style.cssText = 'position:absolute; inset:0; z-index:40; cursor:crosshair;';
    viewport.appendChild(calCanvas);

    const banner = document.createElement('div');
    banner.className = 'cad-dim-mode-bar';
    banner.style.zIndex = '45';
    banner.innerHTML = `
      <span class="dim-bar-title" style="color:var(--accent-yellow);">
        📏 ${tr('KALIBRACJA PODKŁADU: Kliknij 1. punkt referencyjny, a następnie 2. punkt o znanej odległości rzeczywistej', 'UNDERLAY CALIBRATION: Click 1st reference point, then 2nd point of known real distance')}
      </span>
      <button type="button" class="top-btn" id="cal-cancel-btn">${tr('Anuluj (Esc)', 'Cancel (Esc)')}</button>
    `;
    viewport.appendChild(banner);

    const ctx = calCanvas.getContext('2d')!;
    let p1World: Point2D | null = null;
    let curScreen: Point2D | null = null;

    const drawOverlay = () => {
      ctx.clearRect(0, 0, calCanvas.width, calCanvas.height);
      if (!curScreen) return;

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 235, 59, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, curScreen.y);
      ctx.lineTo(calCanvas.width, curScreen.y);
      ctx.moveTo(curScreen.x, 0);
      ctx.lineTo(curScreen.x, calCanvas.height);
      ctx.stroke();

      if (p1World) {
        const s1 = transform.worldToScreen(p1World);
        ctx.setLineDash([]);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(curScreen.x, curScreen.y);
        ctx.stroke();

        // Point markers
        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.arc(s1.x, s1.y, 5, 0, Math.PI * 2);
        ctx.arc(curScreen.x, curScreen.y, 5, 0, Math.PI * 2);
        ctx.fill();

        const wCur = transform.screenToWorld(curScreen);
        const curDist = VectorMath.round(VectorMath.distance(p1World, wCur), 2);
        const midX = (s1.x + curScreen.x) / 2;
        const midY = (s1.y + curScreen.y) / 2;
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`${curDist} ${doc.unit}`, midX + 8, midY - 8);
      }
      ctx.restore();
    };

    const cleanup = () => {
      window.removeEventListener('keydown', onKeyDown, true);
      calCanvas.remove();
      banner.remove();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    banner.querySelector('#cal-cancel-btn')?.addEventListener('click', () => cleanup());

    calCanvas.addEventListener('mousemove', e => {
      const rect = calCanvas.getBoundingClientRect();
      curScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      drawOverlay();
    });

    calCanvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const rect = calCanvas.getBoundingClientRect();
      const sPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const wPt = transform.screenToWorld(sPt);

      if (!p1World) {
        p1World = wPt;
        curScreen = sPt;
        drawOverlay();
      } else {
        const measuredDist = VectorMath.distance(p1World, wPt);
        const anchorPt = { ...p1World };
        cleanup();

        if (measuredDist < 1e-4) return;
        this.promptRealDistanceAndApply(imgEnt, anchorPt, measuredDist, doc, history, transform, requestRender);
      }
    });
  }

  private static promptRealDistanceAndApply(
    imgEnt: ImageEntity,
    anchorPt: Point2D,
    measuredDist: number,
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    requestRender: () => void
  ) {
    const defaultReal = doc.unit === 'm' ? 6.0 : doc.unit === 'cm' ? 600 : 1000;
    const raw = prompt(
      tr(
        `Zmierzony odcinek na podkładzie: ${VectorMath.round(measuredDist, 2)} ${doc.unit}.\nPodaj RZECZYWISTĄ odległość pomiędzy wskazanymi 2 punktami [${doc.unit}]:`,
        `Measured distance on underlay: ${VectorMath.round(measuredDist, 2)} ${doc.unit}.\nEnter the REAL-WORLD distance between the 2 picked points [${doc.unit}]:`
      ),
      String(defaultReal)
    );
    if (!raw) return;

    const realDist = parseFloat(raw.replace(',', '.'));
    if (isNaN(realDist) || realDist <= 0) return;

    const factor = realDist / measuredDist;
    const oldState = { x: imgEnt.x, y: imgEnt.y, width: imgEnt.width, height: imgEnt.height };
    const newState = {
      x: VectorMath.round(anchorPt.x + (imgEnt.x - anchorPt.x) * factor, 3),
      y: VectorMath.round(anchorPt.y + (imgEnt.y - anchorPt.y) * factor, 3),
      width: VectorMath.round(imgEnt.width * factor, 3),
      height: VectorMath.round(imgEnt.height * factor, 3),
    };

    const cmd: Command = {
      description: tr(
        `Kalibruj skalę podkładu (×${VectorMath.round(factor, 3)})`,
        `Calibrate underlay scale (×${VectorMath.round(factor, 3)})`
      ),
      execute: () => {
        imgEnt.x = newState.x;
        imgEnt.y = newState.y;
        imgEnt.width = newState.width;
        imgEnt.height = newState.height;
        doc.notifyChange();
      },
      undo: () => {
        imgEnt.x = oldState.x;
        imgEnt.y = oldState.y;
        imgEnt.width = oldState.width;
        imgEnt.height = oldState.height;
        doc.notifyChange();
      },
    };
    history.execute(cmd);

    transform.zoomToFit({
      minX: imgEnt.x,
      maxX: imgEnt.x + imgEnt.width,
      minY: imgEnt.y,
      maxY: imgEnt.y + imgEnt.height,
    });
    requestRender();
  }
}

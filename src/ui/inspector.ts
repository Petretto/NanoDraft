import { CadDocument } from '../model/document';
import { HistoryManager, Command } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { LineEntity, CircleEntity, TextEntity, PolylineEntity, DimensionEntity, PointEntity, ImageEntity, CadEntity } from '../types/cad';
import { UnderlayManager } from './underlay-modal';
import { i18n, tr } from '../i18n/lang';

export class PropertyInspector {
  private element: HTMLDivElement;

  constructor(
    private doc: CadDocument,
    private history: HistoryManager,
    parent: HTMLElement,
    private requestRender: () => void,
    private transform?: ViewportTransform
  ) {
    this.element = document.createElement('div');
    this.element.className = 'cad-inspector';
    parent.appendChild(this.element);

    this.render();
    this.doc.addChangeListener(() => this.render());
    this.history.addChangeListener(() => this.render());
    i18n.onChange(() => this.render());
  }

  private render() {
    // Preserve focus if user is actively typing in an input
    if (this.element.contains(document.activeElement)) {
      return;
    }

    this.element.innerHTML = '';

    // History controls (Undo / Redo)
    const historyHeader = document.createElement('div');
    historyHeader.className = 'inspector-section-header';
    historyHeader.innerHTML = `
      <span>${tr('Historia', 'History')}</span>
      <div class="history-btns">
        <button id="btn-undo" class="mini-btn" ${!this.history.canUndo() ? 'disabled' : ''} title="${tr('Cofnij (Ctrl+Z)', 'Undo (Ctrl+Z)')}">↶</button>
        <button id="btn-redo" class="mini-btn" ${!this.history.canRedo() ? 'disabled' : ''} title="${tr('Ponów (Ctrl+Y)', 'Redo (Ctrl+Y)')}">↷</button>
      </div>
    `;
    this.element.appendChild(historyHeader);

    historyHeader.querySelector('#btn-undo')?.addEventListener('click', () => {
      this.history.undo();
      this.requestRender();
    });
    historyHeader.querySelector('#btn-redo')?.addEventListener('click', () => {
      this.history.redo();
      this.requestRender();
    });

    const selected = this.doc.getSelectedEntities();

    if (selected.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'inspector-empty';
      emptyState.innerHTML = `
        <p>${tr('Brak zaznaczenia', 'No Selection')}</p>
        <small>${tr(
          'Kliknij obiekt na płótnie lub zaznacz ramką, aby wyświetlić i edytować wymiary oraz kąt.',
          'Click an object on canvas or drag a selection box to inspect and edit dimensions and angle.'
        )}</small>
        <hr/>
        <div class="doc-stats">
          <div>${tr('Obiektów w dokumencie:', 'Entities in document:')} <b>${this.doc.entities.length}</b></div>
          <div>${tr('Jednostka:', 'Unit:')} <b>${this.doc.unit.toUpperCase()}</b></div>
        </div>
      `;
      this.element.appendChild(emptyState);
      return;
    }

    if (selected.length === 1) {
      const ent = selected[0];
      const details = document.createElement('div');
      details.className = 'inspector-details';

      const header = document.createElement('div');
      header.className = 'inspector-section-header';
      header.textContent = `${tr('Właściwości', 'Properties')}: ${ent.type.toUpperCase()}`;
      details.appendChild(header);

      this.renderGeneralProperties(ent, details);

      if (ent.type === 'line') {
        this.renderLineInspector(ent as LineEntity, details);
      } else if (ent.type === 'circle') {
        this.renderCircleInspector(ent as CircleEntity, details);
      } else if (ent.type === 'polyline') {
        this.renderPolylineInspector(ent as PolylineEntity, details);
      } else if (ent.type === 'text') {
        this.renderTextInspector(ent as TextEntity, details);
      } else if (ent.type === 'point') {
        this.renderPointInspector(ent as PointEntity, details);
      } else if (ent.type === 'dimension') {
        this.renderDimensionInspector(ent as DimensionEntity, details);
      } else if (ent.type === 'image') {
        this.renderImageInspector(ent as ImageEntity, details);
      }

      // Delete action button
      const actions = document.createElement('div');
      actions.className = 'inspector-actions';
      actions.innerHTML = `<button id="btn-del-single" class="danger-btn">${tr('Usuń obiekt (Del)', 'Delete Object (Del)')}</button>`;
      details.appendChild(actions);

      actions.querySelector('#btn-del-single')?.addEventListener('click', () => {
        this.doc.deleteSelected();
        this.requestRender();
      });

      this.element.appendChild(details);
    } else {
      // Multiple selection / Group selection
      const multi = document.createElement('div');
      multi.className = 'inspector-details';

      const groupIds = new Set(selected.map(e => e.groupId).filter(Boolean));
      const isSingleGroup = groupIds.size === 1 && selected.every(e => !!e.groupId);
      const hasAnyGroup = groupIds.size > 0;
      const currentGroupName = isSingleGroup ? selected[0].groupName || tr('Grupa obiektów', 'Object Group') : '';

      const bounds = Geometry.unionBounds(selected);
      const boundsW = bounds ? VectorMath.round(bounds.maxX - bounds.minX) : 0;
      const boundsH = bounds ? VectorMath.round(bounds.maxY - bounds.minY) : 0;

      multi.innerHTML = `
        <div class="inspector-section-header">
          ${isSingleGroup ? `📦 ${tr('Grupa obiektów', 'Object Group')}` : tr('Zaznaczono wiele obiektów', 'Multiple Selection')}
        </div>
        <div class="prop-row"><span>${tr('Liczba elementów:', 'Element count:')}</span> <b>${selected.length}</b></div>
        ${
          bounds
            ? `<div class="prop-row"><span>${tr('Gabaryt (W × H):', 'Bounds (W × H):')}</span> <b>${boundsW} × ${boundsH} ${this.doc.unit}</b></div>`
            : ''
        }
        ${
          isSingleGroup
            ? `
          <div class="prop-row">
            <span>${tr('Nazwa grupy:', 'Group name:')}</span>
            <input id="inp-group-name" type="text" class="prop-input" style="width:120px; text-align:left;" value="${currentGroupName.replace(/"/g, '&quot;')}" />
          </div>
        `
            : ''
        }
        <div class="inspector-actions" style="margin-top:8px;">
          ${
            !isSingleGroup
              ? `<button id="btn-group-sel" class="top-btn highlight" style="width:100%; justify-content:center;">🔗 ${tr('Połącz w grupę (Ctrl+G)', 'Group Selected (Ctrl+G)')}</button>`
              : ''
          }
          ${
            hasAnyGroup
              ? `<button id="btn-ungroup-sel" class="top-btn" style="width:100%; justify-content:center;">🔓 ${tr('Rozgrupuj elementy (Ctrl+U)', 'Ungroup Elements (Ctrl+U)')}</button>`
              : ''
          }
          <button id="btn-del-multi" class="danger-btn">${tr('Usuń zaznaczone', 'Delete Selected')} (${selected.length})</button>
        </div>
      `;
      this.element.appendChild(multi);

      const grpInput = multi.querySelector('#inp-group-name') as HTMLInputElement | null;
      grpInput?.addEventListener('change', () => {
        const newName = grpInput.value.trim();
        for (const e of selected) e.groupName = newName;
        this.doc.notifyChange();
      });

      multi.querySelector('#btn-group-sel')?.addEventListener('click', () => {
        this.doc.groupSelected(this.history);
        this.requestRender();
      });

      multi.querySelector('#btn-ungroup-sel')?.addEventListener('click', () => {
        this.doc.ungroupSelected(this.history);
        this.requestRender();
      });

      multi.querySelector('#btn-del-multi')?.addEventListener('click', () => {
        this.doc.deleteSelected();
        this.requestRender();
      });
    }
  }

  // --- LINE INSPECTOR ---
  private renderGeneralProperties(ent: CadEntity, container: HTMLElement) {
    const layer = this.doc.layers.find(l => l.id === ent.layerId) || this.doc.layers[0];

    // 1. Warstwa
    const rowLayer = document.createElement('div');
    rowLayer.className = 'prop-row';
    rowLayer.innerHTML = `<span>${tr('Warstwa:', 'Layer:')}</span>`;
    const selectLayer = document.createElement('select');
    selectLayer.className = 'prop-input prop-input-full';
    this.doc.layers.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      if (l.id === ent.layerId) opt.selected = true;
      selectLayer.appendChild(opt);
    });
    selectLayer.addEventListener('change', () => {
      const oldLayer = ent.layerId;
      const newLayer = selectLayer.value;
      this.executeChange('Zmień warstwę obiektu', () => { ent.layerId = newLayer; }, () => { ent.layerId = oldLayer; });
    });
    rowLayer.appendChild(selectLayer);
    container.appendChild(rowLayer);

    // 2. Rodzaj linii
    const rowType = document.createElement('div');
    rowType.className = 'prop-row';
    rowType.innerHTML = `<span>${tr('Rodzaj linii:', 'Line Type:')}</span>`;
    const selectType = document.createElement('select');
    selectType.className = 'prop-input prop-input-full';
    const typeOpts = [
      { val: '', label: `${tr('Jak warstwa', 'ByLayer')} (${layer.lineType})` },
      { val: 'continuous', label: tr('Ciągła ———', 'Continuous ———') },
      { val: 'dashed', label: tr('Przerywana - - -', 'Dashed - - -') },
      { val: 'dashdot', label: tr('Oś (Kreska-kropka) — · —', 'Centerline — · —') },
      { val: 'dotted', label: tr('Kropkowana · · ·', 'Dotted · · ·') },
    ];
    typeOpts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.val;
      opt.textContent = o.label;
      if ((ent.lineType || '') === o.val) opt.selected = true;
      selectType.appendChild(opt);
    });
    selectType.addEventListener('change', () => {
      const oldType = ent.lineType;
      const newType = (selectType.value || undefined) as any;
      this.executeChange('Zmień rodzaj linii', () => { ent.lineType = newType; }, () => { ent.lineType = oldType; });
    });
    rowType.appendChild(selectType);
    container.appendChild(rowType);

    // 3. Kolor linii
    const rowColor = document.createElement('div');
    rowColor.className = 'prop-row';
    rowColor.innerHTML = `<span>${tr('Kolor:', 'Color:')}</span>`;
    const colorWrap = document.createElement('div');
    colorWrap.style.display = 'flex';
    colorWrap.style.alignItems = 'center';
    colorWrap.style.gap = '5px';

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.value = ent.color || layer.color;
    colorPicker.style.width = '28px';
    colorPicker.style.height = '22px';
    colorPicker.style.cursor = 'pointer';
    colorPicker.style.border = 'none';
    colorPicker.style.background = 'transparent';

    colorPicker.addEventListener('change', () => {
      const oldColor = ent.color;
      const newColor = colorPicker.value;
      this.executeChange('Zmień kolor linii', () => { ent.color = newColor; }, () => { ent.color = oldColor; });
    });
    colorWrap.appendChild(colorPicker);

    if (ent.color) {
      const resetColorBtn = document.createElement('button');
      resetColorBtn.className = 'angle-btn';
      resetColorBtn.textContent = 'Auto';
      resetColorBtn.title = 'Ustaw kolor z warstwy (ByLayer)';
      resetColorBtn.addEventListener('click', () => {
        const oldColor = ent.color;
        this.executeChange('Przywróć kolor warstwy', () => { delete ent.color; }, () => { ent.color = oldColor; });
      });
      colorWrap.appendChild(resetColorBtn);
    }

    rowColor.appendChild(colorWrap);
    container.appendChild(rowColor);

    const divider = document.createElement('hr');
    divider.style.borderColor = 'var(--border-color)';
    divider.style.margin = '4px 0 8px 0';
    container.appendChild(divider);
  }

  // --- LINE INSPECTOR ---
  private renderLineInspector(line: LineEntity, container: HTMLElement) {
    const p1 = { x: line.x1, y: line.y1 };
    const p2 = { x: line.x2, y: line.y2 };
    const len = VectorMath.distance(p1, p2);
    const angle = VectorMath.angleDeg(p1, p2);

    // 1. Długość
    const rowLen = this.createInputRow(`${tr('Długość', 'Length')} [${this.doc.unit}]:`, len, (newLen) => {
      if (newLen <= 0) return;
      const oldState = { ...line };
      const newP2 = VectorMath.pointFromPolar(p1, newLen, angle);
      this.executeChange(`Zmień długość linii na ${newLen}`, () => {
        line.x2 = newP2.x;
        line.y2 = newP2.y;
      }, () => {
        line.x2 = oldState.x2;
        line.y2 = oldState.y2;
      });
    });
    container.appendChild(rowLen);

    // 2. Kąt
    const rowAngle = this.createInputRow(`${tr('Kąt', 'Angle')} [°]:`, Math.round(angle * 10) / 10, (newAngle) => {
      const oldState = { ...line };
      const newP2 = VectorMath.pointFromPolar(p1, len, newAngle);
      this.executeChange(`Zmień kąt linii na ${newAngle}°`, () => {
        line.x2 = newP2.x;
        line.y2 = newP2.y;
      }, () => {
        line.x2 = oldState.x2;
        line.y2 = oldState.y2;
      });
    });
    container.appendChild(rowAngle);

    // 3. Przyciski szybkiego kąta (Presets)
    const presetDiv = document.createElement('div');
    presetDiv.className = 'angle-presets';
    const presets = [
      { label: '0°', val: 0 },
      { label: '90°', val: 90 },
      { label: '180°', val: 180 },
      { label: '270°', val: 270 },
      { label: '+90°', delta: 90 },
      { label: '-90°', delta: -90 },
    ];

    presets.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'angle-btn';
      btn.textContent = p.label;
      btn.addEventListener('click', () => {
        const targetAngle = p.delta !== undefined ? (angle + p.delta) % 360 : p.val;
        const oldState = { ...line };
        const newP2 = VectorMath.pointFromPolar(p1, len, targetAngle);
        this.executeChange(`Ustaw kąt ${targetAngle}°`, () => {
          line.x2 = newP2.x;
          line.y2 = newP2.y;
        }, () => {
          line.x2 = oldState.x2;
          line.y2 = oldState.y2;
        });
      });
      presetDiv.appendChild(btn);
    });
    container.appendChild(presetDiv);

    // 4. Coordinates X1, Y1, X2, Y2
    container.appendChild(this.createInputRow(`X1 (${tr('Początek', 'Start')}):`, line.x1, (v) => {
      const old = line.x1;
      this.executeChange('Zmień X1', () => { line.x1 = v; }, () => { line.x1 = old; });
    }));
    container.appendChild(this.createInputRow(`Y1 (${tr('Początek', 'Start')}):`, line.y1, (v) => {
      const old = line.y1;
      this.executeChange('Zmień Y1', () => { line.y1 = v; }, () => { line.y1 = old; });
    }));
    container.appendChild(this.createInputRow(`X2 (${tr('Koniec', 'End')}):`, line.x2, (v) => {
      const old = line.x2;
      this.executeChange('Zmień X2', () => { line.x2 = v; }, () => { line.x2 = old; });
    }));
    container.appendChild(this.createInputRow(`Y2 (${tr('Koniec', 'End')}):`, line.y2, (v) => {
      const old = line.y2;
      this.executeChange('Zmień Y2', () => { line.y2 = v; }, () => { line.y2 = old; });
    }));
  }

  // --- CIRCLE INSPECTOR ---
  private renderCircleInspector(circle: CircleEntity, container: HTMLElement) {
    // 1. Promień R
    const rowR = this.createInputRow(`${tr('Promień (R)', 'Radius (R)')} [${this.doc.unit}]:`, circle.radius, (newR) => {
      if (newR <= 0) return;
      const old = circle.radius;
      this.executeChange(`Zmień promień na ${newR}`, () => { circle.radius = newR; }, () => { circle.radius = old; });
    });
    container.appendChild(rowR);

    // 2. Średnica Ø
    const rowD = this.createInputRow(`${tr('Średnica (Ø)', 'Diameter (Ø)')} [${this.doc.unit}]:`, circle.radius * 2, (newDia) => {
      if (newDia <= 0) return;
      const old = circle.radius;
      const newR = newDia / 2;
      this.executeChange(`Zmień średnicę na ${newDia}`, () => { circle.radius = newR; }, () => { circle.radius = old; });
    });
    container.appendChild(rowD);

    // 3. Środek X, Y
    container.appendChild(this.createInputRow(`${tr('Środek X:', 'Center X:')}`, circle.cx, (v) => {
      const old = circle.cx;
      this.executeChange('Zmień środek X', () => { circle.cx = v; }, () => { circle.cx = old; });
    }));
    container.appendChild(this.createInputRow(`${tr('Środek Y:', 'Center Y:')}`, circle.cy, (v) => {
      const old = circle.cy;
      this.executeChange('Zmień środek Y', () => { circle.cy = v; }, () => { circle.cy = old; });
    }));

    // Stats
    const stats = document.createElement('div');
    stats.innerHTML = `
      <div class="prop-row"><span>${tr('Obwód:', 'Circumference:')}</span> <b>${VectorMath.round(Math.PI * 2 * circle.radius)} ${this.doc.unit}</b></div>
      <div class="prop-row"><span>${tr('Pole powierzchni:', 'Area:')}</span> <b>${VectorMath.round(Math.PI * circle.radius * circle.radius)} ${this.doc.unit}²</b></div>
    `;
    container.appendChild(stats);
  }

  // --- TEXT INSPECTOR ---
  private renderTextInspector(text: TextEntity, container: HTMLElement) {
    // 1. Treść tekstu
    const rowText = document.createElement('div');
    rowText.className = 'prop-row';
    rowText.innerHTML = `<span>${tr('Treść:', 'Text:')}</span>`;
    const inputContent = document.createElement('input');
    inputContent.type = 'text';
    inputContent.className = 'prop-input prop-input-full';
    inputContent.value = text.text;
    inputContent.addEventListener('change', () => {
      const old = text.text;
      const val = inputContent.value;
      this.executeChange('Zmień treść tekstu', () => { text.text = val; }, () => { text.text = old; });
    });
    rowText.appendChild(inputContent);
    container.appendChild(rowText);

    // 2. Rozmiar czcionki (niezależny od szerokości/wysokości ramki!)
    container.appendChild(this.createInputRow(`${tr('Rozmiar czcionki', 'Font Size')} [${this.doc.unit}]:`, text.height, (h) => {
      if (h <= 0) return;
      const old = text.height;
      this.executeChange('Zmień rozmiar czcionki', () => { text.height = h; }, () => { text.height = old; });
    }));

    // 3. Szerokość i wysokość ramki tekstowej (W × H)
    const { w: curBoxW, h: curBoxH } = Geometry.getTextFrameSize(text);
    container.appendChild(this.createInputRow(`${tr('Szer. ramki (W)', 'Frame Width (W)')} [${this.doc.unit}]:`, curBoxW, (newW) => {
      if (newW <= 0) return;
      const oldW = text.boxWidth;
      const oldH = text.boxHeight;
      this.executeChange('Zmień szerokość ramki tekstu', () => {
        text.boxWidth = newW;
        if (text.boxHeight === undefined) text.boxHeight = curBoxH;
      }, () => {
        text.boxWidth = oldW;
        text.boxHeight = oldH;
      });
    }));

    container.appendChild(this.createInputRow(`${tr('Wys. ramki (H)', 'Frame Height (H)')} [${this.doc.unit}]:`, curBoxH, (newH) => {
      if (newH <= 0) return;
      const oldW = text.boxWidth;
      const oldH = text.boxHeight;
      this.executeChange('Zmień wysokość ramki tekstu', () => {
        if (text.boxWidth === undefined) text.boxWidth = curBoxW;
        text.boxHeight = newH;
      }, () => {
        text.boxWidth = oldW;
        text.boxHeight = oldH;
      });
    }));

    // 4. Wyrównanie poziome (Do lewej / Wyśrodkuj / Do prawej)
    const alignLabel = document.createElement('div');
    alignLabel.style.cssText = 'font-size:11px; color:var(--text-muted); margin-top:6px;';
    alignLabel.textContent = tr('Wyrównanie poziome (w ramce):', 'Horizontal Alignment (in frame):');
    container.appendChild(alignLabel);

    const hAlignDiv = document.createElement('div');
    hAlignDiv.className = 'angle-presets';
    const hAligns: { id: 'left' | 'center' | 'right'; label: string }[] = [
      { id: 'left', label: `⬅ ${tr('Lewo', 'Left')}` },
      { id: 'center', label: `↔ ${tr('Środek', 'Center')}` },
      { id: 'right', label: `➡ ${tr('Prawo', 'Right')}` },
    ];
    hAligns.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'angle-btn';
      if ((text.align || 'left') === item.id) {
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--accent)';
      }
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        const old = text.align;
        const oldW = text.boxWidth;
        const oldH = text.boxHeight;
        this.executeChange(`Wyrównanie poziome: ${item.id}`, () => {
          if (text.boxWidth === undefined) text.boxWidth = curBoxW;
          if (text.boxHeight === undefined) text.boxHeight = curBoxH;
          text.align = item.id;
        }, () => {
          text.align = old;
          text.boxWidth = oldW;
          text.boxHeight = oldH;
        });
      });
      hAlignDiv.appendChild(btn);
    });
    container.appendChild(hAlignDiv);

    // 5. Wyrównanie pionowe (Góra / Środek / Dół)
    const vAlignLabel = document.createElement('div');
    vAlignLabel.style.cssText = 'font-size:11px; color:var(--text-muted); margin-top:4px;';
    vAlignLabel.textContent = tr('Wyrównanie pionowe (w ramce):', 'Vertical Alignment (in frame):');
    container.appendChild(vAlignLabel);

    const vAlignDiv = document.createElement('div');
    vAlignDiv.className = 'angle-presets';
    const vAligns: { id: 'top' | 'middle' | 'bottom'; label: string }[] = [
      { id: 'top', label: `⬆ ${tr('Góra', 'Top')}` },
      { id: 'middle', label: `↕ ${tr('Środek', 'Middle')}` },
      { id: 'bottom', label: `⬇ ${tr('Dół', 'Bottom')}` },
    ];
    vAligns.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'angle-btn';
      if ((text.baseline || 'bottom') === item.id) {
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--accent)';
      }
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        const old = text.baseline;
        const oldW = text.boxWidth;
        const oldH = text.boxHeight;
        this.executeChange(`Wyrównanie pionowe: ${item.id}`, () => {
          if (text.boxWidth === undefined) text.boxWidth = curBoxW;
          if (text.boxHeight === undefined) text.boxHeight = curBoxH;
          text.baseline = item.id;
        }, () => {
          text.baseline = old;
          text.boxWidth = oldW;
          text.boxHeight = oldH;
        });
      });
      vAlignDiv.appendChild(btn);
    });
    container.appendChild(vAlignDiv);

    // Szybki przycisk: Wyśrodkuj w obu osiach
    const centerBothBtn = document.createElement('button');
    centerBothBtn.className = 'angle-btn';
    centerBothBtn.style.cssText = 'width:100%; margin-top:2px; font-weight:600;';
    centerBothBtn.textContent = `🎯 ${tr('Wyśrodkuj w ramce (Poziomo + Pionowo)', 'Center in Frame (Horiz + Vert)')}`;
    centerBothBtn.addEventListener('click', () => {
      const oldA = text.align;
      const oldB = text.baseline;
      const oldW = text.boxWidth;
      const oldH = text.boxHeight;
      this.executeChange('Wyśrodkuj tekst w ramce', () => {
        if (text.boxWidth === undefined) text.boxWidth = curBoxW;
        if (text.boxHeight === undefined) text.boxHeight = curBoxH;
        text.align = 'center';
        text.baseline = 'middle';
      }, () => {
        text.align = oldA;
        text.baseline = oldB;
        text.boxWidth = oldW;
        text.boxHeight = oldH;
      });
    });
    container.appendChild(centerBothBtn);

    // 6. Kąt obrotu
    container.appendChild(this.createInputRow(`${tr('Kąt obrotu', 'Rotation')} [°]:`, text.rotation, (rot) => {
      const old = text.rotation;
      this.executeChange('Zmień kąt tekstu', () => { text.rotation = rot; }, () => { text.rotation = old; });
    }));

    // 7. Presety kątów
    const presetDiv = document.createElement('div');
    presetDiv.className = 'angle-presets';
    [0, 90, 180, 270].forEach(deg => {
      const btn = document.createElement('button');
      btn.className = 'angle-btn';
      btn.textContent = `${deg}°`;
      btn.addEventListener('click', () => {
        const old = text.rotation;
        this.executeChange(`Ustaw kąt tekstu ${deg}°`, () => { text.rotation = deg; }, () => { text.rotation = old; });
      });
      presetDiv.appendChild(btn);
    });
    container.appendChild(presetDiv);

    // 8. Pozycja narożnika X, Y
    container.appendChild(this.createInputRow(`${tr('Narożnik X:', 'Corner X:')}`, text.x, (v) => {
      const old = text.x;
      this.executeChange('Zmień pozycję X tekstu', () => { text.x = v; }, () => { text.x = old; });
    }));
    container.appendChild(this.createInputRow(`${tr('Narożnik Y:', 'Corner Y:')}`, text.y, (v) => {
      const old = text.y;
      this.executeChange('Zmień pozycję Y tekstu', () => { text.y = v; }, () => { text.y = old; });
    }));
  }

  // --- POLYLINE / RECTANGLE INSPECTOR ---
  private renderPolylineInspector(poly: PolylineEntity, container: HTMLElement) {
    const isRect = poly.closed && poly.points.length === 4;

    if (isRect) {
      // Calculate width, height and center
      const xs = poly.points.map(p => p.x);
      const ys = poly.points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX;
      const h = maxY - minY;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Szerokość
      container.appendChild(this.createInputRow(`${tr('Szerokość (W):', 'Width (W):')}`, w, (newW) => {
        if (newW <= 0) return;
        const oldPts = poly.points.map(p => ({ ...p }));
        const halfW = newW / 2;
        const halfH = h / 2;
        this.executeChange('Zmień szerokość prostokąta', () => {
          poly.points = [
            { x: cx - halfW, y: cy - halfH },
            { x: cx + halfW, y: cy - halfH },
            { x: cx + halfW, y: cy + halfH },
            { x: cx - halfW, y: cy + halfH },
          ];
        }, () => { poly.points = oldPts; });
      }));

      // Wysokość
      container.appendChild(this.createInputRow(`${tr('Wysokość (H):', 'Height (H):')}`, h, (newH) => {
        if (newH <= 0) return;
        const oldPts = poly.points.map(p => ({ ...p }));
        const halfW = w / 2;
        const halfH = newH / 2;
        this.executeChange('Zmień wysokość prostokąta', () => {
          poly.points = [
            { x: cx - halfW, y: cy - halfH },
            { x: cx + halfW, y: cy - halfH },
            { x: cx + halfW, y: cy + halfH },
            { x: cx - halfW, y: cy + halfH },
          ];
        }, () => { poly.points = oldPts; });
      }));

      // Obrót prostokąta wokół środka
      const presetDiv = document.createElement('div');
      presetDiv.className = 'angle-presets';
      const rotateRect = (deltaDeg: number) => {
        const rad = (deltaDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const oldPts = poly.points.map(p => ({ ...p }));
        this.executeChange(`Obróć o ${deltaDeg}°`, () => {
          poly.points = poly.points.map(p => {
            const dx = p.x - cx;
            const dy = p.y - cy;
            return {
              x: cx + dx * cos - dy * sin,
              y: cy + dx * sin + dy * cos,
            };
          });
        }, () => { poly.points = oldPts; });
      };

      [
        { label: '+90°', deg: 90 },
        { label: '-90°', deg: -90 },
        { label: '180°', deg: 180 },
      ].forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'angle-btn';
        btn.textContent = `${tr('Obrót', 'Rot')} ${item.label}`;
        btn.addEventListener('click', () => rotateRect(item.deg));
        presetDiv.appendChild(btn);
      });
      container.appendChild(presetDiv);

      // Pole i obwód
      const stats = document.createElement('div');
      stats.innerHTML = `
        <div class="prop-row"><span>${tr('Pole powierzchni:', 'Area:')}</span> <b>${VectorMath.round(w * h)} ${this.doc.unit}²</b></div>
        <div class="prop-row"><span>${tr('Obwód:', 'Perimeter:')}</span> <b>${VectorMath.round(2 * (w + h))} ${this.doc.unit}</b></div>
      `;
      container.appendChild(stats);
    } else {
      // General polyline
      let perim = 0;
      for (let i = 0; i < (poly.closed ? poly.points.length : poly.points.length - 1); i++) {
        perim += VectorMath.distance(poly.points[i], poly.points[(i + 1) % poly.points.length]);
      }
      container.innerHTML += `
        <div class="prop-row"><span>${tr('Wierzchołków:', 'Vertices:')}</span> <b>${poly.points.length}</b></div>
        <div class="prop-row"><span>${tr('Obwód całkowity:', 'Total Perimeter:')}</span> <b>${VectorMath.round(perim)} ${this.doc.unit}</b></div>
        <div class="prop-row"><span>${tr('Zamknięta:', 'Closed:')}</span> <b>${poly.closed ? tr('Tak', 'Yes') : tr('Nie', 'No')}</b></div>
      `;
    }
  }

  // --- POINT INSPECTOR ---
  private renderPointInspector(pt: PointEntity, container: HTMLElement) {
    container.appendChild(this.createInputRow(`${tr('Pozycja X:', 'Position X:')}`, pt.x, (v) => {
      const old = pt.x;
      this.executeChange('Zmień X punktu', () => { pt.x = v; }, () => { pt.x = old; });
    }));
    container.appendChild(this.createInputRow(`${tr('Pozycja Y:', 'Position Y:')}`, pt.y, (v) => {
      const old = pt.y;
      this.executeChange('Zmień Y punktu', () => { pt.y = v; }, () => { pt.y = old; });
    }));
  }

  // --- IMAGE / UNDERLAY INSPECTOR ---
  private renderImageInspector(img: ImageEntity, container: HTMLElement) {
    container.appendChild(this.createInputRow(`${tr('Szerokość (W)', 'Width (W)')} [${this.doc.unit}]:`, img.width, (v) => {
      if (v <= 0) return;
      const oldW = img.width;
      const oldH = img.height;
      const ratio = oldW > 0 ? oldH / oldW : 1;
      this.executeChange('Zmień szerokość obrazu', () => {
        img.width = v;
        img.height = VectorMath.round(v * ratio, 3);
      }, () => {
        img.width = oldW;
        img.height = oldH;
      });
    }));

    container.appendChild(this.createInputRow(`${tr('Wysokość (H)', 'Height (H)')} [${this.doc.unit}]:`, img.height, (v) => {
      if (v <= 0) return;
      const oldW = img.width;
      const oldH = img.height;
      const ratio = oldH > 0 ? oldW / oldH : 1;
      this.executeChange('Zmień wysokość obrazu', () => {
        img.height = v;
        img.width = VectorMath.round(v * ratio, 3);
      }, () => {
        img.width = oldW;
        img.height = oldH;
      });
    }));

    // Opacity slider
    const opRow = document.createElement('div');
    opRow.className = 'prop-row';
    const curPct = Math.round((img.opacity ?? 1) * 100);
    opRow.innerHTML = `<span>${tr('Przezroczystość:', 'Opacity:')}</span><span id="insp-img-op-val">${curPct}%</span>`;
    container.appendChild(opRow);

    const opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.min = '10';
    opSlider.max = '100';
    opSlider.value = String(curPct);
    opSlider.style.width = '100%';
    opSlider.addEventListener('input', () => {
      const pct = parseInt(opSlider.value, 10) || 100;
      img.opacity = pct / 100;
      const lbl = opRow.querySelector('#insp-img-op-val');
      if (lbl) lbl.textContent = `${pct}%`;
      this.doc.notifyChange();
      this.requestRender();
    });
    container.appendChild(opSlider);

    if (this.transform) {
      const calBtn = document.createElement('button');
      calBtn.className = 'top-btn highlight';
      calBtn.style.cssText = 'width:100%; justify-content:center; margin-top:6px;';
      calBtn.textContent = `📏 ${tr('Kalibruj skalę 2 punktami', 'Calibrate Scale (2 points)')}`;
      calBtn.addEventListener('click', () => {
        if (this.transform) {
          UnderlayManager.startTwoPointCalibration(img, this.doc, this.history, this.transform, this.requestRender);
        }
      });
      container.appendChild(calBtn);
    }
  }

  // --- DIMENSION INSPECTOR ---
  private renderDimensionInspector(dim: DimensionEntity, container: HTMLElement) {
    let valText = '';
    if (dim.dimType === 'radius' || dim.dimType === 'diameter') {
      const r = dim.radius || VectorMath.distance(dim.center || dim.p1, dim.p2);
      valText = dim.dimType === 'diameter'
        ? `Ø${VectorMath.round(r * 2)} ${this.doc.unit}`
        : `R${VectorMath.round(r)} ${this.doc.unit}`;
    } else if (dim.dimType === 'angular') {
      const c = dim.center || { x: 0, y: 0 };
      const a1 = Math.atan2(dim.p1.y - c.y, dim.p1.x - c.x);
      const a2 = Math.atan2(dim.p2.y - c.y, dim.p2.x - c.x);
      let diff = a2 - a1;
      while (diff <= -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      valText = `${VectorMath.round(Math.abs((diff * 180) / Math.PI), 1)}°`;
    } else if (dim.dimType === 'arc-length') {
      const c = dim.center || { x: 0, y: 0 };
      const { arcLength } = Geometry.computeArcSweep(c, dim.p1, dim.p2, dim.arcMidPt);
      valText = `⌒ ${VectorMath.round(arcLength)} ${this.doc.unit}`;
    } else if (dim.dimType === 'leader') {
      valText = dim.customText || tr('Odnośnik', 'Leader');
    } else {
      const dist = VectorMath.distance(dim.p1, dim.p2);
      valText = `${VectorMath.round(dist)} ${this.doc.unit}`;
    }

    const infoDiv = document.createElement('div');
    infoDiv.innerHTML = `
      <div class="prop-row"><span>${tr('Zmierzona wartość:', 'Measured Value:')}</span> <b class="highlight-val">${valText}</b></div>
    `;
    container.appendChild(infoDiv);

    if (dim.dimType === 'radius' || dim.dimType === 'diameter') {
      const rowMode = document.createElement('div');
      rowMode.className = 'prop-row';
      rowMode.innerHTML = `<span>${tr('Typ wymiaru koła:', 'Circle Dim Type:')}</span>`;
      const sel = document.createElement('select');
      sel.className = 'prop-input prop-input-full';
      sel.innerHTML = `
        <option value="diameter" ${dim.dimType === 'diameter' ? 'selected' : ''}>${tr('Średnica (Ø)', 'Diameter (Ø)')}</option>
        <option value="radius" ${dim.dimType === 'radius' ? 'selected' : ''}>${tr('Promień (R)', 'Radius (R)')}</option>
      `;
      sel.addEventListener('change', () => {
        const old = dim.dimType;
        const next = sel.value as 'diameter' | 'radius';
        this.executeChange(`Zmień typ wymiaru na ${next}`, () => { dim.dimType = next; }, () => { dim.dimType = old; });
      });
      rowMode.appendChild(sel);
      container.appendChild(rowMode);
    } else {
      container.appendChild(this.createInputRow(`${tr('Odsunięcie linii:', 'Line Offset:')}`, dim.offset, (v) => {
        const old = dim.offset;
        const oldR = dim.radius;
        this.executeChange('Zmień odsunięcie wymiaru', () => {
          dim.offset = v;
          if (dim.dimType === 'angular') dim.radius = Math.max(Math.abs(v), 0.1);
          if (dim.dimType === 'arc-length' && dim.center) {
            const srcR = VectorMath.distance(dim.center, dim.p1);
            dim.radius = Math.max(srcR + v, 0.5);
          }
        }, () => {
          dim.offset = old;
          dim.radius = oldR;
        });
      }));
    }

    const defaultH = this.doc.unit === 'm' ? 0.28 : this.doc.unit === 'cm' ? 0.35 : this.doc.unit === 'in' ? 0.14 : 3.5;
    container.appendChild(this.createInputRow(`${tr('Wysokość czcionki', 'Font Height')} [${this.doc.unit}]:`, dim.textHeight || defaultH, (h) => {
      if (h <= 0) return;
      const old = dim.textHeight || defaultH;
      this.executeChange('Zmień wysokość czcionki wymiaru', () => { dim.textHeight = h; }, () => { dim.textHeight = old; });
    }));

    // Nadpisanie tekstu wymiaru
    const rowText = document.createElement('div');
    rowText.className = 'prop-row';
    rowText.innerHTML = `<span>${tr('Nadpisz tekst:', 'Override Text:')}</span>`;
    const inputContent = document.createElement('input');
    inputContent.type = 'text';
    inputContent.className = 'prop-input prop-input-full';
    inputContent.value = dim.customText || '';
    inputContent.placeholder = valText;
    inputContent.addEventListener('change', () => {
      const old = dim.customText;
      const val = inputContent.value.trim() || undefined;
      this.executeChange('Zmień tekst wymiaru', () => { dim.customText = val; }, () => { dim.customText = old; });
    });
    rowText.appendChild(inputContent);
    container.appendChild(rowText);
  }

  // --- HELPER: CREATE EDITABLE INPUT ROW ---
  private createInputRow(label: string, initialValue: number, onChange: (val: number) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'prop-row';

    const span = document.createElement('span');
    span.textContent = label;
    row.appendChild(span);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.className = 'prop-input';
    input.value = (Math.round(initialValue * 100) / 100).toString();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });

    input.addEventListener('change', () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        onChange(val);
      }
    });

    row.appendChild(input);
    return row;
  }

  // --- HELPER: EXECUTE COMMAND WITH UNDO/REDO ---
  private executeChange(desc: string, apply: () => void, revert: () => void) {
    const cmd: Command = {
      description: desc,
      execute: () => {
        apply();
        this.doc.notifyChange();
        this.render();
      },
      undo: () => {
        revert();
        this.doc.notifyChange();
        this.render();
      },
    };
    this.history.execute(cmd);
    this.requestRender();
  }
}

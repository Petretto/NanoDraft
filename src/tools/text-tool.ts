import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, TextEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { tr } from '../i18n/lang';

export class TextTool extends BaseTool {
  readonly id = 'text';
  readonly name = 'Tekst';
  readonly shortcut = 'T';

  private p1: Point2D | null = null;
  private currentPt: Point2D | null = null;

  activate(context: ToolContext) {
    this.p1 = null;
    this.currentPt = null;
    context.setHint(
      tr(
        'TEKST: Wskaż 1. narożnik ramki tekstowej (lub kliknij dwukrotnie w jednym punkcie)',
        'TEXT: Click 1st corner of text frame (or click twice at the same point)'
      )
    );
  }

  deactivate(context: ToolContext) {
    this.cancel(context);
  }

  cancel(context: ToolContext) {
    this.p1 = null;
    this.currentPt = null;
    context.hud.hide();
    context.setHint('');
    context.requestRender();
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;

    if (!this.p1) {
      this.p1 = { ...pt };
      this.currentPt = { ...pt };
      context.setHint(
        tr(
          'TEKST: Wskaż 2. narożnik ramki (np. narożnik prostokąta) LUB kliknij w tym samym miejscu / naciśnij Enter',
          'TEXT: Click 2nd corner of text frame (e.g. rectangle corner) OR click same point / press Enter'
        )
      );
      context.requestRender();
    } else {
      const p1 = this.p1;
      const p2 = pt;
      this.p1 = null;
      this.currentPt = null;
      context.requestRender();
      this.openTextPrompt(p1, p2, context);
    }
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    this.currentPt = { ...pt };
    if (this.p1) {
      context.requestRender();
    }
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    if (e.key === 'Enter' && this.p1) {
      const p1 = this.p1;
      this.p1 = null;
      this.currentPt = null;
      context.requestRender();
      this.openTextPrompt(p1, p1, context);
      return true;
    }
    return false;
  }

  private openTextPrompt(p1: Point2D, p2: Point2D, context: ToolContext) {
    const hasCustomBox = VectorMath.distance(p1, p2) > 0.05;
    const defaultHeight =
      context.doc.unit === 'm' ? 0.35 : context.doc.unit === 'cm' ? 0.5 : context.doc.unit === 'in' ? 0.2 : 5;

    const overlay = document.createElement('div');
    overlay.className = 'cad-modal-overlay';
    overlay.innerHTML = `
      <div class="cad-modal" style="width: 420px;">
        <div class="modal-header">
          <h3>🔤 ${tr('Wstaw Pole Tekstowe', 'Insert Text Box')}</h3>
          <button class="modal-close-btn" id="txt-modal-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:10px;">
          <div class="prop-row">
            <span>${tr('Treść tekstu:', 'Text Content:')}</span>
            <input type="text" id="txt-modal-content" class="prop-input" style="width: 220px; text-align:left;" value="${tr('Opis techniczny', 'Technical Label')}" />
          </div>
          <div class="prop-row">
            <span>${tr('Rozmiar czcionki', 'Font Size')} [${context.doc.unit}]:</span>
            <input type="number" step="any" id="txt-modal-height" class="prop-input" style="width: 110px;" value="${defaultHeight}" />
          </div>
          <div class="prop-row">
            <span>${tr('Wyrównanie poziome:', 'Horizontal Align:')}</span>
            <select id="txt-modal-align" class="prop-input" style="width: 160px; text-align:left;">
              <option value="left" ${!hasCustomBox ? 'selected' : ''}>⬅ ${tr('Do lewej (Left)', 'Left')}</option>
              <option value="center" ${hasCustomBox ? 'selected' : ''}>↔ ${tr('Wyśrodkuj (Center)', 'Center')}</option>
              <option value="right">➡ ${tr('Do prawej (Right)', 'Right')}</option>
            </select>
          </div>
          <div class="prop-row">
            <span>${tr('Wyrównanie pionowe:', 'Vertical Align:')}</span>
            <select id="txt-modal-baseline" class="prop-input" style="width: 160px; text-align:left;">
              <option value="top">⬆ ${tr('Góra ramki (Top)', 'Top')}</option>
              <option value="middle" ${hasCustomBox ? 'selected' : ''}>↕ ${tr('Środek ramki (Middle)', 'Middle')}</option>
              <option value="bottom" ${!hasCustomBox ? 'selected' : ''}>⬇ ${tr('Dół ramki (Bottom)', 'Bottom')}</option>
            </select>
          </div>
        </div>
        <div class="modal-footer" style="gap:8px;">
          <button class="top-btn" id="txt-modal-cancel">${tr('Anuluj', 'Cancel')}</button>
          <button class="top-btn highlight" id="txt-modal-ok">✓ ${tr('Wstaw tekst', 'Insert Text')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const contentInp = overlay.querySelector('#txt-modal-content') as HTMLInputElement;
    contentInp?.focus();
    contentInp?.select();

    const close = () => overlay.remove();
    overlay.querySelector('#txt-modal-close')?.addEventListener('click', close);
    overlay.querySelector('#txt-modal-cancel')?.addEventListener('click', close);

    const commit = () => {
      const userText = contentInp.value.trim();
      if (!userText) {
        close();
        return;
      }
      const hVal = parseFloat((overlay.querySelector('#txt-modal-height') as HTMLInputElement).value);
      const height = hVal > 0 ? hVal : defaultHeight;
      const align = (overlay.querySelector('#txt-modal-align') as HTMLSelectElement).value as 'left' | 'center' | 'right';
      const baseline = (overlay.querySelector('#txt-modal-baseline') as HTMLSelectElement).value as 'top' | 'middle' | 'bottom';

      const defaultW = Math.max(userText.length * height * 0.62, height * 1.5);
      const defaultH = height * 1.35;

      const x = hasCustomBox ? Math.min(p1.x, p2.x) : p1.x;
      const y = hasCustomBox ? Math.min(p1.y, p2.y) : p1.y;
      const boxWidth = hasCustomBox ? Math.max(Math.abs(p2.x - p1.x), height * 0.5) : defaultW;
      const boxHeight = hasCustomBox ? Math.max(Math.abs(p2.y - p1.y), height * 0.5) : defaultH;

      const textEnt: TextEntity = {
        id: 'txt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'text',
        layerId: context.doc.activeLayerId,
        text: userText,
        x,
        y,
        height,
        boxWidth,
        boxHeight,
        rotation: 0,
        align,
        baseline,
      };

      const cmd: Command = {
        description: `Dodaj Tekst "${userText}"`,
        execute: () => {
          context.doc.addEntity(textEnt);
          context.doc.selectEntity(textEnt.id, false);
        },
        undo: () => context.doc.removeEntity(textEnt.id),
      };
      context.history.execute(cmd);
      close();
      context.requestRender();
    };

    overlay.querySelector('#txt-modal-ok')?.addEventListener('click', commit);
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    });
  }

  getPreview(): RenderPreview | null {
    if (this.p1 && this.currentPt && VectorMath.distance(this.p1, this.currentPt) > 0.01) {
      return {
        type: 'rect',
        data: { p1: this.p1, p2: this.currentPt },
      };
    }
    return null;
  }
}

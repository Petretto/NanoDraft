import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, DimensionEntity } from '../types/cad';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export class LeaderTool extends BaseTool {
  readonly id = 'leader';
  readonly name = 'Odnośnik';
  readonly shortcut = 'N';

  private p1: Point2D | null = null;
  private currentPt: Point2D | null = null;
  private labelText: string = 'Fazować 2x45°';
  private textHeight: number = 3.5;
  private modeBarEl: HTMLDivElement | null = null;
  private lastContext: ToolContext | null = null;

  constructor() {
    super();
    i18n.onChange(() => {
      if (this.modeBarEl && this.modeBarEl.style.display !== 'none' && this.lastContext) {
        this.ensureModeBar(this.lastContext);
        this.updateHint(this.lastContext);
      }
    });
  }

  activate(context: ToolContext) {
    this.lastContext = context;
    this.p1 = null;
    this.currentPt = null;
    this.textHeight =
      context.doc.unit === 'm' ? 0.28 : context.doc.unit === 'cm' ? 0.35 : context.doc.unit === 'in' ? 0.14 : 3.5;
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.p1 = null;
    this.currentPt = null;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.p1 = null;
    this.currentPt = null;
    this.updateHint(context);
    context.requestRender();
  }

  private ensureModeBar(context: ToolContext) {
    const viewport = document.querySelector('.cad-viewport-container') as HTMLElement;
    if (!viewport) return;

    if (!this.modeBarEl) {
      this.modeBarEl = document.createElement('div');
      this.modeBarEl.className = 'cad-dim-mode-bar';
      this.modeBarEl.addEventListener('mousedown', e => e.stopPropagation());
      viewport.appendChild(this.modeBarEl);
    }

    const presets = [
      'Fazować 2x45°',
      'Spaw a=4',
      'Otwór M12',
      'Szlifować Ra 1.6',
      'Zasilanie 400V',
    ];

    this.modeBarEl.style.display = 'flex';
    this.modeBarEl.innerHTML = `
      <span class="dim-bar-title">↗ ${tr('Odnośnik (Leader):', 'Leader Callout:')}</span>
      <input id="ldr-text-input" type="text" value="${this.labelText.replace(/"/g, '&quot;')}" placeholder="${tr('Tekst odnośnika...', 'Callout text...')}" class="prop-input" style="width:165px; height:24px; padding:2px 6px; text-align:left;" />
      <select id="ldr-preset-select" class="prop-input" style="width:125px; height:24px; padding:1px 4px; text-align:left;" title="${tr('Szybkie szablony opisów warsztatowych', 'Quick workshop callout presets')}">
        <option value="">${tr('⚡ Szablony...', '⚡ Presets...')}</option>
        ${presets.map(p => `<option value="${p}">${p}</option>`).join('')}
      </select>
      <span style="font-size:11px; color:var(--text-muted); margin-left:4px;">${tr('Czcionka', 'Font')} [${context.doc.unit}]:</span>
      <input id="ldr-height-input" type="number" min="0.05" step="0.5" value="${this.textHeight}" class="prop-input" style="width:54px; height:24px; padding:2px 4px;" />
    `;

    const textInp = this.modeBarEl.querySelector('#ldr-text-input') as HTMLInputElement;
    const presetSel = this.modeBarEl.querySelector('#ldr-preset-select') as HTMLSelectElement;
    const heightInp = this.modeBarEl.querySelector('#ldr-height-input') as HTMLInputElement;

    textInp?.addEventListener('keydown', e => e.stopPropagation());
    textInp?.addEventListener('input', () => {
      this.labelText = textInp.value || 'Opis';
      context.requestRender();
    });

    presetSel?.addEventListener('change', () => {
      if (presetSel.value) {
        this.labelText = presetSel.value;
        if (textInp) textInp.value = presetSel.value;
        presetSel.value = '';
        context.requestRender();
      }
    });

    heightInp?.addEventListener('keydown', e => e.stopPropagation());
    heightInp?.addEventListener('input', () => {
      const v = parseFloat(heightInp.value);
      if (!isNaN(v) && v > 0.02) {
        this.textHeight = v;
        context.requestRender();
      }
    });
  }

  private updateHint(context: ToolContext) {
    if (!this.p1) {
      context.setHint(
        tr(
          'ODNOŚNIK (Leader): Krok 1 — Kliknij punkt na detalu, który ma wskazywać grot strzałki (OSNAP aktywny)',
          'LEADER CALLOUT: Step 1 — Click the point on the detail where the arrowhead should point (OSNAP active)'
        )
      );
    } else {
      context.setHint(
        tr(
          'ODNOŚNIK (Leader): Krok 2 — Przesuń kursor i kliknij punkt załamania półki tekstowej (tekst możesz wpisać na pasku u góry)',
          'LEADER CALLOUT: Step 2 — Move cursor and click the landing shelf elbow point (edit text on the top bar)'
        )
      );
    }
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;
    const pt = snapPt ? snapPt.point : worldPt;

    if (!this.p1) {
      this.p1 = { ...pt };
      this.currentPt = { ...pt };
      this.updateHint(context);
      context.requestRender();
      return;
    }

    const p2 = { ...pt };
    const dirSign = p2.x >= this.p1.x ? 1 : -1;
    const text = this.labelText.trim() || 'Odnośnik';
    const shelfLen = Math.max(text.length * this.textHeight * 0.62, this.textHeight * 3);

    const layerId = context.doc.layers.some(l => l.id === 'dimensions') ? 'dimensions' : context.doc.activeLayerId;
    const leaderEnt: DimensionEntity = {
      id: `leader_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'dimension',
      layerId,
      dimType: 'leader',
      p1: { ...this.p1 },
      p2,
      offset: dirSign * shelfLen,
      customText: text,
      textHeight: this.textHeight,
      selected: false,
    };

    const cmd: Command = {
      description: tr(`Dodaj odnośnik: ${text}`, `Add leader callout: ${text}`),
      execute: () => context.doc.addEntity(leaderEnt),
      undo: () => context.doc.removeEntity(leaderEnt.id),
    };
    context.history.execute(cmd);

    this.p1 = null;
    this.currentPt = null;
    this.updateHint(context);
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    this.currentPt = snapPt ? { ...snapPt.point } : { ...worldPt };
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  getBasePoint(): Point2D | null {
    return this.p1;
  }

  getPreview(): RenderPreview | null {
    if (!this.p1 || !this.currentPt) return null;

    const dirSign = this.currentPt.x >= this.p1.x ? 1 : -1;
    const text = this.labelText.trim() || 'Odnośnik';
    const shelfLen = Math.max(text.length * this.textHeight * 0.62, this.textHeight * 3);

    const previewLeader: DimensionEntity = {
      id: '__preview_leader',
      type: 'dimension',
      layerId: 'dimensions',
      dimType: 'leader',
      p1: this.p1,
      p2: this.currentPt,
      offset: dirSign * shelfLen,
      customText: text,
      textHeight: this.textHeight,
    };

    return {
      type: 'ghost',
      data: {
        entities: [previewLeader],
      },
    };
  }
}

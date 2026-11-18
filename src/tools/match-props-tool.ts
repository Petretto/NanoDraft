import { BaseTool, ToolContext } from './base-tool';
import { CadEntity, LineType, Point2D, SnapPoint } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

interface SampledStyle {
  sourceId: string;
  sourceType: CadEntity['type'];
  layerId: string;
  color?: string;
  effectiveColor: string;
  lineWidth?: number;
  effectiveLineWidth: number;
  lineType?: LineType;
  effectiveLineType: LineType;
  textSize?: number;
}

export class MatchPropsTool extends BaseTool {
  readonly id = 'match-props';
  readonly name = 'Pędzel';
  readonly shortcut = 'J';

  private sample: SampledStyle | null = null;
  private hoveredEntity: CadEntity | null = null;
  private appliedCount: number = 0;

  private copyLayer: boolean = true;
  private copyColor: boolean = true;
  private copyLineStyle: boolean = true;
  private copyTextSize: boolean = true;

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

  acceptsPointInput(): boolean {
    return false;
  }

  activate(context: ToolContext) {
    this.lastContext = context;
    this.hoveredEntity = null;
    this.appliedCount = 0;

    // If user pre-selected a single entity (or multiple entities of same style), sample the first one automatically
    const selected = context.doc.getSelectedEntities();
    if (selected.length === 1) {
      this.sample = this.extractStyle(selected[0], context);
      context.doc.clearSelection();
    } else {
      this.sample = null;
    }

    this.ensureModeBar(context);
    this.updateHint(context);
    context.requestRender();
  }

  deactivate(context: ToolContext) {
    this.sample = null;
    this.hoveredEntity = null;
    this.appliedCount = 0;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.sample = null;
    this.hoveredEntity = null;
    this.appliedCount = 0;
    this.ensureModeBar(context);
    this.updateHint(context);
    context.requestRender();
  }

  private extractStyle(ent: CadEntity, context: ToolContext): SampledStyle {
    const layer = context.doc.layers.find(l => l.id === ent.layerId);
    const effectiveColor = ent.color || layer?.color || '#ffffff';
    const effectiveLineWidth = ent.lineWidth ?? layer?.lineWidth ?? 1.0;
    const effectiveLineType: LineType = ent.lineType ?? layer?.lineType ?? 'continuous';

    let textSize: number | undefined;
    if (ent.type === 'text') textSize = ent.height;
    else if (ent.type === 'dimension') textSize = ent.textHeight ?? 3.5;

    return {
      sourceId: ent.id,
      sourceType: ent.type,
      layerId: ent.layerId,
      color: ent.color,
      effectiveColor,
      lineWidth: ent.lineWidth,
      effectiveLineWidth,
      lineType: ent.lineType,
      effectiveLineType,
      textSize,
    };
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

    const layerName = this.sample
      ? context.doc.layers.find(l => l.id === this.sample!.layerId)?.name || this.sample.layerId
      : '';

    const lineTypeLabel = (lt: LineType) => {
      if (lt === 'dashed') return tr('Przerywana', 'Dashed');
      if (lt === 'dashdot') return tr('Oś', 'Center');
      if (lt === 'dotted') return tr('Kropkowana', 'Dotted');
      return tr('Ciągła', 'Continuous');
    };

    this.modeBarEl.style.display = 'flex';
    this.modeBarEl.innerHTML = `
      <span class="dim-bar-title">🖌️ ${tr('Pędzel właściwości:', 'Match Properties:')}</span>
      ${
        this.sample
          ? `
            <span style="display:inline-flex; align-items:center; gap:5px; padding:2px 7px; border-radius:4px; background:rgba(0,229,255,0.12); border:1px solid var(--accent-color); font-size:11px;">
              <span style="width:10px; height:10px; border-radius:50%; background:${this.sample.effectiveColor}; border:1px solid #fff; display:inline-block;"></span>
              <strong>${layerName}</strong>
              <span style="color:var(--text-muted);">| ${this.sample.effectiveLineWidth}px · ${lineTypeLabel(this.sample.effectiveLineType)}${
                this.sample.textSize !== undefined ? ` · T:${this.sample.textSize}` : ''
              }</span>
            </span>
            <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--text-main); cursor:pointer;">
              <input id="mp-layer" type="checkbox" ${this.copyLayer ? 'checked' : ''} /> ${tr('Warstwa', 'Layer')}
            </label>
            <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--text-main); cursor:pointer;">
              <input id="mp-color" type="checkbox" ${this.copyColor ? 'checked' : ''} /> ${tr('Kolor', 'Color')}
            </label>
            <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--text-main); cursor:pointer;">
              <input id="mp-style" type="checkbox" ${this.copyLineStyle ? 'checked' : ''} /> ${tr('Linia', 'Line')}
            </label>
            <label style="display:inline-flex; align-items:center; gap:3px; font-size:11px; color:var(--text-main); cursor:pointer;">
              <input id="mp-text" type="checkbox" ${this.copyTextSize ? 'checked' : ''} /> ${tr('Czcionka', 'Font')}
            </label>
            <button id="mp-repick" class="dim-mode-btn" title="${tr('Pobierz styl z innego obiektu wzorcowego', 'Pick another source entity')}">
              🔄 ${tr('Zmień wzorzec', 'Repick')}
            </button>
          `
          : `<span style="font-size:11px; color:var(--text-muted);">${tr('Kliknij obiekt wzorcowy na rysunku, aby pobrać jego styl...', 'Click a source object on the canvas to sample its style...')}</span>`
      }
    `;

    this.modeBarEl.querySelector('#mp-layer')?.addEventListener('change', e => {
      this.copyLayer = (e.target as HTMLInputElement).checked;
    });
    this.modeBarEl.querySelector('#mp-color')?.addEventListener('change', e => {
      this.copyColor = (e.target as HTMLInputElement).checked;
    });
    this.modeBarEl.querySelector('#mp-style')?.addEventListener('change', e => {
      this.copyLineStyle = (e.target as HTMLInputElement).checked;
    });
    this.modeBarEl.querySelector('#mp-text')?.addEventListener('change', e => {
      this.copyTextSize = (e.target as HTMLInputElement).checked;
    });
    this.modeBarEl.querySelector('#mp-repick')?.addEventListener('click', e => {
      e.stopPropagation();
      this.sample = null;
      this.appliedCount = 0;
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
    });
  }

  private updateHint(context: ToolContext) {
    if (!this.sample) {
      context.setHint(
        tr(
          'PĘDZEL WŁAŚCIWOŚCI (J): Krok 1 — Kliknij obiekt wzorcowy, z którego chcesz skopiować warstwę, kolor i styl linii',
          'MATCH PROPERTIES (J): Step 1 — Click the source object to copy its layer, color, line style & font size'
        )
      );
    } else {
      const countInfo =
        this.appliedCount > 0
          ? tr(` (zastosowano: ${this.appliedCount})`, ` (applied: ${this.appliedCount})`)
          : '';
      context.setHint(
        tr(
          `PĘDZEL WŁAŚCIWOŚCI (J): Krok 2 — Klikaj obiekty docelowe, aby nałożyć styl (Shift+klik = cała grupa, Esc/PPM = koniec)${countInfo}`,
          `MATCH PROPERTIES (J): Step 2 — Click target objects to apply properties (Shift+click = whole group, Esc/RMB = finish)${countInfo}`
        )
      );
    }
  }

  private findEntityAt(pt: Point2D, context: ToolContext, allowLocked: boolean): CadEntity | null {
    const tolerance = context.transform.screenDistToWorld(8);
    const minTextH = context.transform.screenDistToWorld(8);

    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && !layer.visible) continue;
      if (!allowLocked && layer && layer.locked) continue;

      if (ent.type === 'point') {
        if (VectorMath.distance(pt, { x: ent.x, y: ent.y }) <= tolerance) return ent;
      } else if (ent.type === 'line') {
        if (VectorMath.distanceToSegment(pt, { x: ent.x1, y: ent.y1 }, { x: ent.x2, y: ent.y2 }) <= tolerance) {
          return ent;
        }
      } else if (ent.type === 'circle') {
        const d = VectorMath.distance(pt, { x: ent.cx, y: ent.cy });
        if (Math.abs(d - ent.radius) <= tolerance || d <= tolerance) return ent;
      } else if (ent.type === 'polyline') {
        const count = ent.closed ? ent.points.length : ent.points.length - 1;
        for (let j = 0; j < count; j++) {
          const pA = ent.points[j];
          const pB = ent.points[(j + 1) % ent.points.length];
          if (VectorMath.distanceToSegment(pt, pA, pB) <= tolerance) return ent;
        }
      } else if (ent.type === 'text') {
        if (Geometry.isPointInText(pt, ent, tolerance * 0.8, minTextH)) return ent;
      } else if (ent.type === 'dimension') {
        const { segments, points } = Geometry.dimensionGeometry(ent);
        for (const s of segments) {
          if (VectorMath.distanceToSegment(pt, s.a, s.b) <= tolerance * 1.5) return ent;
        }
        for (const p of points) {
          if (VectorMath.distance(pt, p) <= tolerance * 1.5) return ent;
        }
      }
    }
    return null;
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    if (!this.sample) {
      const src = this.findEntityAt(worldPt, context, true);
      if (!src) {
        context.setHint(
          tr(
            'PĘDZEL WŁAŚCIWOŚCI: Kliknij bezpośrednio na krawędź lub napis obiektu wzorcowego.',
            'MATCH PROPERTIES: Click directly on the edge or text of a source object.'
          )
        );
        return;
      }
      this.sample = this.extractStyle(src, context);
      this.appliedCount = 0;
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return;
    }

    const target = this.findEntityAt(worldPt, context, false);
    if (!target) return;

    // Collect target entity (or entire group if Shift is held)
    const targets: CadEntity[] =
      e.shiftKey && target.groupId
        ? context.doc.entities.filter(ent => {
            if (ent.groupId !== target.groupId) return false;
            const l = context.doc.layers.find(lay => lay.id === ent.layerId);
            return !(l && l.locked);
          })
        : [target];

    if (targets.length === 0) return;

    const sample = this.sample;
    const copyLayer = this.copyLayer;
    const copyColor = this.copyColor;
    const copyLineStyle = this.copyLineStyle;
    const copyTextSize = this.copyTextSize;

    const beforeSnapshots = targets.map(t => ({
      id: t.id,
      layerId: t.layerId,
      color: t.color,
      lineWidth: t.lineWidth,
      lineType: t.lineType,
      height: t.type === 'text' ? t.height : undefined,
      textHeight: t.type === 'dimension' ? t.textHeight : undefined,
    }));

    const applyToEntity = (ent: CadEntity) => {
      if (copyLayer) {
        ent.layerId = sample.layerId;
      }
      if (copyColor) {
        if (copyLayer) {
          // Mirror exact override state (inherit layer color if source inherits)
          ent.color = sample.color;
        } else {
          // Target keeps its own layer -> apply explicit effective color
          ent.color = sample.effectiveColor;
        }
      }
      if (copyLineStyle) {
        if (copyLayer) {
          ent.lineWidth = sample.lineWidth;
          ent.lineType = sample.lineType;
        } else {
          ent.lineWidth = sample.effectiveLineWidth;
          ent.lineType = sample.effectiveLineType;
        }
      }
      if (copyTextSize && sample.textSize !== undefined) {
        if (ent.type === 'text') {
          ent.height = sample.textSize;
        } else if (ent.type === 'dimension') {
          ent.textHeight = sample.textSize;
        }
      }
    };

    const cmd: Command = {
      description: tr(
        `Pędzel właściwości (${targets.length} ob.)`,
        `Match Properties (${targets.length} obj.)`
      ),
      execute: () => {
        for (const snap of beforeSnapshots) {
          const ent = context.doc.getEntity(snap.id);
          if (ent) applyToEntity(ent);
        }
        context.doc.notifyChange();
      },
      undo: () => {
        for (const snap of beforeSnapshots) {
          const ent = context.doc.getEntity(snap.id);
          if (!ent) continue;
          ent.layerId = snap.layerId;
          ent.color = snap.color;
          ent.lineWidth = snap.lineWidth;
          ent.lineType = snap.lineType;
          if (ent.type === 'text' && snap.height !== undefined) ent.height = snap.height;
          if (ent.type === 'dimension') ent.textHeight = snap.textHeight;
        }
        context.doc.notifyChange();
      },
    };

    context.history.execute(cmd);
    this.appliedCount += targets.length;
    this.updateHint(context);
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    const found = this.findEntityAt(worldPt, context, !this.sample);
    if (found?.id !== this.hoveredEntity?.id) {
      this.hoveredEntity = found;
      context.requestRender();
    }
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    return false;
  }

  getPreview(): RenderPreview | null {
    if (!this.hoveredEntity) return null;
    const previewEnt: CadEntity = JSON.parse(JSON.stringify(this.hoveredEntity));
    previewEnt.selected = false;
    if (this.sample) {
      previewEnt.color = this.sample.effectiveColor;
      previewEnt.lineWidth = Math.max(this.sample.effectiveLineWidth, 2.2);
      previewEnt.lineType = this.sample.effectiveLineType;
    }
    return {
      type: 'ghost',
      data: {
        entities: [previewEnt],
      },
    };
  }
}

import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, CadEntity, LineEntity, PolylineEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type CornerMode = 'fillet' | 'chamfer' | 'corner0';

interface PickedEdge {
  entity: LineEntity | PolylineEntity;
  segIndex: number; // 0 for LineEntity, segment index for PolylineEntity
  p1: Point2D;
  p2: Point2D;
  clickPt: Point2D;
}

export class FilletTool extends BaseTool {
  readonly id = 'fillet';
  readonly name = 'Zaokrąglij / Fazuj';
  readonly shortcut = 'G';

  private mode: CornerMode = 'fillet';
  private radiusOrDist: number = 5;
  private firstEdge: PickedEdge | null = null;
  private hoverEdge: PickedEdge | null = null;
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
    this.firstEdge = null;
    this.hoverEdge = null;
    this.ensureModeBar(context);
    this.updateHint(context);
  }

  deactivate(context: ToolContext) {
    this.firstEdge = null;
    this.hoverEdge = null;
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.hud.hide();
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.firstEdge = null;
    this.hoverEdge = null;
    context.hud.hide();
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

    const modes: { id: CornerMode; label: string; title: string }[] = [
      {
        id: 'fillet',
        label: `◜ ${tr('Zaokrąglij (Fillet R)', 'Fillet (Radius R)')}`,
        title: tr('Zaokrąglij styk dwóch linii łukiem o promieniu R', 'Round corner of two lines with radius R'),
      },
      {
        id: 'chamfer',
        label: `╱ ${tr('Fazuj (Chamfer D)', 'Chamfer (Dist D)')}`,
        title: tr('Sfazuj narożnik dwóch linii o wymiar D', 'Bevel corner of two lines by distance D'),
      },
      {
        id: 'corner0',
        label: `∟ ${tr('Ostry narożnik (R=0)', 'Sharp Corner (R=0)')}`,
        title: tr('Dotnij lub przedłuż dwie linie do wspólnego narożnika', 'Trim/extend two lines to a sharp corner'),
      },
    ];

    const paramLabel =
      this.mode === 'fillet'
        ? `R [${context.doc.unit}]:`
        : this.mode === 'chamfer'
        ? `D [${context.doc.unit}]:`
        : '';

    this.modeBarEl.style.display = 'flex';
    this.modeBarEl.innerHTML = `
      <span class="dim-bar-title">◜ ${tr('Narożnik:', 'Corner:')}</span>
      ${modes
        .map(
          (m, idx) => `
        <button class="dim-mode-btn ${this.mode === m.id ? 'active' : ''}" data-mode="${m.id}" title="${m.title} [${idx + 1}]">
          ${m.label}
        </button>
      `
        )
        .join('')}
      ${
        this.mode !== 'corner0'
          ? `
        <span style="font-size:11px; color:var(--text-muted); margin-left:6px; font-weight:600;">${paramLabel}</span>
        <input id="fillet-param-input" type="number" min="0" step="0.5" value="${this.radiusOrDist}" class="prop-input" style="width:72px; height:24px; padding:2px 6px; font-size:12px;" />
      `
          : ''
      }
    `;

    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.stopPropagation());
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const m = (btn as HTMLElement).getAttribute('data-mode') as CornerMode;
        if (m) {
          this.mode = m;
          this.ensureModeBar(context);
          this.updateHint(context);
          context.requestRender();
        }
      });
    });

    const inputEl = this.modeBarEl.querySelector('#fillet-param-input') as HTMLInputElement | null;
    if (inputEl) {
      inputEl.addEventListener('mousedown', e => e.stopPropagation());
      inputEl.addEventListener('keydown', e => e.stopPropagation());
      inputEl.addEventListener('change', () => {
        const v = parseFloat(inputEl.value);
        if (!isNaN(v) && v >= 0) {
          this.radiusOrDist = v;
          this.updateHint(context);
          context.requestRender();
        }
      });
      inputEl.addEventListener('input', () => {
        const v = parseFloat(inputEl.value);
        if (!isNaN(v) && v >= 0) {
          this.radiusOrDist = v;
          context.requestRender();
        }
      });
    }
  }

  private updateHint(context: ToolContext) {
    const modeName =
      this.mode === 'fillet'
        ? tr(`ZAOKRĄGLENIE (R=${this.radiusOrDist} ${context.doc.unit})`, `FILLET (R=${this.radiusOrDist} ${context.doc.unit})`)
        : this.mode === 'chamfer'
        ? tr(`FAZOWANIE (D=${this.radiusOrDist} ${context.doc.unit})`, `CHAMFER (D=${this.radiusOrDist} ${context.doc.unit})`)
        : tr('OSTRY NAROŻNIK (R=0)', 'SHARP CORNER (R=0)');

    if (!this.firstEdge) {
      context.setHint(
        `${modeName}: ${tr('Kliknij pierwszą linię lub bok polilinii/prostokąta', 'Click the first line or polyline/rectangle edge')}`
      );
    } else {
      context.setHint(
        `${modeName}: ${tr('Kliknij drugą linię lub sąsiedni bok, aby wykonać narożnik', 'Click the second line or adjacent edge to complete corner')}`
      );
    }
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    const picked = this.pickEdgeAt(worldPt, context);
    if (!picked) {
      context.setHint(tr('Najedź i kliknij na linię lub bok prostokąta/polilinii!', 'Hover and click on a line or polyline edge!'));
      return;
    }

    if (!this.firstEdge) {
      this.firstEdge = picked;
      this.updateHint(context);
      context.requestRender();
      return;
    }

    // Second edge clicked
    const res = this.computeCornerGeometry(this.firstEdge, picked);
    if (!res) {
      context.setHint(
        tr(
          'Nie można utworzyć narożnika (linie są równoległe lub promień R jest za duży dla tych odcinków).',
          'Cannot create corner (lines are parallel or radius R is too large for these segments).'
        )
      );
      this.firstEdge = null;
      context.requestRender();
      return;
    }

    this.applyCornerModification(this.firstEdge, picked, res, context);
    this.firstEdge = null;
    this.hoverEdge = null;
    this.updateHint(context);
    context.requestRender();
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    this.hoverEdge = this.pickEdgeAt(worldPt, context);
    context.requestRender();
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }
    if (e.key === '1') {
      this.mode = 'fillet';
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    if (e.key === '2') {
      this.mode = 'chamfer';
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    if (e.key === '3') {
      this.mode = 'corner0';
      this.ensureModeBar(context);
      this.updateHint(context);
      context.requestRender();
      return true;
    }
    return false;
  }

  private pickEdgeAt(pt: Point2D, context: ToolContext): PickedEdge | null {
    const tol = 9 / context.transform.zoom;
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && (!layer.visible || layer.locked)) continue;

      if (ent.type === 'line') {
        const p1 = { x: ent.x1, y: ent.y1 };
        const p2 = { x: ent.x2, y: ent.y2 };
        if (VectorMath.pointToSegmentDistance(pt, p1, p2) <= tol) {
          return { entity: ent, segIndex: 0, p1, p2, clickPt: { ...pt } };
        }
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        const segCount = ent.closed ? pts.length : pts.length - 1;
        for (let s = 0; s < segCount; s++) {
          const p1 = pts[s];
          const p2 = pts[(s + 1) % pts.length];
          if (VectorMath.pointToSegmentDistance(pt, p1, p2) <= tol) {
            return { entity: ent, segIndex: s, p1: { ...p1 }, p2: { ...p2 }, clickPt: { ...pt } };
          }
        }
      }
    }
    return null;
  }

  /**
   * Computes infinite line intersection and tangent / chamfer points for two picked edges.
   */
  private computeCornerGeometry(
    e1: PickedEdge,
    e2: PickedEdge
  ): {
    intersection: Point2D;
    t1: Point2D; // tangent/chamfer start on edge 1
    t2: Point2D; // tangent/chamfer end on edge 2
    keepEnd1: Point2D; // the endpoint of edge 1 that remains
    keepEnd2: Point2D; // the endpoint of edge 2 that remains
    connectPts: Point2D[]; // intermediate points between t1 and t2 (arc points or empty for chamfer/corner0)
  } | null {
    if (e1.entity.id === e2.entity.id && e1.segIndex === e2.segIndex) return null;

    const inter = this.infiniteLineIntersection(e1.p1, e1.p2, e2.p1, e2.p2);
    if (!inter) return null;

    // Determine which endpoint of e1 and e2 is kept (the side where the user clicked relative to the intersection)
    const keepEnd1 = this.selectKeptEndpoint(e1.p1, e1.p2, e1.clickPt, inter);
    const keepEnd2 = this.selectKeptEndpoint(e2.p1, e2.p2, e2.clickPt, inter);

    const v1 = VectorMath.normalize({ x: keepEnd1.x - inter.x, y: keepEnd1.y - inter.y });
    const v2 = VectorMath.normalize({ x: keepEnd2.x - inter.x, y: keepEnd2.y - inter.y });

    const dot = Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y));
    const angleBetween = Math.acos(dot); // in (0, PI)
    if (angleBetween < 1e-4 || Math.abs(Math.PI - angleBetween) < 1e-4) return null;

    const param = this.mode === 'corner0' ? 0 : Math.max(0, this.radiusOrDist);

    if (param <= 1e-6 || this.mode === 'corner0') {
      return {
        intersection: inter,
        t1: inter,
        t2: inter,
        keepEnd1,
        keepEnd2,
        connectPts: [inter],
      };
    }

    if (this.mode === 'chamfer') {
      const len1 = VectorMath.distance(inter, keepEnd1);
      const len2 = VectorMath.distance(inter, keepEnd2);
      if (param >= len1 || param >= len2) return null;

      const t1 = { x: inter.x + v1.x * param, y: inter.y + v1.y * param };
      const t2 = { x: inter.x + v2.x * param, y: inter.y + v2.y * param };
      return {
        intersection: inter,
        t1,
        t2,
        keepEnd1,
        keepEnd2,
        connectPts: [t1, t2],
      };
    }

    // Fillet with radius R
    const halfAngle = angleBetween / 2;
    const tanHalf = Math.tan(halfAngle);
    const sinHalf = Math.sin(halfAngle);
    if (tanHalf < 1e-6 || sinHalf < 1e-6) return null;

    const tangentDist = param / tanHalf;
    const len1 = VectorMath.distance(inter, keepEnd1);
    const len2 = VectorMath.distance(inter, keepEnd2);
    if (tangentDist > len1 * 1.001 || tangentDist > len2 * 1.001) return null;

    const t1 = { x: inter.x + v1.x * tangentDist, y: inter.y + v1.y * tangentDist };
    const t2 = { x: inter.x + v2.x * tangentDist, y: inter.y + v2.y * tangentDist };

    // Arc center along angle bisector
    const bisector = VectorMath.normalize({ x: v1.x + v2.x, y: v1.y + v2.y });
    const centerDist = param / sinHalf;
    const center = {
      x: inter.x + bisector.x * centerDist,
      y: inter.y + bisector.y * centerDist,
    };

    const a1 = Math.atan2(t1.y - center.y, t1.x - center.x);
    const a2 = Math.atan2(t2.y - center.y, t2.x - center.x);
    let sweep = a2 - a1;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;

    const steps = 16;
    const connectPts: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const ang = a1 + (sweep * i) / steps;
      connectPts.push({
        x: center.x + Math.cos(ang) * param,
        y: center.y + Math.sin(ang) * param,
      });
    }

    return {
      intersection: inter,
      t1,
      t2,
      keepEnd1,
      keepEnd2,
      connectPts,
    };
  }

  private selectKeptEndpoint(p1: Point2D, p2: Point2D, clickPt: Point2D, inter: Point2D): Point2D {
    const d1 = VectorMath.distance(p1, inter);
    const d2 = VectorMath.distance(p2, inter);
    // If intersection is very close to one of the endpoints, keep the opposite endpoint
    if (d1 < 1e-4) return { ...p2 };
    if (d2 < 1e-4) return { ...p1 };

    // Check if clickPt and p1 are on the same side of inter
    const vClick = { x: clickPt.x - inter.x, y: clickPt.y - inter.y };
    const v1 = { x: p1.x - inter.x, y: p1.y - inter.y };
    const v2 = { x: p2.x - inter.x, y: p2.y - inter.y };

    const dot1 = vClick.x * v1.x + vClick.y * v1.y;
    const dot2 = vClick.x * v2.x + vClick.y * v2.y;
    if (dot1 > 0 && dot2 <= 0) return { ...p1 };
    if (dot2 > 0 && dot1 <= 0) return { ...p2 };

    // Fallback: keep the endpoint farther from intersection
    return d1 >= d2 ? { ...p1 } : { ...p2 };
  }

  private infiniteLineIntersection(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): Point2D | null {
    const x1 = a1.x, y1 = a1.y, x2 = a2.x, y2 = a2.y;
    const x3 = b1.x, y3 = b1.y, x4 = b2.x, y4 = b2.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-9) return null;

    const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
    const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
    return { x: px, y: py };
  }

  private applyCornerModification(
    e1: PickedEdge,
    e2: PickedEdge,
    res: NonNullable<ReturnType<FilletTool['computeCornerGeometry']>>,
    context: ToolContext
  ) {
    // Case 1: Both edges are on the SAME PolylineEntity and share a corner vertex
    if (e1.entity.type === 'polyline' && e2.entity.type === 'polyline' && e1.entity.id === e2.entity.id) {
      const poly = e1.entity;
      const oldPts = poly.points.map(p => ({ ...p }));
      const n = oldPts.length;
      const s1 = e1.segIndex;
      const s2 = e2.segIndex;

      // Find shared vertex index between segment s1 (s1 -> s1+1) and s2 (s2 -> s2+1)
      let sharedIdx = -1;
      let forwardOrder = true; // true if s1 comes immediately before s2 (s1 -> shared -> s2)
      if ((s1 + 1) % n === s2) {
        sharedIdx = s2;
        forwardOrder = true;
      } else if ((s2 + 1) % n === s1) {
        sharedIdx = s1;
        forwardOrder = false;
      }

      if (sharedIdx !== -1) {
        const ptsToInsert = forwardOrder ? res.connectPts : [...res.connectPts].reverse();
        const newPts: Point2D[] = [];
        for (let i = 0; i < n; i++) {
          if (i === sharedIdx) {
            newPts.push(...ptsToInsert.map(p => ({ ...p })));
          } else {
            newPts.push({ ...oldPts[i] });
          }
        }

        const cmd: Command = {
          description: tr('Zaokrąglenie/Fazowanie narożnika polilinii', 'Fillet/Chamfer polyline corner'),
          execute: () => {
            poly.points = newPts.map(p => ({ ...p }));
            context.doc.notifyChange();
          },
          undo: () => {
            poly.points = oldPts.map(p => ({ ...p }));
            context.doc.notifyChange();
          },
        };
        context.history.execute(cmd);
        return;
      }
    }

    // Case 2: Two separate LineEntities
    if (e1.entity.type === 'line' && e2.entity.type === 'line') {
      const l1 = e1.entity;
      const l2 = e2.entity;
      const old1 = { x1: l1.x1, y1: l1.y1, x2: l1.x2, y2: l1.y2 };
      const old2 = { x1: l2.x1, y1: l2.y1, x2: l2.x2, y2: l2.y2 };

      let bridgeEntity: CadEntity | null = null;
      if (res.connectPts.length === 2) {
        // Chamfer line
        const chLine: LineEntity = {
          id: `chamfer_${Date.now()}`,
          type: 'line',
          layerId: l1.layerId,
          color: l1.color,
          lineType: l1.lineType,
          selected: false,
          x1: res.connectPts[0].x,
          y1: res.connectPts[0].y,
          x2: res.connectPts[1].x,
          y2: res.connectPts[1].y,
        };
        bridgeEntity = chLine;
      } else if (res.connectPts.length > 2) {
        // Fillet arc polyline
        const arcPoly: PolylineEntity = {
          id: `fillet_${Date.now()}`,
          type: 'polyline',
          layerId: l1.layerId,
          color: l1.color,
          lineType: l1.lineType,
          selected: false,
          closed: false,
          points: res.connectPts.map(p => ({ ...p })),
        };
        bridgeEntity = arcPoly;
      }

      const cmd: Command = {
        description: tr('Zaokrąglenie/Fazowanie linii', 'Fillet/Chamfer lines'),
        execute: () => {
          l1.x1 = res.keepEnd1.x;
          l1.y1 = res.keepEnd1.y;
          l1.x2 = res.t1.x;
          l1.y2 = res.t1.y;

          l2.x1 = res.keepEnd2.x;
          l2.y1 = res.keepEnd2.y;
          l2.x2 = res.t2.x;
          l2.y2 = res.t2.y;

          if (bridgeEntity) context.doc.addEntity(bridgeEntity);
          context.doc.notifyChange();
        },
        undo: () => {
          l1.x1 = old1.x1;
          l1.y1 = old1.y1;
          l1.x2 = old1.x2;
          l1.y2 = old1.y2;

          l2.x1 = old2.x1;
          l2.y1 = old2.y1;
          l2.x2 = old2.x2;
          l2.y2 = old2.y2;

          if (bridgeEntity) context.doc.removeEntity(bridgeEntity.id);
          context.doc.notifyChange();
        },
      };
      context.history.execute(cmd);
    }
  }

  getPreview(): RenderPreview | null {
    if (!this.firstEdge) {
      if (!this.hoverEdge) return null;
      return {
        type: 'line',
        data: { p1: this.hoverEdge.p1, p2: this.hoverEdge.p2 },
      };
    }

    const previewEntities: CadEntity[] = [
      {
        id: '__preview_e1',
        type: 'line',
        layerId: '0',
        selected: false,
        x1: this.firstEdge.p1.x,
        y1: this.firstEdge.p1.y,
        x2: this.firstEdge.p2.x,
        y2: this.firstEdge.p2.y,
      },
    ];

    if (this.hoverEdge) {
      const res = this.computeCornerGeometry(this.firstEdge, this.hoverEdge);
      if (res && res.connectPts.length >= 2) {
        previewEntities.push({
          id: '__preview_corner',
          type: 'polyline',
          layerId: '0',
          selected: false,
          closed: false,
          points: res.connectPts,
        });
      }
    }

    return {
      type: 'ghost',
      data: {
        entities: previewEntities,
        label:
          this.mode === 'fillet'
            ? `R = ${this.radiusOrDist}`
            : this.mode === 'chamfer'
            ? `D = ${this.radiusOrDist}`
            : 'R = 0',
      },
    };
  }
}


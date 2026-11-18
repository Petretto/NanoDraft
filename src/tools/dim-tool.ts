import { BaseTool, ToolContext } from './base-tool';
import { Point2D, SnapPoint, DimensionEntity, CircleEntity } from '../types/cad';
import { VectorMath } from '../math/vector';
import { Geometry, Segment } from '../math/geometry';
import { RenderPreview } from '../engine/renderer';
import { Command } from '../model/history';
import { i18n, tr } from '../i18n/lang';

export type DimToolMode = 'auto' | 'linear' | 'diameter' | 'radius' | 'angular' | 'arc-length';

interface ActiveArcInfo {
  center: Point2D;
  p1: Point2D;
  p2: Point2D;
  arcMidPt: Point2D;
  sourceRadius: number;
  entityId?: string;
}

export class DimTool extends BaseTool {
  readonly id = 'dimension';
  readonly name = 'Wymiar';
  readonly shortcut = 'D';

  private mode: DimToolMode = 'auto';
  private modeBarEl: HTMLDivElement | null = null;
  private lastContext: ToolContext | null = null;

  constructor() {
    super();
    i18n.onChange(() => {
      if (this.modeBarEl && this.modeBarEl.style.display !== 'none' && this.lastContext) {
        this.ensureModeBar(this.lastContext);
        this.updateInitialHint(this.lastContext);
      }
    });
  }

  // Linear state
  private p1: Point2D | null = null;
  private p2: Point2D | null = null;
  private firstSegment: Segment | null = null;

  // Circle (Radius / Diameter) state
  private activeCircle: CircleEntity | null = null;
  private circleDimSubType: 'diameter' | 'radius' = 'diameter';

  // Angular state
  private angleLine1: Segment | null = null;
  private angleLine2: Segment | null = null;
  private angleVertex: Point2D | null = null;

  // Arc-length state
  private activeArc: ActiveArcInfo | null = null;

  private currentPt: Point2D | null = null;

  setMode(newMode: DimToolMode, context: ToolContext) {
    this.mode = newMode;
    if (newMode === 'diameter') this.circleDimSubType = 'diameter';
    if (newMode === 'radius') this.circleDimSubType = 'radius';

    // If user toggles between diameter and radius while already previewing a circle, keep the active circle!
    if ((newMode === 'diameter' || newMode === 'radius') && this.activeCircle) {
      this.updateModeBarUI();
      context.setHint(
        `WYMIAR ${newMode === 'diameter' ? 'ŚREDNICY (Ø)' : 'PROMIENIA (R)'}: Przesuń kursor pod żądanym kątem i kliknij, aby wstawić wymiar ([R] Promień / [S] Średnica)`
      );
      context.requestRender();
      return;
    }

    this.resetStepState(context);
    this.updateModeBarUI();
    this.updateInitialHint(context);
    context.requestRender();
  }

  getBasePoint(): Point2D | null {
    return this.p1 && !this.p2 ? this.p1 : null;
  }

  activate(context: ToolContext) {
    this.lastContext = context;
    this.resetStepState(context);
    // Auto-switch to "dimensions" layer
    if (context.doc.layers.some(l => l.id === 'dimensions')) {
      context.doc.activeLayerId = 'dimensions';
      context.doc.notifyChange();
    }
    this.ensureModeBar(context);
    this.updateModeBarUI();
    this.updateInitialHint(context);
  }

  deactivate(context: ToolContext) {
    this.resetStepState(context);
    if (this.modeBarEl) {
      this.modeBarEl.style.display = 'none';
    }
    context.setHint('');
  }

  cancel(context: ToolContext) {
    this.resetStepState(context);
    this.updateInitialHint(context);
    context.requestRender();
  }

  private resetStepState(context: ToolContext) {
    this.p1 = null;
    this.p2 = null;
    this.firstSegment = null;
    this.activeCircle = null;
    this.angleLine1 = null;
    this.angleLine2 = null;
    this.angleVertex = null;
    this.activeArc = null;
    this.currentPt = null;
    context.hud.hide();
  }

  private ensureModeBar(context: ToolContext) {
    if (!this.modeBarEl) {
      const viewport = document.querySelector('.cad-viewport-container') as HTMLElement;
      if (!viewport) return;
      this.modeBarEl = document.createElement('div');
      this.modeBarEl.className = 'cad-dim-mode-bar';
      this.modeBarEl.addEventListener('mousedown', (e) => e.stopPropagation());
      viewport.appendChild(this.modeBarEl);
    }
    this.modeBarEl.style.display = 'flex';
    const modes: { id: DimToolMode; label: string; key: string; title: string }[] = [
      { id: 'auto', label: tr('✨ Inteligentny', '✨ Smart (Auto)'), key: '1', title: tr('Automatycznie rozpoznaje okręgi (Ø/R), odcinki i punkty', 'Auto-detects circles (Ø/R), segments and points') },
      { id: 'linear', label: tr('📏 Liniowy', '📏 Linear'), key: '2', title: tr('Wymiar liniowy / wyrównany pomiędzy 2 punktami', 'Linear / aligned dimension between 2 points') },
      { id: 'diameter', label: tr('⌀ Średnica (Ø)', '⌀ Diameter (Ø)'), key: '3', title: tr('Wymiar średnicy okręgu (Ø)', 'Circle diameter dimension (Ø)') },
      { id: 'radius', label: tr('◜ Promień (R)', '◜ Radius (R)'), key: '4', title: tr('Wymiar promienia okręgu (R)', 'Circle radius dimension (R)') },
      { id: 'angular', label: tr('∠ Kątowy (°)', '∠ Angular (°)'), key: '5', title: tr('Wymiar kąta pomiędzy dwiema liniami (°)', 'Angle dimension between two lines (°)') },
      { id: 'arc-length', label: tr('⌒ Długość łuku', '⌒ Arc Length'), key: '6', title: tr('Wymiar długości łuku kołowego (⌒)', 'Circular arc length dimension (⌒)') },
    ];

    this.modeBarEl.innerHTML = `
      <span class="dim-bar-title">${tr('Tryb wymiaru:', 'Dim Mode:')}</span>
      ${modes
        .map(
          m => `
        <button class="dim-mode-btn ${this.mode === m.id ? 'active' : ''}" data-mode="${m.id}" title="${m.title} [${m.key}]">
          ${m.label}
        </button>
      `
        )
        .join('')}
    `;

    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = (btn as HTMLElement).dataset.mode as DimToolMode;
        this.setMode(m, context);
      });
    });
  }

  private updateModeBarUI() {
    if (!this.modeBarEl) return;
    this.modeBarEl.querySelectorAll('.dim-mode-btn').forEach(btn => {
      const m = (btn as HTMLElement).dataset.mode;
      btn.classList.toggle('active', m === this.mode);
    });
  }

  private updateInitialHint(context: ToolContext) {
    switch (this.mode) {
      case 'auto':
        context.setHint(
          tr(
            'WYMIAR INTELIGENTNY: Kliknij obwód okręgu (dla Ø / R) LUB wskaż 1. punkt na obiekcie (dla wymiaru liniowego)',
            'SMART DIMENSION: Click circle rim (for Ø / R) OR click 1st point on object (for linear dimension)'
          )
        );
        break;
      case 'linear':
        context.setHint(
          tr(
            'WYMIAR LINIOWY: Wskaż 1. punkt na obiekcie (lub kliknij odcinek i naciśnij Enter)',
            'LINEAR DIMENSION: Click 1st point on object (or click a segment and press Enter)'
          )
        );
        break;
      case 'diameter':
        context.setHint(
          tr(
            'WYMIAR ŚREDNICY (Ø): Kliknij na dowolny okrąg lub łuk (np. fasolkę, zaokrąglenie)',
            'DIAMETER DIMENSION (Ø): Click on any circle or arc (e.g. slot, fillet)'
          )
        );
        break;
      case 'radius':
        context.setHint(
          tr(
            'WYMIAR PROMIENIA (R): Kliknij na dowolny okrąg lub łuk (np. fasolkę, zaokrąglenie)',
            'RADIUS DIMENSION (R): Click on any circle or arc (e.g. slot, fillet)'
          )
        );
        break;
      case 'angular':
        context.setHint(
          tr(
            'WYMIAR KĄTOWY (°): Kliknij pierwszą linię (ramię kąta)',
            'ANGULAR DIMENSION (°): Click the first line (angle ray)'
          )
        );
        break;
      case 'arc-length':
        context.setHint(
          tr(
            'WYMIAR DŁUGOŚCI ŁUKU (⌒): Kliknij na łuk (narysowany narzędziem Łuk, Zaokrąglij lub powstały z przycięcia okręgu)',
            'ARC LENGTH DIMENSION (⌒): Click on an arc (drawn with Arc, Fillet, or trimmed from a circle)'
          )
        );
        break;
    }
  }

  onMouseDown(e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    if (e.button !== 0) return;

    // 0. Active Arc Length Dimensioning (Step 2: place concentric arc dimension)
    if (this.activeArc) {
      const pt = snapPt ? snapPt.point : worldPt;
      const dimRadius = Math.max(VectorMath.distance(this.activeArc.center, pt), 1);
      this.commitArcLengthDimension(this.activeArc, dimRadius, context);
      this.cancel(context);
      return;
    }

    if (this.mode === 'arc-length') {
      const arcInfo = this.findCircularArcAt(worldPt, context);
      if (!arcInfo) {
        context.setHint(
          tr(
            'WYMIAR DŁUGOŚCI ŁUKU (⌒): Najedź i kliknij na łuk kołowy (lub przycięty okrąg)!',
            'ARC LENGTH DIMENSION (⌒): Hover and click on a circular arc (or trimmed circle)!'
          )
        );
        return;
      }
      this.activeArc = arcInfo;
      this.currentPt = { ...worldPt };
      context.setHint(
        tr(
          'WYMIAR DŁUGOŚCI ŁUKU (⌒): Przesuń kursor, aby odsunąć łuk wymiarowy, i kliknij, aby zatwierdzić',
          'ARC LENGTH DIMENSION (⌒): Move cursor to offset the dimension arc and click to place'
        )
      );
      context.requestRender();
      return;
    }

    // 1. Dedicated or active Circle Dimensioning (Diameter / Radius)
    if (this.activeCircle) {
      const pt = snapPt ? snapPt.point : worldPt;
      this.commitCircleDimension(this.activeCircle, pt, this.circleDimSubType, context);
      this.cancel(context);
      return;
    }

    if (this.mode === 'diameter' || this.mode === 'radius') {
      const circle = this.findCircleAt(worldPt, snapPt, context);
      if (!circle) {
        context.setHint(
          tr(
            'WYMIAR KOŁA / ŁUKU: Najedź i kliknij na obwód okręgu, półokrąg fasolki lub łuk!',
            'CIRCLE / ARC DIMENSION: Hover and click on a circle rim, slot semicircle or arc!'
          )
        );
        return;
      }
      this.activeCircle = circle;
      this.circleDimSubType = this.mode;
      this.currentPt = { ...worldPt };
      context.setHint(
        `WYMIAR ${this.circleDimSubType === 'diameter' ? 'ŚREDNICY (Ø)' : 'PROMIENIA (R)'}: Przesuń mysz (wewnątrz lub na zewnątrz) i kliknij, aby wstawić ([R] Promień / [S] Średnica)`
      );
      context.requestRender();
      return;
    }

    // 2. Angular Dimensioning Mode
    if (this.mode === 'angular') {
      this.handleAngularMouseDown(worldPt, snapPt, context);
      return;
    }

    // 3. Auto (Smart) or Linear Mode
    if (!this.p1) {
      // In Auto mode, check if the user clicked on a circle's circumference or a circular arc (including slot / fillet arcs)!
      if (this.mode === 'auto') {
        const rimCircle = this.findCircleByRimClick(worldPt, snapPt, context);
        if (rimCircle && (!snapPt || snapPt.type !== 'center')) {
          this.activeCircle = rimCircle;
          this.circleDimSubType = 'diameter';
          this.currentPt = { ...worldPt };
          context.setHint(
            'WYMIAR OKRĘGU: Przesuń kursor i kliknij, aby wstawić wymiar Ø/R | Naciśnij [R] dla Promienia lub [S] dla Średnicy'
          );
          context.requestRender();
          return;
        }
        const arcHit = this.findCircularArcAt(snapPt && snapPt.type !== 'grid' ? snapPt.point : worldPt, context);
        const arcBoundaryTol = context.transform.screenDistToWorld(4);
        const clickTestPt = snapPt && snapPt.type !== 'grid' ? snapPt.point : worldPt;
        const atArcBoundary =
          !!arcHit &&
          (VectorMath.distance(clickTestPt, arcHit.p1) <= arcBoundaryTol ||
            VectorMath.distance(clickTestPt, arcHit.p2) <= arcBoundaryTol);
        if (arcHit && !atArcBoundary) {
          // Clicking an arc (Slot semicircle, Fillet corner, Arc) in Smart/Auto mode defaults to Radius (R), switchable to Ø with [S]
          this.activeCircle = {
            id: arcHit.entityId || 'arc_virtual',
            type: 'circle',
            layerId: 'dimensions',
            cx: arcHit.center.x,
            cy: arcHit.center.y,
            radius: arcHit.sourceRadius,
          };
          this.circleDimSubType = 'radius';
          this.currentPt = { ...worldPt };
          context.setHint(
            tr(
              'WYMIAR PROMIENIA ŁUKU (R): Przesuń kursor i kliknij, aby wstawić promień R ([S] przełącza na Ø, tryb [6] mierzy długość łuku ⌒)',
              'ARC RADIUS DIMENSION (R): Move cursor and click to place radius R ([S] switches to Ø, mode [6] measures arc length ⌒)'
            )
          );
          context.requestRender();
          return;
        }
      }

      // Otherwise, require a point on an object (OSNAP or segment hit)
      const hitSeg = this.findSegmentAt(worldPt, context);
      if ((!snapPt || snapPt.type === 'grid') && !hitSeg) {
        context.setHint(
          'WYMIAR: Najedź na obiekt (wierzchołek, środek, przecięcie lub krawędź) — nie można wymiarować pustego pola!'
        );
        return;
      }

      const pt = snapPt && snapPt.type !== 'grid' ? snapPt.point : worldPt;
      this.p1 = { ...pt };
      this.firstSegment = hitSeg;
      this.currentPt = { ...pt };

      if (hitSeg) {
        context.setHint(
          'WYMIAR: Wskaż 2. punkt na obiekcie | LUB naciśnij [Enter / Spacja], aby zwymiarować cały kliknięty odcinek!'
        );
      } else {
        context.setHint('WYMIAR: Wskaż drugi punkt na obiekcie (z przyciąganiem OSNAP)');
      }
    } else if (!this.p2) {
      const hitSeg = this.findSegmentAt(worldPt, context);
      if ((!snapPt || snapPt.type === 'grid') && !hitSeg) {
        context.setHint('WYMIAR: Wskaż drugi punkt NA OBIEKCIE (użyj przyciągania OSNAP)!');
        return;
      }
      const pt = snapPt && snapPt.type !== 'grid' ? snapPt.point : worldPt;
      if (VectorMath.distance(this.p1, pt) < 1e-4) {
        context.setHint('WYMIAR: Drugi punkt nie może pokrywać się z pierwszym!');
        return;
      }
      this.p2 = { ...pt };
      this.openLinearOffsetHud(worldPt, context);
    } else {
      // Step 3: Offset determined by mouse click
      const pt = snapPt ? snapPt.point : worldPt;
      const offset = this.computeLinearOffset(this.p1, this.p2, pt, context);
      this.createLinearDimension(this.p1, this.p2, offset, context);
      this.cancel(context);
    }
    context.requestRender();
  }

  private handleAngularMouseDown(worldPt: Point2D, _snapPt: SnapPoint | null, context: ToolContext) {
    if (!this.angleLine1) {
      const seg1 = this.findSegmentAt(worldPt, context);
      if (!seg1) {
        context.setHint('WYMIAR KĄTOWY: Kliknij bezpośrednio na pierwszą linię lub bok wielokąta!');
        return;
      }
      this.angleLine1 = seg1;
      this.currentPt = { ...worldPt };
      context.setHint('WYMIAR KĄTOWY: Teraz kliknij na drugą linię (nierównoległą do pierwszej)');
      context.requestRender();
      return;
    }

    if (!this.angleLine2) {
      const seg2 = this.findSegmentAt(worldPt, context);
      if (!seg2) {
        context.setHint('WYMIAR KĄTOWY: Kliknij bezpośrednio na drugą linię!');
        return;
      }
      const vertex = Geometry.intersectInfiniteLines(
        this.angleLine1.a,
        this.angleLine1.b,
        seg2.a,
        seg2.b
      );
      if (!vertex) {
        context.setHint('WYMIAR KĄTOWY: Wybrane linie są równoległe — wybierz linię przecinającą!');
        return;
      }
      this.angleLine2 = seg2;
      this.angleVertex = vertex;
      this.currentPt = { ...worldPt };
      context.setHint('WYMIAR KĄTOWY: Przesuń kursor w sektor kąta, aby dobrać promień łuku, i kliknij');
      context.requestRender();
      return;
    }

    // Step 3: Commit angular dimension
    if (this.angleVertex && this.angleLine1 && this.angleLine2) {
      const { ray1Pt, ray2Pt, arcRadius } = this.computeAngularRays(
        this.angleVertex,
        this.angleLine1,
        this.angleLine2,
        worldPt
      );
      this.createAngularDimension(this.angleVertex, ray1Pt, ray2Pt, arcRadius, context);
      this.cancel(context);
    }
  }

  onMouseMove(_e: MouseEvent, worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext) {
    const pt = snapPt ? snapPt.point : worldPt;
    this.currentPt = { ...pt };

    if (this.activeCircle || this.activeArc) {
      context.requestRender();
      return;
    }

    if (this.mode === 'angular' && this.angleLine1) {
      context.requestRender();
      return;
    }

    if (this.p1 && this.p2) {
      const offset = this.computeLinearOffset(this.p1, this.p2, pt, context);
      context.hud.updateLiveValues(VectorMath.round(offset, 2));
      const screenPt = context.transform.worldToScreen(pt);
      context.hud.updatePosition(screenPt);
      context.requestRender();
    } else if (this.p1) {
      context.requestRender();
    }
  }

  onMouseUp() {}

  onKeyDown(e: KeyboardEvent, context: ToolContext): boolean {
    if (e.key === 'Escape') {
      this.cancel(context);
      return true;
    }

    // Mode hotkeys 1..6 when not typing in HUD
    if (!context.hud.isActive()) {
      if (e.key === '1') { this.setMode('auto', context); return true; }
      if (e.key === '2') { this.setMode('linear', context); return true; }
      if (e.key === '3') { this.setMode('diameter', context); return true; }
      if (e.key === '4') { this.setMode('radius', context); return true; }
      if (e.key === '5') { this.setMode('angular', context); return true; }
      if (e.key === '6') { this.setMode('arc-length', context); return true; }
    }

    // When a circle is active, R switches to Radius, S switches to Diameter
    if (this.activeCircle) {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        this.circleDimSubType = 'radius';
        context.setHint('WYMIAR PROMIENIA (R): Kliknij, aby zatwierdzić pozycję wymiaru R ([S] przełącza na Średnicę Ø)');
        context.requestRender();
        return true;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.circleDimSubType = 'diameter';
        context.setHint('WYMIAR ŚREDNICY (Ø): Kliknij, aby zatwierdzić pozycję wymiaru Ø ([R] przełącza na Promień R)');
        context.requestRender();
        return true;
      }
    }

    // Quick whole-segment dimensioning: if user clicked a line segment in Step 1 and presses Enter or Space
    if (this.p1 && !this.p2 && this.firstSegment && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.p1 = { ...this.firstSegment.a };
      this.p2 = { ...this.firstSegment.b };
      this.openLinearOffsetHud(this.currentPt || this.p2, context);
      context.requestRender();
      return true;
    }

    return false;
  }

  private openLinearOffsetHud(worldPt: Point2D, context: ToolContext) {
    const defaultOffset = context.doc.unit === 'm' ? 0.6 : context.doc.unit === 'cm' ? 2 : context.doc.unit === 'in' ? 0.5 : 15;
    context.setHint('WYMIAR: Przesuń mysz i kliknij, aby ustalić odsunięcie linii wymiarowej (lub wpisz w HUD [Enter])');
    const screenPt = context.transform.worldToScreen(worldPt);
    context.hud.showSingleField(
      screenPt,
      'Odsunięcie:',
      defaultOffset,
      (offsetVal) => {
        if (this.p1 && this.p2) {
          this.createLinearDimension(this.p1, this.p2, offsetVal || defaultOffset, context);
          this.cancel(context);
        }
      },
      () => this.cancel(context)
    );
  }

  private computeLinearOffset(p1: Point2D, p2: Point2D, cursor: Point2D, context: ToolContext): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return context.doc.unit === 'm' ? 0.5 : 15;
    const nx = -dy / len;
    const ny = dx / len;
    const raw = (cursor.x - p1.x) * nx + (cursor.y - p1.y) * ny;
    if (Math.abs(raw) < 1e-4) {
      return context.doc.unit === 'm' ? 0.5 : 15;
    }
    return raw;
  }

  private findCircleByRimClick(worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext): CircleEntity | null {
    const tol = context.transform.screenDistToWorld(10);
    const testPt = snapPt ? snapPt.point : worldPt;
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      if (ent.type === 'circle') {
        const dRim = Math.abs(VectorMath.distance(testPt, { x: ent.cx, y: ent.cy }) - ent.radius);
        if (dRim <= tol) return ent;
      }
    }
    return null;
  }

  private findCircleAt(worldPt: Point2D, snapPt: SnapPoint | null, context: ToolContext): CircleEntity | null {
    const rim = this.findCircleByRimClick(worldPt, snapPt, context);
    if (rim) return rim;
    const tol = context.transform.screenDistToWorld(10);
    const testPt = snapPt ? snapPt.point : worldPt;
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      if (ent.type === 'circle') {
        const dCenter = VectorMath.distance(testPt, { x: ent.cx, y: ent.cy });
        if (dCenter <= tol || Math.abs(dCenter - ent.radius) <= tol) return ent;
      }
    }
    // Fallback: recognize circular arcs in polylines (Slot semicircles, Fillet corners, Arcs, trimmed circles)
    const arcHit = this.findCircularArcAt(testPt, context) || this.findCircularArcAt(worldPt, context);
    if (arcHit) {
      return {
        id: arcHit.entityId || 'arc_virtual',
        type: 'circle',
        layerId: 'dimensions',
        cx: arcHit.center.x,
        cy: arcHit.center.y,
        radius: arcHit.sourceRadius,
      };
    }
    return null;
  }

  private computeCircumcircle(
    p1: Point2D,
    p2: Point2D,
    p3: Point2D
  ): { cx: number; cy: number; r: number } | null {
    const denom = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    if (Math.abs(denom) < 1e-7) return null;
    const s1 = p1.x * p1.x + p1.y * p1.y;
    const s2 = p2.x * p2.x + p2.y * p2.y;
    const s3 = p3.x * p3.x + p3.y * p3.y;
    const cx = (s1 * (p2.y - p3.y) + s2 * (p3.y - p1.y) + s3 * (p1.y - p2.y)) / denom;
    const cy = (s1 * (p3.x - p2.x) + s2 * (p1.x - p3.x) + s3 * (p2.x - p1.x)) / denom;
    const r = Math.hypot(p1.x - cx, p1.y - cy);
    if (!isFinite(r) || r < 1e-4 || r > 1e7) return null;
    return { cx, cy, r };
  }

  /**
   * Detects circular arc geometry on both open arc polylines (ArcTool, trimmed circles)
   * and arc sub-paths inside closed or mixed polylines (Mounting Slots, Filleted rectangles).
   */
  private findCircularArcAt(worldPt: Point2D, context: ToolContext): ActiveArcInfo | null {
    const tol = context.transform.screenDistToWorld(10);

    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      if (ent.type !== 'polyline' || ent.points.length < 4) continue;
      const layer = context.doc.layers.find(l => l.id === ent.layerId);
      if (layer && !layer.visible) continue;

      const pts = ent.points;
      const n = pts.length;
      const segCount = ent.closed ? n : n - 1;

      // Find the closest hit segment on this polyline
      let hitSegIdx = -1;
      let hitSegDist = Infinity;
      for (let j = 0; j < segCount; j++) {
        const d = VectorMath.distanceToSegment(worldPt, pts[j], pts[(j + 1) % n]);
        if (d <= tol && d < hitSegDist) {
          hitSegDist = d;
          hitSegIdx = j;
        }
      }
      if (hitSegIdx < 0) continue;

      // Case A: Open polyline where the entire polyline is a single circular arc
      if (!ent.closed) {
        const p1 = pts[0];
        const arcMidPt = pts[Math.floor(n / 2)];
        const p2 = pts[n - 1];
        const circ = this.computeCircumcircle(p1, arcMidPt, p2);
        if (circ) {
          const rTol = Math.max(circ.r * 0.025, 0.05);
          let allOnArc = true;
          for (let k = 0; k < n; k++) {
            if (Math.abs(Math.hypot(pts[k].x - circ.cx, pts[k].y - circ.cy) - circ.r) > rTol) {
              allOnArc = false;
              break;
            }
          }
          if (allOnArc) {
            return {
              center: { x: circ.cx, y: circ.cy },
              p1: { ...p1 },
              p2: { ...p2 },
              arcMidPt: { ...arcMidPt },
              sourceRadius: VectorMath.round(circ.r, 3),
              entityId: ent.id,
            };
          }
        }
      }

      // Case B: Local circular arc sub-path inside a closed or mixed polyline (Slot semicircles, Filleted corners)
      const vertexAt = (idx: number): Point2D | null => {
        if (ent.closed) return pts[((idx % n) + n) % n];
        if (idx < 0 || idx >= n) return null;
        return pts[idx];
      };

      // Try local vertex triples around the clicked segment (hitSegIdx -> hitSegIdx + 1)
      const seedOffsets: [number, number, number][] = [
        [hitSegIdx - 1, hitSegIdx, hitSegIdx + 1],
        [hitSegIdx, hitSegIdx + 1, hitSegIdx + 2],
      ];

      let seedCirc: { cx: number; cy: number; r: number } | null = null;
      for (const [iA, iB, iC] of seedOffsets) {
        const pA = vertexAt(iA);
        const pB = vertexAt(iB);
        const pC = vertexAt(iC);
        if (!pA || !pB || !pC) continue;
        const l1 = VectorMath.distance(pA, pB);
        const l2 = VectorMath.distance(pB, pC);
        if (l1 < 1e-5 || l2 < 1e-5) continue;
        const ratio = l1 / l2;
        // Both adjacent edges must be comparable arc chords (reject straight slot wall + arc chord)
        if (ratio < 0.6 || ratio > 1.67) continue;

        const c = this.computeCircumcircle(pA, pB, pC);
        if (!c) continue;
        // Smooth arc criterion: chord <= 0.255 * R (<= 14.6 deg step; rejects regular polygons N<=24 which have >= 15 deg)
        if (l1 <= c.r * 0.255 && l2 <= c.r * 0.255) {
          seedCirc = c;
          break;
        }
      }

      if (!seedCirc) continue;

      // Expand backwards and forwards along the polyline while vertices stay on the same smooth arc
      const rTol = Math.max(seedCirc.r * 0.035, 0.06);
      const maxChord = seedCirc.r * 0.28;
      let startOff = 0;
      let endOff = 1;

      while (endOff - startOff < n - 1) {
        const curr = vertexAt(hitSegIdx + startOff);
        const prev = vertexAt(hitSegIdx + startOff - 1);
        if (!curr || !prev) break;
        if (VectorMath.distance(curr, prev) > maxChord) break;
        if (Math.abs(Math.hypot(prev.x - seedCirc.cx, prev.y - seedCirc.cy) - seedCirc.r) > rTol) break;
        startOff--;
      }

      while (endOff - startOff < n - 1) {
        const curr = vertexAt(hitSegIdx + endOff);
        const next = vertexAt(hitSegIdx + endOff + 1);
        if (!curr || !next) break;
        if (VectorMath.distance(curr, next) > maxChord) break;
        if (Math.abs(Math.hypot(next.x - seedCirc.cx, next.y - seedCirc.cy) - seedCirc.r) > rTol) break;
        endOff++;
      }

      const arcVertCount = endOff - startOff + 1;
      if (arcVertCount < 4) continue;

      const arcP1 = vertexAt(hitSegIdx + startOff)!;
      const arcMidPt = vertexAt(hitSegIdx + Math.floor((startOff + endOff) / 2))!;
      const arcP2 = vertexAt(hitSegIdx + endOff)!;

      // Recompute high-precision center & radius using the 3 widely-spaced points of the full arc
      const refined = this.computeCircumcircle(arcP1, arcMidPt, arcP2) || seedCirc;
      const cleanR =
        Math.abs(refined.r - Math.round(refined.r * 100) / 100) < 0.004
          ? Math.round(refined.r * 100) / 100
          : VectorMath.round(refined.r, 3);

      return {
        center: {
          x: VectorMath.round(refined.cx, 3),
          y: VectorMath.round(refined.cy, 3),
        },
        p1: { ...arcP1 },
        p2: { ...arcP2 },
        arcMidPt: { ...arcMidPt },
        sourceRadius: cleanR,
        entityId: ent.id,
      };
    }

    return null;
  }

  private commitArcLengthDimension(arc: ActiveArcInfo, dimRadius: number, context: ToolContext) {
    const { arcLength } = Geometry.computeArcSweep(arc.center, arc.p1, arc.p2, arc.arcMidPt);
    const dim: DimensionEntity = {
      id: 'dim_arc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'dimension',
      layerId: 'dimensions',
      dimType: 'arc-length',
      p1: { ...arc.p1 },
      p2: { ...arc.p2 },
      center: { ...arc.center },
      arcMidPt: { ...arc.arcMidPt },
      radius: dimRadius,
      offset: dimRadius - arc.sourceRadius,
      textHeight: this.getDefaultTextHeight(context),
      attachedEntityIds: arc.entityId ? [arc.entityId] : undefined,
    };

    const cmd: Command = {
      description: tr(
        `Dodaj Wymiar Długości Łuku (⌒ ${VectorMath.round(arcLength)} ${context.doc.unit})`,
        `Add Arc Length Dimension (⌒ ${VectorMath.round(arcLength)} ${context.doc.unit})`
      ),
      execute: () => context.doc.addEntity(dim),
      undo: () => context.doc.removeEntity(dim.id),
    };
    context.history.execute(cmd);
  }

  private findSegmentAt(worldPt: Point2D, context: ToolContext): Segment | null {
    const tol = context.transform.screenDistToWorld(9);
    for (let i = context.doc.entities.length - 1; i >= 0; i--) {
      const ent = context.doc.entities[i];
      if (ent.type === 'line') {
        const a = { x: ent.x1, y: ent.y1 };
        const b = { x: ent.x2, y: ent.y2 };
        if (VectorMath.distanceToSegment(worldPt, a, b) <= tol) {
          return { a, b };
        }
      } else if (ent.type === 'polyline') {
        const pts = ent.points;
        const count = ent.closed ? pts.length : pts.length - 1;
        for (let j = 0; j < count; j++) {
          const a = pts[j];
          const b = pts[(j + 1) % pts.length];
          if (VectorMath.distanceToSegment(worldPt, a, b) <= tol) {
            return { a, b };
          }
        }
      }
    }
    return null;
  }

  private computeAngularRays(
    vertex: Point2D,
    seg1: Segment,
    seg2: Segment,
    cursor: Point2D
  ): { ray1Pt: Point2D; ray2Pt: Point2D; arcRadius: number } {
    const arcRadius = Math.max(VectorMath.distance(vertex, cursor), 0.2);

    // Choose direction along seg1 and seg2 that points into the quadrant of the cursor
    const chooseRayPt = (seg: Segment): Point2D => {
      const dA = VectorMath.distance(vertex, seg.a);
      const dB = VectorMath.distance(vertex, seg.b);
      const u1 = dA > 1e-4 ? { x: (seg.a.x - vertex.x) / dA, y: (seg.a.y - vertex.y) / dA } : null;
      const u2 = dB > 1e-4 ? { x: (seg.b.x - vertex.x) / dB, y: (seg.b.y - vertex.y) / dB } : null;
      const dir = u1 && u2
        ? {
            x: (cursor.x - vertex.x) * u1.x + (cursor.y - vertex.y) * u1.y >= 0 ? u1.x : u2.x,
            y: (cursor.x - vertex.x) * u1.x + (cursor.y - vertex.y) * u1.y >= 0 ? u1.y : u2.y,
          }
        : u1 || u2 || { x: 1, y: 0 };
      const dot = (cursor.x - vertex.x) * dir.x + (cursor.y - vertex.y) * dir.y;
      const sign = dot >= 0 ? 1 : -1;
      return {
        x: vertex.x + dir.x * sign * Math.min(arcRadius * 0.6, Math.max(dA, dB, arcRadius * 0.4)),
        y: vertex.y + dir.y * sign * Math.min(arcRadius * 0.6, Math.max(dA, dB, arcRadius * 0.4)),
      };
    };

    return {
      ray1Pt: chooseRayPt(seg1),
      ray2Pt: chooseRayPt(seg2),
      arcRadius,
    };
  }

  private getDefaultTextHeight(context: ToolContext): number {
    return context.doc.unit === 'm' ? 0.28 : context.doc.unit === 'cm' ? 0.35 : context.doc.unit === 'in' ? 0.14 : 3.5;
  }

  private createLinearDimension(p1: Point2D, p2: Point2D, offset: number, context: ToolContext) {
    const dim: DimensionEntity = {
      id: 'dim_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'dimension',
      layerId: 'dimensions',
      dimType: 'aligned',
      p1: { ...p1 },
      p2: { ...p2 },
      offset,
      textHeight: this.getDefaultTextHeight(context),
    };

    const cmd: Command = {
      description: `Dodaj Wymiar Liniowy (${VectorMath.round(VectorMath.distance(p1, p2))} ${context.doc.unit})`,
      execute: () => context.doc.addEntity(dim),
      undo: () => context.doc.removeEntity(dim.id),
    };
    context.history.execute(cmd);
  }

  private commitCircleDimension(
    circle: CircleEntity,
    leaderPt: Point2D,
    dimType: 'diameter' | 'radius',
    context: ToolContext
  ) {
    const center = { x: circle.cx, y: circle.cy };
    const dim: DimensionEntity = {
      id: 'dim_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'dimension',
      layerId: 'dimensions',
      dimType,
      p1: { ...center },
      p2: { ...leaderPt },
      center: { ...center },
      radius: circle.radius,
      offset: VectorMath.distance(center, leaderPt),
      textHeight: this.getDefaultTextHeight(context),
      attachedEntityIds: [circle.id],
    };

    const label =
      dimType === 'diameter'
        ? `Ø${VectorMath.round(circle.radius * 2)} ${context.doc.unit}`
        : `R${VectorMath.round(circle.radius)} ${context.doc.unit}`;

    const cmd: Command = {
      description: `Dodaj Wymiar Okręgu (${label})`,
      execute: () => context.doc.addEntity(dim),
      undo: () => context.doc.removeEntity(dim.id),
    };
    context.history.execute(cmd);
  }

  private createAngularDimension(
    vertex: Point2D,
    ray1Pt: Point2D,
    ray2Pt: Point2D,
    arcRadius: number,
    context: ToolContext
  ) {
    const dim: DimensionEntity = {
      id: 'dim_ang_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'dimension',
      layerId: 'dimensions',
      dimType: 'angular',
      p1: { ...ray1Pt },
      p2: { ...ray2Pt },
      center: { ...vertex },
      radius: arcRadius,
      offset: arcRadius,
      textHeight: this.getDefaultTextHeight(context),
    };

    const cmd: Command = {
      description: `Dodaj Wymiar Kątowy`,
      execute: () => context.doc.addEntity(dim),
      undo: () => context.doc.removeEntity(dim.id),
    };
    context.history.execute(cmd);
  }

  getPreview(): RenderPreview | null {
    // 0. Live preview of Arc Length Dimension (⌒)
    if (this.activeArc && this.currentPt) {
      const dimRadius = Math.max(VectorMath.distance(this.activeArc.center, this.currentPt), 1);
      const previewDim: DimensionEntity = {
        id: 'preview_dim_arclen',
        type: 'dimension',
        layerId: 'dimensions',
        dimType: 'arc-length',
        p1: this.activeArc.p1,
        p2: this.activeArc.p2,
        center: this.activeArc.center,
        arcMidPt: this.activeArc.arcMidPt,
        radius: dimRadius,
        offset: dimRadius - this.activeArc.sourceRadius,
      };
      return {
        type: 'ghost',
        data: { entities: [previewDim] },
      };
    }

    // 1. Live preview of Circle Dimension (Diameter Ø or Radius R)
    if (this.activeCircle && this.currentPt) {
      const center = { x: this.activeCircle.cx, y: this.activeCircle.cy };
      const previewDim: DimensionEntity = {
        id: 'preview_dim_circle',
        type: 'dimension',
        layerId: 'dimensions',
        dimType: this.circleDimSubType,
        p1: center,
        p2: this.currentPt,
        center,
        radius: this.activeCircle.radius,
        offset: VectorMath.distance(center, this.currentPt),
      };
      return {
        type: 'ghost',
        data: { entities: [previewDim] },
      };
    }

    // 2. Live preview of Angular Dimension (°)
    if (this.mode === 'angular' && this.angleVertex && this.angleLine1 && this.angleLine2 && this.currentPt) {
      const { ray1Pt, ray2Pt, arcRadius } = this.computeAngularRays(
        this.angleVertex,
        this.angleLine1,
        this.angleLine2,
        this.currentPt
      );
      const previewDim: DimensionEntity = {
        id: 'preview_dim_ang',
        type: 'dimension',
        layerId: 'dimensions',
        dimType: 'angular',
        p1: ray1Pt,
        p2: ray2Pt,
        center: this.angleVertex,
        radius: arcRadius,
        offset: arcRadius,
      };
      return {
        type: 'ghost',
        data: { entities: [previewDim] },
      };
    }

    // 3. Live preview of Linear Dimension (Step 3: choosing offset)
    if (this.p1 && this.p2 && this.currentPt) {
      const dx = this.p2.x - this.p1.x;
      const dy = this.p2.y - this.p1.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-6) {
        const nx = -dy / len;
        const ny = dx / len;
        const offset = (this.currentPt.x - this.p1.x) * nx + (this.currentPt.y - this.p1.y) * ny;
        const previewDim: DimensionEntity = {
          id: 'preview_dim_lin',
          type: 'dimension',
          layerId: 'dimensions',
          dimType: 'aligned',
          p1: this.p1,
          p2: this.p2,
          offset: offset || 1,
        };
        return {
          type: 'ghost',
          data: { entities: [previewDim] },
        };
      }
    } else if (this.p1 && this.currentPt) {
      return {
        type: 'line',
        data: { p1: this.p1, p2: this.currentPt },
      };
    }

    return null;
  }
}

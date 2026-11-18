import { CadEntity, Layer, LineEntity, UnitType, Point2D, DimensionEntity } from '../types/cad';
import { convertUnitScale } from '../math/transform';
import { VectorMath } from '../math/vector';
import { HistoryManager, Command } from './history';

export class CadDocument {
  public entities: CadEntity[] = [];
  public layers: Layer[] = [];
  public activeLayerId: string = '0';
  public unit: UnitType = 'mm';
  public selectedEntityIds: Set<string> = new Set();
  public isDirty: boolean = false;

  private changeListeners: (() => void)[] = [];

  constructor() {
    // Default CAD layers according to specification
    this.layers = [
      { id: '0', name: '0 (Szkic)', color: '#ffffff', lineWidth: 1.0, lineType: 'continuous', visible: true, locked: false },
      { id: 'elements', name: 'Elementy', color: '#4caf50', lineWidth: 2.0, lineType: 'continuous', visible: true, locked: false },
      { id: 'dimensions', name: 'Wymiary', color: '#00e5ff', lineWidth: 1.0, lineType: 'continuous', visible: true, locked: false },
      { id: 'axes', name: 'Osie', color: '#ff9800', lineWidth: 1.0, lineType: 'dashdot', visible: true, locked: false },
    ];
  }

  addChangeListener(listener: () => void) {
    this.changeListeners.push(listener);
  }

  notifyChange() {
    this.isDirty = true;
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  markClean() {
    this.isDirty = false;
  }

  resetToNew(unit: UnitType = 'mm') {
    this.entities = [];
    this.selectedEntityIds.clear();
    this.unit = unit;
    this.layers = [
      { id: '0', name: '0 (Szkic)', color: '#ffffff', lineWidth: 1.0, lineType: 'continuous', visible: true, locked: false },
      { id: 'elements', name: 'Elementy', color: '#4caf50', lineWidth: 2.0, lineType: 'continuous', visible: true, locked: false },
      { id: 'dimensions', name: 'Wymiary', color: '#00e5ff', lineWidth: 1.0, lineType: 'continuous', visible: true, locked: false },
      { id: 'axes', name: 'Osie', color: '#ff9800', lineWidth: 1.0, lineType: 'dashdot', visible: true, locked: false },
    ];
    this.activeLayerId = 'elements';
    this.notifyChange();
    this.isDirty = false;
  }

  addEntity(entity: CadEntity) {
    this.entities.push(entity);
    this.notifyChange();
  }

  removeEntity(id: string) {
    this.entities = this.entities.filter(e => e.id !== id);
    this.selectedEntityIds.delete(id);
    this.notifyChange();
  }

  getEntity(id: string): CadEntity | undefined {
    return this.entities.find(e => e.id === id);
  }

  clearSelection() {
    this.selectedEntityIds.clear();
    for (const ent of this.entities) {
      ent.selected = false;
    }
    this.notifyChange();
  }

  selectEntity(id: string, additive: boolean = false) {
    if (!additive) {
      this.clearSelection();
    }
    const ent = this.getEntity(id);
    if (!ent) return;

    if (ent.groupId) {
      const gid = ent.groupId;
      for (const e of this.entities) {
        if (e.groupId === gid) {
          this.selectedEntityIds.add(e.id);
          e.selected = true;
        }
      }
    } else {
      this.selectedEntityIds.add(id);
      ent.selected = true;
    }
    this.notifyChange();
  }

  deselectEntity(id: string) {
    const ent = this.getEntity(id);
    if (ent && ent.groupId) {
      const gid = ent.groupId;
      for (const e of this.entities) {
        if (e.groupId === gid) {
          this.selectedEntityIds.delete(e.id);
          e.selected = false;
        }
      }
    } else {
      this.selectedEntityIds.delete(id);
      if (ent) ent.selected = false;
    }
    this.notifyChange();
  }

  getSelectedEntities(): CadEntity[] {
    return this.entities.filter(e => this.selectedEntityIds.has(e.id));
  }

  deleteSelected() {
    if (this.selectedEntityIds.size === 0) return;
    this.entities = this.entities.filter(e => !this.selectedEntityIds.has(e.id));
    this.selectedEntityIds.clear();
    this.notifyChange();
  }

  /**
   * Groups currently selected entities so clicking any one selects all of them together.
   */
  groupSelected(history: HistoryManager, groupName?: string): boolean {
    const selected = this.getSelectedEntities();
    if (selected.length < 2) return false;

    const newGroupId = 'grp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const defaultName = groupName || `Grupa (${selected.length} el.)`;
    const prevGroups = selected.map(e => ({ id: e.id, groupId: e.groupId, groupName: e.groupName }));

    const cmd: Command = {
      description: `Połącz w grupę (${selected.length} obiektów)`,
      execute: () => {
        for (const e of selected) {
          e.groupId = newGroupId;
          e.groupName = defaultName;
        }
        this.notifyChange();
      },
      undo: () => {
        for (const pg of prevGroups) {
          const ent = this.getEntity(pg.id);
          if (ent) {
            ent.groupId = pg.groupId;
            ent.groupName = pg.groupName;
          }
        }
        this.notifyChange();
      },
    };
    history.execute(cmd);
    return true;
  }

  /**
   * Ungroups any grouped entities in the current selection.
   */
  ungroupSelected(history: HistoryManager): boolean {
    const selected = this.getSelectedEntities();
    const grouped = selected.filter(e => !!e.groupId);
    if (grouped.length === 0) return false;

    // Also include any other entities in the document that share a groupId with the selection
    const groupIds = new Set(grouped.map(e => e.groupId!));
    const allInGroups = this.entities.filter(e => e.groupId && groupIds.has(e.groupId));
    const prevGroups = allInGroups.map(e => ({ id: e.id, groupId: e.groupId, groupName: e.groupName }));

    const cmd: Command = {
      description: `Rozgrupuj (${allInGroups.length} obiektów)`,
      execute: () => {
        for (const e of allInGroups) {
          delete e.groupId;
          delete e.groupName;
        }
        this.notifyChange();
      },
      undo: () => {
        for (const pg of prevGroups) {
          const ent = this.getEntity(pg.id);
          if (ent) {
            ent.groupId = pg.groupId;
            ent.groupName = pg.groupName;
          }
        }
        this.notifyChange();
      },
    };
    history.execute(cmd);
    return true;
  }

  /**
   * Explodes selected polylines/rectangles into individual LineEntities (and ungroups grouped objects).
   */
  explodeSelected(history: HistoryManager): boolean {
    const selected = this.getSelectedEntities();
    if (selected.length === 0) return false;

    const polylines = selected.filter(e => e.type === 'polyline');
    const grouped = selected.filter(e => !!e.groupId);
    if (polylines.length === 0 && grouped.length === 0) return false;

    const createdLines: LineEntity[] = [];
    let seq = 1;
    for (const poly of polylines) {
      if (poly.type !== 'polyline') continue;
      const pts = poly.points;
      const segCount = poly.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < segCount; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        createdLines.push({
          id: `exp_line_${Date.now()}_${seq++}`,
          type: 'line',
          layerId: poly.layerId,
          color: poly.color,
          lineType: poly.lineType,
          lineWidth: poly.lineWidth,
          selected: true,
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
        });
      }
    }

    const prevGroups = selected.map(e => ({ id: e.id, groupId: e.groupId, groupName: e.groupName }));

    const cmd: Command = {
      description: `Rozbij obiekty (Explode)`,
      execute: () => {
        for (const e of selected) {
          delete e.groupId;
          delete e.groupName;
        }
        for (const poly of polylines) {
          this.removeEntity(poly.id);
        }
        for (const ln of createdLines) {
          this.addEntity(ln);
          this.selectedEntityIds.add(ln.id);
          ln.selected = true;
        }
        this.notifyChange();
      },
      undo: () => {
        for (const ln of createdLines) {
          this.removeEntity(ln.id);
        }
        for (const poly of polylines) {
          this.addEntity(poly);
          this.selectedEntityIds.add(poly.id);
          poly.selected = true;
        }
        for (const pg of prevGroups) {
          const ent = this.getEntity(pg.id);
          if (ent) {
            ent.groupId = pg.groupId;
            ent.groupName = pg.groupName;
          }
        }
        this.notifyChange();
      },
    };
    history.execute(cmd);
    return true;
  }

  /**
   * Assigns fresh groupIds to cloned entities so each copy forms an independent group.
   */
  static remapClonedGroups(entities: CadEntity[]) {
    const map = new Map<string, string>();
    for (const e of entities) {
      if (e.groupId) {
        let mapped = map.get(e.groupId);
        if (!mapped) {
          mapped = 'grp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          map.set(e.groupId, mapped);
        }
        e.groupId = mapped;
      }
    }
  }

  getActiveLayer(): Layer {
    return this.layers.find(l => l.id === this.activeLayerId) || this.layers[0];
  }

  addLayer(name: string, color: string = '#00e5ff', lineType: Layer['lineType'] = 'continuous', lineWidth: number = 1.0): Layer {
    const id = 'layer_' + Date.now();
    const newLayer: Layer = {
      id,
      name,
      color,
      lineWidth,
      lineType,
      visible: true,
      locked: false,
    };
    this.layers.push(newLayer);
    this.notifyChange();
    return newLayer;
  }

  /**
   * Recalculate all coordinates and values when switching document unit
   * E.g. switching from mm to in divides values by 25.4 (25.4 mm becomes 1.0 in)
   */
  convertUnits(newUnit: UnitType) {
    if (this.unit === newUnit) return;
    const oldUnit = this.unit;
    const ratio = convertUnitScale(1, oldUnit, newUnit);

    for (const ent of this.entities) {
      if (ent.type === 'point') {
        ent.x *= ratio;
        ent.y *= ratio;
      } else if (ent.type === 'line') {
        ent.x1 *= ratio;
        ent.y1 *= ratio;
        ent.x2 *= ratio;
        ent.y2 *= ratio;
      } else if (ent.type === 'circle') {
        ent.cx *= ratio;
        ent.cy *= ratio;
        ent.radius *= ratio;
      } else if (ent.type === 'polyline') {
        for (const p of ent.points) {
          p.x *= ratio;
          p.y *= ratio;
        }
      } else if (ent.type === 'text') {
        ent.x *= ratio;
        ent.y *= ratio;
        ent.height *= ratio;
        if (ent.boxWidth) ent.boxWidth *= ratio;
        if (ent.boxHeight) ent.boxHeight *= ratio;
      } else if (ent.type === 'image') {
        ent.x *= ratio;
        ent.y *= ratio;
        ent.width *= ratio;
        ent.height *= ratio;
      } else if (ent.type === 'dimension') {
        ent.p1.x *= ratio;
        ent.p1.y *= ratio;
        ent.p2.x *= ratio;
        ent.p2.y *= ratio;
        ent.offset *= ratio;
        if (ent.textHeight) ent.textHeight *= ratio;
        if (ent.center) {
          ent.center.x *= ratio;
          ent.center.y *= ratio;
        }
        if (ent.arcMidPt) {
          ent.arcMidPt.x *= ratio;
          ent.arcMidPt.y *= ratio;
        }
        if (ent.radius) ent.radius *= ratio;
      }
    }

    this.unit = newUnit;
    this.notifyChange();
  }

  /**
   * Move entities and automatically adjust connected associative dimensions
   */
  moveEntitiesWithAssociativeDimensions(entitiesToMove: CadEntity[], dx: number, dy: number) {
    const movedIds = new Set(entitiesToMove.map(e => e.id));
    const movedPoints: Point2D[] = [];

    // Collect reference points of moved entities before displacement
    for (const ent of entitiesToMove) {
      if (ent.type === 'line') {
        movedPoints.push({ x: ent.x1, y: ent.y1 });
        movedPoints.push({ x: ent.x2, y: ent.y2 });
      } else if (ent.type === 'circle') {
        movedPoints.push({ x: ent.cx, y: ent.cy });
        movedPoints.push({ x: ent.cx + ent.radius, y: ent.cy });
        movedPoints.push({ x: ent.cx - ent.radius, y: ent.cy });
        movedPoints.push({ x: ent.cx, y: ent.cy + ent.radius });
        movedPoints.push({ x: ent.cx, y: ent.cy - ent.radius });
      } else if (ent.type === 'polyline') {
        for (const p of ent.points) movedPoints.push({ ...p });
      } else if (ent.type === 'point') {
        movedPoints.push({ x: ent.x, y: ent.y });
      }
    }

    const tolerance = 0.5; // mm tolerance for matching dimension attachment
    const isPointMoved = (pt: Point2D) => {
      return movedPoints.some(mp => VectorMath.distance(mp, pt) <= tolerance);
    };

    // 1. Move the selected entities
    for (const ent of entitiesToMove) {
      if (ent.type === 'point') {
        ent.x += dx; ent.y += dy;
      } else if (ent.type === 'line') {
        ent.x1 += dx; ent.y1 += dy;
        ent.x2 += dx; ent.y2 += dy;
      } else if (ent.type === 'circle') {
        ent.cx += dx; ent.cy += dy;
      } else if (ent.type === 'polyline') {
        for (const p of ent.points) { p.x += dx; p.y += dy; }
      } else if (ent.type === 'text' || ent.type === 'image') {
        ent.x += dx; ent.y += dy;
      } else if (ent.type === 'dimension') {
        ent.p1.x += dx; ent.p1.y += dy;
        ent.p2.x += dx; ent.p2.y += dy;
        if (ent.center) {
          ent.center.x += dx;
          ent.center.y += dy;
        }
        if (ent.arcMidPt) {
          ent.arcMidPt.x += dx;
          ent.arcMidPt.y += dy;
        }
      }
    }

    // 2. Adjust any unselected dimensions that were attached to the moved points
    for (const ent of this.entities) {
      if (ent.type === 'dimension' && !movedIds.has(ent.id)) {
        const dim = ent as DimensionEntity;
        if (dim.attachedEntityIds && dim.attachedEntityIds.some(id => movedIds.has(id))) {
          dim.p1.x += dx; dim.p1.y += dy;
          dim.p2.x += dx; dim.p2.y += dy;
          if (dim.center) {
            dim.center.x += dx;
            dim.center.y += dy;
          }
          continue;
        }
        const p1Moved = isPointMoved(dim.p1);
        const p2Moved = isPointMoved(dim.p2);

        if (p1Moved && p2Moved) {
          // Entire object was moved: shift dimension completely
          dim.p1.x += dx; dim.p1.y += dy;
          dim.p2.x += dx; dim.p2.y += dy;
        } else if (p1Moved) {
          // Only point 1 shifted (e.g. stretch/vertex move)
          dim.p1.x += dx; dim.p1.y += dy;
        } else if (p2Moved) {
          // Only point 2 shifted
          dim.p2.x += dx; dim.p2.y += dy;
        }
      }
    }

    this.notifyChange();
  }
}

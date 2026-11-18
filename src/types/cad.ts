export type UnitType = 'mm' | 'cm' | 'm' | 'in';

export interface Point2D {
  x: number;
  y: number;
}

export type SnapType =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'quadrant'
  | 'perpendicular'
  | 'tangent'
  | 'nearest'
  | 'intersection'
  | 'grid';

export interface SnapPoint {
  point: Point2D;
  type: SnapType;
  entityId?: string;
}

export type LineType = 'continuous' | 'dashed' | 'dashdot' | 'dotted';

export interface Layer {
  id: string;
  name: string;
  color: string;
  lineWidth: number;
  lineType: LineType;
  visible: boolean;
  locked: boolean;
}

export interface BaseEntity {
  id: string;
  layerId: string;
  color?: string;       // Overrides layer color if set
  lineWidth?: number;   // Overrides layer line width if set
  lineType?: LineType;  // Overrides layer line type if set
  selected?: boolean;
  groupId?: string;     // Shared group ID when entities are grouped together
  groupName?: string;   // Optional human-readable name for the group / block
}

export interface PointEntity extends BaseEntity {
  type: 'point';
  x: number;
  y: number;
}

export interface LineEntity extends BaseEntity {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolylineEntity extends BaseEntity {
  type: 'polyline';
  points: Point2D[];
  closed: boolean;
}

export interface CircleEntity extends BaseEntity {
  type: 'circle';
  cx: number;
  cy: number;
  radius: number;
}

export interface TextEntity extends BaseEntity {
  type: 'text';
  text: string;
  x: number;
  y: number;
  height: number; // font size in model units (e.g. 5 mm)
  boxWidth?: number; // frame width in model units (independent of font height)
  boxHeight?: number; // frame height in model units (independent of font height)
  rotation: number; // in degrees
  align: 'left' | 'center' | 'right';
  baseline: 'top' | 'middle' | 'bottom';
}

export interface DimensionEntity extends BaseEntity {
  type: 'dimension';
  dimType:
    | 'linear-horizontal'
    | 'linear-vertical'
    | 'aligned'
    | 'radius'
    | 'diameter'
    | 'angular'
    | 'arc-length'
    | 'leader';
  p1: Point2D;
  p2: Point2D;
  offset: number; // offset of dimension line from measurement points
  textHeight?: number; // font height in model units (default 3.5 mm)
  customText?: string;
  center?: Point2D; // for radius/diameter/angular/arc-length
  radius?: number; // for radius/diameter/angular/arc-length (dimension arc radius)
  arcMidPt?: Point2D; // point on the measured arc (for arc-length direction & sweep)
  attachedEntityIds?: string[]; // IDs of entities this dimension is attached to
}

export interface ImageEntity extends BaseEntity {
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  opacity?: number;      // 0.1..1.0 (e.g. 0.5 for raster background underlay)
  isUnderlay?: boolean;  // true for background scans rendered beneath all CAD geometry
}

export type CadEntity =
  | PointEntity
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | TextEntity
  | DimensionEntity
  | ImageEntity;

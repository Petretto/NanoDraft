import { Point2D, UnitType } from '../types/cad';

export const UNIT_SCALE_TO_MM: Record<UnitType, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

export function convertUnitScale(val: number, fromUnit: UnitType, toUnit: UnitType): number {
  if (fromUnit === toUnit) return val;
  const mm = val * UNIT_SCALE_TO_MM[fromUnit];
  return mm / UNIT_SCALE_TO_MM[toUnit];
}

export class ViewportTransform {
  // Pan offset in screen pixels
  public panX: number = 0;
  public panY: number = 0;

  // Zoom: screen pixels per 1 model unit (e.g. pixels per mm)
  public zoom: number = 1.0;

  // Screen canvas size
  public screenWidth: number = 800;
  public screenHeight: number = 600;

  constructor(width: number = 800, height: number = 600) {
    this.screenWidth = width;
    this.screenHeight = height;
    // Default: origin (0,0) in center of viewport
    this.panX = width / 2;
    this.panY = height / 2;
    this.zoom = 2.0; // 2 pixels per 1 mm default
  }

  setScreenSize(width: number, height: number) {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  /**
   * Convert World point (Cartesian Y-up) to Screen pixel coordinates (Y-down)
   */
  worldToScreen(worldPt: Point2D): Point2D {
    return {
      x: this.panX + worldPt.x * this.zoom,
      y: this.panY - worldPt.y * this.zoom,
    };
  }

  /**
   * Convert Screen pixel coordinates (Y-down) to World point (Cartesian Y-up)
   */
  screenToWorld(screenPt: Point2D): Point2D {
    return {
      x: (screenPt.x - this.panX) / this.zoom,
      y: (this.panY - screenPt.y) / this.zoom,
    };
  }

  /**
   * Convert scalar distance in world units to screen pixels
   */
  worldDistToScreen(dist: number): number {
    return dist * this.zoom;
  }

  /**
   * Convert scalar distance in screen pixels to world units
   */
  screenDistToWorld(dist: number): number {
    return dist / this.zoom;
  }

  /**
   * Zoom at a specific screen anchor point (e.g. mouse cursor position)
   */
  zoomAt(screenAnchor: Point2D, factor: number) {
    const minZoom = 0.01;
    const maxZoom = 200.0;
    const newZoom = Math.min(Math.max(this.zoom * factor, minZoom), maxZoom);

    if (newZoom === this.zoom) return;

    // Keep world coordinate under mouse fixed:
    // screenAnchor.x = panX + worldPt.x * zoom
    // panX = screenAnchor.x - worldPt.x * zoom
    const worldPt = this.screenToWorld(screenAnchor);
    this.zoom = newZoom;
    this.panX = screenAnchor.x - worldPt.x * this.zoom;
    this.panY = screenAnchor.y + worldPt.y * this.zoom;
  }

  pan(deltaScreenX: number, deltaScreenY: number) {
    this.panX += deltaScreenX;
    this.panY += deltaScreenY;
  }

  resetView() {
    this.panX = this.screenWidth / 2;
    this.panY = this.screenHeight / 2;
    this.zoom = 2.0;
  }

  zoomToFit(bounds: { minX: number; minY: number; maxX: number; maxY: number }, paddingPx: number = 80) {
    const w = Math.max(bounds.maxX - bounds.minX, 10);
    const h = Math.max(bounds.maxY - bounds.minY, 10);
    const availW = Math.max(this.screenWidth - paddingPx * 2, 100);
    const availH = Math.max(this.screenHeight - paddingPx * 2, 100);
    const zoom = Math.min(availW / w, availH / h);
    this.zoom = Math.min(Math.max(zoom, 0.01), 200.0);

    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.panX = this.screenWidth / 2 - cx * this.zoom;
    this.panY = this.screenHeight / 2 + cy * this.zoom;
  }
}


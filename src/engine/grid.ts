import { ViewportTransform } from '../math/transform';
import { UnitType } from '../types/cad';

export class CadGrid {
  public visible: boolean = true;
  public snapToGrid: boolean = false;
  public gridSpacing: number = 10; // in world units (mm)

  /**
   * Calculate adaptive grid step size based on zoom
   * Returns primary and secondary grid step in world units
   */
  getAdaptiveStep(zoom: number): { minor: number; major: number } {
    // We want grid lines roughly every 15-40 screen pixels
    const minPixelSpacing = 20;
    const rawStep = minPixelSpacing / zoom;

    // Find nearest 1, 2, 5 * 10^k
    const power = Math.floor(Math.log10(rawStep));
    const base = Math.pow(10, power);
    const fraction = rawStep / base;

    let minorStep: number;
    if (fraction <= 1.5) {
      minorStep = 1 * base;
    } else if (fraction <= 3.5) {
      minorStep = 2 * base;
    } else if (fraction <= 7.5) {
      minorStep = 5 * base;
    } else {
      minorStep = 10 * base;
    }

    const majorStep = minorStep * 5;
    return { minor: minorStep, major: majorStep };
  }

  render(ctx: CanvasRenderingContext2D, transform: ViewportTransform, unit: UnitType = 'mm') {
    if (!this.visible) return;

    const { minor, major } = this.getAdaptiveStep(transform.zoom);
    this.gridSpacing = minor;

    // Visible world bounds
    const topLeft = transform.screenToWorld({ x: 0, y: 0 });
    const bottomRight = transform.screenToWorld({ x: transform.screenWidth, y: transform.screenHeight });

    const minX = Math.min(topLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, bottomRight.y);

    const startX = Math.floor(minX / minor) * minor;
    const endX = Math.ceil(maxX / minor) * minor;
    const startY = Math.floor(minY / minor) * minor;
    const endY = Math.ceil(maxY / minor) * minor;

    ctx.save();
    ctx.lineWidth = 1;

    // 1. Draw Minor Grid Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    for (let x = startX; x <= endX; x += minor) {
      const sx = Math.round(transform.worldToScreen({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, transform.screenHeight);
    }
    for (let y = startY; y <= endY; y += minor) {
      const sy = Math.round(transform.worldToScreen({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(transform.screenWidth, sy);
    }
    ctx.stroke();

    // 2. Draw Major Grid Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    const startMajorX = Math.floor(minX / major) * major;
    const endMajorX = Math.ceil(maxX / major) * major;
    for (let x = startMajorX; x <= endMajorX; x += major) {
      const sx = Math.round(transform.worldToScreen({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, transform.screenHeight);
    }
    const startMajorY = Math.floor(minY / major) * major;
    const endMajorY = Math.ceil(maxY / major) * major;
    for (let y = startMajorY; y <= endMajorY; y += major) {
      const sy = Math.round(transform.worldToScreen({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(transform.screenWidth, sy);
    }
    ctx.stroke();

    // 3. Draw Axis lines at X=0 and Y=0
    const originScreen = transform.worldToScreen({ x: 0, y: 0 });

    // X Axis (Red)
    if (originScreen.y >= 0 && originScreen.y <= transform.screenHeight) {
      ctx.strokeStyle = '#ef5350';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const sy = Math.round(originScreen.y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(transform.screenWidth, sy);
      ctx.stroke();
    }

    // Y Axis (Green)
    if (originScreen.x >= 0 && originScreen.x <= transform.screenWidth) {
      ctx.strokeStyle = '#66bb6a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const sx = Math.round(originScreen.x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, transform.screenHeight);
      ctx.stroke();
    }

    // 4. Axis labels at major intervals
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (let x = startMajorX; x <= endMajorX; x += major) {
      if (Math.abs(x) < 0.0001) continue;
      const screenPt = transform.worldToScreen({ x, y: 0 });
      const labelY = Math.min(Math.max(originScreen.y + 4, 18), transform.screenHeight - 25);
      const valX = Math.round(x * 1000) / 1000;
      ctx.fillText(`${valX} ${unit}`, screenPt.x + 3, labelY);
    }

    for (let y = startMajorY; y <= endMajorY; y += major) {
      if (Math.abs(y) < 0.0001) continue;
      const screenPt = transform.worldToScreen({ x: 0, y });
      const labelX = Math.min(Math.max(originScreen.x + 4, 8), transform.screenWidth - 70);
      const valY = Math.round(y * 1000) / 1000;
      ctx.fillText(`${valY} ${unit}`, labelX, screenPt.y + 3);
    }

    // Origin indicator marker
    ctx.strokeStyle = '#ffca28';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(originScreen.x, originScreen.y, 4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}


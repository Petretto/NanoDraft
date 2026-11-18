import { CadDocument } from '../model/document';
import { PointEntity, LineEntity, CircleEntity, PolylineEntity, TextEntity, Point2D } from '../types/cad';

export class DxfImporter {
  static importDxf(dxfText: string, doc: CadDocument): { count: number; error?: string } {
    try {
      const lines = dxfText.split(/\r?\n/).map(l => l.trim());
      let i = 0;

      // Helper to read next group code and value
      const nextGroup = (): { code: number; value: string } | null => {
        if (i >= lines.length - 1) return null;
        const code = parseInt(lines[i++], 10);
        const value = lines[i++];
        return { code, value };
      };

      let inEntities = false;
      let importedCount = 0;

      while (i < lines.length) {
        const group = nextGroup();
        if (!group) break;

        if (group.code === 0 && group.value === 'SECTION') {
          const next = nextGroup();
          if (next && next.code === 2 && next.value === 'ENTITIES') {
            inEntities = true;
          }
        } else if (group.code === 0 && group.value === 'ENDSEC') {
          if (inEntities) break;
        } else if (inEntities && group.code === 0) {
          const entityType = group.value;

          if (entityType === 'LINE') {
            let x1 = 0, y1 = 0, x2 = 0, y2 = 0, layer = doc.activeLayerId;
            while (i < lines.length) {
              const code = parseInt(lines[i], 10);
              const val = lines[i + 1];
              if (code === 0) break; // Next entity
              i += 2;
              if (code === 8) layer = val;
              else if (code === 10) x1 = parseFloat(val);
              else if (code === 20) y1 = parseFloat(val);
              else if (code === 11) x2 = parseFloat(val);
              else if (code === 21) y2 = parseFloat(val);
            }
            const line: LineEntity = {
              id: 'dxf_line_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              type: 'line',
              layerId: doc.layers.some(l => l.name === layer) ? layer : doc.activeLayerId,
              x1, y1, x2, y2,
            };
            doc.addEntity(line);
            importedCount++;
          } else if (entityType === 'CIRCLE') {
            let cx = 0, cy = 0, radius = 10, layer = doc.activeLayerId;
            while (i < lines.length) {
              const code = parseInt(lines[i], 10);
              const val = lines[i + 1];
              if (code === 0) break;
              i += 2;
              if (code === 8) layer = val;
              else if (code === 10) cx = parseFloat(val);
              else if (code === 20) cy = parseFloat(val);
              else if (code === 40) radius = parseFloat(val);
            }
            const circle: CircleEntity = {
              id: 'dxf_circ_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              type: 'circle',
              layerId: doc.layers.some(l => l.name === layer) ? layer : doc.activeLayerId,
              cx, cy, radius,
            };
            doc.addEntity(circle);
            importedCount++;
          } else if (entityType === 'POINT') {
            let x = 0, y = 0, layer = doc.activeLayerId;
            while (i < lines.length) {
              const code = parseInt(lines[i], 10);
              const val = lines[i + 1];
              if (code === 0) break;
              i += 2;
              if (code === 8) layer = val;
              else if (code === 10) x = parseFloat(val);
              else if (code === 20) y = parseFloat(val);
            }
            const pt: PointEntity = {
              id: 'dxf_pt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
              type: 'point',
              layerId: doc.layers.some(l => l.name === layer) ? layer : doc.activeLayerId,
              x, y,
            };
            doc.addEntity(pt);
            importedCount++;
          } else if (entityType === 'LWPOLYLINE' || entityType === 'POLYLINE') {
            const pts: Point2D[] = [];
            let closed = false;
            let curX = 0;
            let layer = doc.activeLayerId;
            while (i < lines.length) {
              const code = parseInt(lines[i], 10);
              const val = lines[i + 1];
              if (code === 0) break;
              i += 2;
              if (code === 8) layer = val;
              else if (code === 70) closed = (parseInt(val, 10) & 1) === 1;
              else if (code === 10) curX = parseFloat(val);
              else if (code === 20) {
                pts.push({ x: curX, y: parseFloat(val) });
              }
            }
            if (pts.length >= 2) {
              const poly: PolylineEntity = {
                id: 'dxf_poly_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                type: 'polyline',
                layerId: doc.layers.some(l => l.name === layer) ? layer : doc.activeLayerId,
                points: pts,
                closed,
              };
              doc.addEntity(poly);
              importedCount++;
            }
          } else if (entityType === 'TEXT') {
            let text = '', x = 0, y = 0, height = 3.5, rotation = 0, layer = doc.activeLayerId;
            while (i < lines.length) {
              const code = parseInt(lines[i], 10);
              const val = lines[i + 1];
              if (code === 0) break;
              i += 2;
              if (code === 1) text = val;
              else if (code === 8) layer = val;
              else if (code === 10) x = parseFloat(val);
              else if (code === 20) y = parseFloat(val);
              else if (code === 40) height = parseFloat(val);
              else if (code === 50) rotation = parseFloat(val);
            }
            if (text) {
              const textEnt: TextEntity = {
                id: 'dxf_txt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                type: 'text',
                layerId: doc.layers.some(l => l.name === layer) ? layer : doc.activeLayerId,
                text, x, y, height, rotation,
                align: 'left',
                baseline: 'middle',
              };
              doc.addEntity(textEnt);
              importedCount++;
            }
          }
        }
      }

      doc.notifyChange();
      return { count: importedCount };
    } catch (e: any) {
      return { count: 0, error: e.message || 'Nie udało się przetworzyć pliku DXF' };
    }
  }
}


import { CadDocument } from '../model/document';

export class DxfExporter {
  static exportToDxf(doc: CadDocument): string {
    const lines: string[] = [];

    const add = (code: number, value: string | number) => {
      lines.push(code.toString());
      lines.push(value.toString());
    };

    // Header section
    add(0, 'SECTION');
    add(2, 'HEADER');
    add(9, '$ACADVER');
    add(1, 'AC1015'); // AutoCAD 2000 DXF format
    add(9, '$INSUNITS');
    // Units: 4 = mm, 5 = cm, 6 = m, 1 = inches
    const unitCode = doc.unit === 'mm' ? 4 : doc.unit === 'cm' ? 5 : doc.unit === 'm' ? 6 : 1;
    add(70, unitCode);
    add(0, 'ENDSEC');

    // Tables section (Layers)
    add(0, 'SECTION');
    add(2, 'TABLES');
    add(0, 'TABLE');
    add(2, 'LAYER');
    add(70, doc.layers.length);

    for (const layer of doc.layers) {
      add(0, 'LAYER');
      add(2, layer.name);
      add(70, 0);
      add(62, 7); // Color number (7 = white/black)
      add(6, 'CONTINUOUS');
    }
    add(0, 'ENDTAB');
    add(0, 'ENDSEC');

    // Entities section
    add(0, 'SECTION');
    add(2, 'ENTITIES');

    for (const ent of doc.entities) {
      const layer = doc.layers.find(l => l.id === ent.layerId) || doc.layers[0];
      const layerName = layer.name;

      if (ent.type === 'point') {
        add(0, 'POINT');
        add(8, layerName);
        add(10, ent.x);
        add(20, ent.y);
        add(30, 0);
      } else if (ent.type === 'line') {
        add(0, 'LINE');
        add(8, layerName);
        add(10, ent.x1);
        add(20, ent.y1);
        add(30, 0);
        add(11, ent.x2);
        add(21, ent.y2);
        add(31, 0);
      } else if (ent.type === 'circle') {
        add(0, 'CIRCLE');
        add(8, layerName);
        add(10, ent.cx);
        add(20, ent.cy);
        add(30, 0);
        add(40, ent.radius);
      } else if (ent.type === 'polyline') {
        add(0, 'LWPOLYLINE');
        add(8, layerName);
        add(90, ent.points.length); // vertex count
        add(70, ent.closed ? 1 : 0); // 1 = closed
        for (const pt of ent.points) {
          add(10, pt.x);
          add(20, pt.y);
        }
      } else if (ent.type === 'text') {
        add(0, 'TEXT');
        add(8, layerName);
        add(10, ent.x);
        add(20, ent.y);
        add(30, 0);
        add(40, ent.height);
        add(1, ent.text);
        add(50, ent.rotation);
      }
    }

    add(0, 'ENDSEC');
    add(0, 'EOF');

    return lines.join('\n');
  }

  static downloadDxf(doc: CadDocument, filename: string = 'rysunek.dxf') {
    const content = DxfExporter.exportToDxf(doc);
    const blob = new Blob([content], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}


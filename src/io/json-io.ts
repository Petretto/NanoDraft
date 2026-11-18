import { CadDocument } from '../model/document';

export class JsonIO {
  static saveToJson(doc: CadDocument): string {
    return JSON.stringify(
      {
        version: '1.0',
        unit: doc.unit,
        layers: doc.layers,
        entities: doc.entities,
      },
      null,
      2
    );
  }

  static downloadProject(doc: CadDocument, filename: string = 'projekt.nanodraft') {
    const data = JsonIO.saveToJson(doc);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  static loadFromJson(jsonStr: string, doc: CadDocument): boolean {
    try {
      const data = JSON.parse(jsonStr);
      if (data && data.entities && Array.isArray(data.entities)) {
        doc.entities = data.entities;
        if (data.layers) doc.layers = data.layers;
        if (data.unit) doc.unit = data.unit;
        doc.clearSelection();
        doc.notifyChange();
        return true;
      }
    } catch (e) {
      console.error('Failed to parse NanoDraft JSON', e);
    }
    return false;
  }
}


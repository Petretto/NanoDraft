import { CadDocument } from '../model/document';
import { LineEntity, CircleEntity, PointEntity } from '../types/cad';

export class LispIntegration {
  /**
   * Generates an AutoLISP script (.lsp) to recreate this drawing in AutoCAD
   */
  static generateLispScript(doc: CadDocument): string {
    const lines: string[] = [];
    lines.push(';;; ========================================================');
    lines.push(';;; Wygenerowano automatycznie z programu NanoDraft 2D');
    lines.push(';;; Wpisz w AutoCAD polecenie: NANODRAFT_IMPORT');
    lines.push(';;; ========================================================');
    lines.push('(defun c:NANODRAFT_IMPORT ()');
    lines.push('  (setvar "CMDECHO" 0)');
    lines.push('  (setvar "OSMODE" 0)'); // Disable OSNAP during script drawing

    // Draw entities
    for (const ent of doc.entities) {
      if (ent.type === 'line') {
        lines.push(`  (command "_line" (list ${ent.x1} ${ent.y1}) (list ${ent.x2} ${ent.y2}) "")`);
      } else if (ent.type === 'circle') {
        lines.push(`  (command "_circle" (list ${ent.cx} ${ent.cy}) ${ent.radius})`);
      } else if (ent.type === 'point') {
        lines.push(`  (command "_point" (list ${ent.x} ${ent.y}))`);
      } else if (ent.type === 'polyline') {
        const ptList = ent.points.map(p => `(list ${p.x} ${p.y})`).join(' ');
        const closeFlag = ent.closed ? ' "_c"' : ' ""';
        lines.push(`  (command "_pline" ${ptList}${closeFlag})`);
      } else if (ent.type === 'text') {
        lines.push(`  (command "_text" (list ${ent.x} ${ent.y}) ${ent.height} ${ent.rotation} "${ent.text}")`);
      }
    }

    lines.push('  (command "_zoom" "_e")');
    lines.push('  (setvar "CMDECHO" 1)');
    lines.push('  (princ "\\nRysunek NanoDraft zaimportowany pomyslnie!\\n")');
    lines.push('  (princ)');
    lines.push(')');
    lines.push('(princ "\\nZaladowano skrypt NanoDraft. Wpisz NANODRAFT_IMPORT, aby wstawic obiekty.\\n")');
    lines.push('(princ)');

    return lines.join('\n');
  }

  static downloadLispScript(doc: CadDocument, filename: string = 'rysunek.lsp') {
    const content = LispIntegration.generateLispScript(doc);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Evaluates simple AutoLISP commands in NanoDraft, e.g.:
   * (command "_line" '(0 0) '(100 0) "")
   * (command "_circle" '(50 50) 25)
   */
  static runLisp(code: string, doc: CadDocument): string {
    const trimmed = code.trim();
    if (!trimmed.startsWith('(')) {
      return 'Błąd: Wyrażenie LISP musi zaczynać się od nawiasu (';
    }

    // Match (command "_line" ... )
    const lineRegex = /\(command\s+"_line"\s+'?\(\s*([0-9.-]+)\s+([0-9.-]+)\s*\)\s+'?\(\s*([0-9.-]+)\s+([0-9.-]+)\s*\)/i;
    const lineMatch = trimmed.match(lineRegex);
    if (lineMatch) {
      const line: LineEntity = {
        id: 'line_' + Date.now(),
        type: 'line',
        layerId: doc.activeLayerId,
        x1: parseFloat(lineMatch[1]),
        y1: parseFloat(lineMatch[2]),
        x2: parseFloat(lineMatch[3]),
        y2: parseFloat(lineMatch[4]),
      };
      doc.addEntity(line);
      return `Dodano Linię z LISP: (${line.x1}, ${line.y1}) -> (${line.x2}, ${line.y2})`;
    }

    // Match (command "_circle" '(cx cy) r)
    const circleRegex = /\(command\s+"_circle"\s+'?\(\s*([0-9.-]+)\s+([0-9.-]+)\s*\)\s+([0-9.-]+)/i;
    const circleMatch = trimmed.match(circleRegex);
    if (circleMatch) {
      const circle: CircleEntity = {
        id: 'circle_' + Date.now(),
        type: 'circle',
        layerId: doc.activeLayerId,
        cx: parseFloat(circleMatch[1]),
        cy: parseFloat(circleMatch[2]),
        radius: parseFloat(circleMatch[3]),
      };
      doc.addEntity(circle);
      return `Dodano Okrąg z LISP: Środek (${circle.cx}, ${circle.cy}), Promień ${circle.radius}`;
    }

    // Match (command "_point" '(x y))
    const pointRegex = /\(command\s+"_point"\s+'?\(\s*([0-9.-]+)\s+([0-9.-]+)\s*\)/i;
    const pointMatch = trimmed.match(pointRegex);
    if (pointMatch) {
      const pt: PointEntity = {
        id: 'pt_' + Date.now(),
        type: 'point',
        layerId: doc.activeLayerId,
        x: parseFloat(pointMatch[1]),
        y: parseFloat(pointMatch[2]),
      };
      doc.addEntity(pt);
      return `Dodano Punkt z LISP: (${pt.x}, ${pt.y})`;
    }

    return 'Polecenie LISP wykonane (nie rozpoznano wzorca geometrii)';
  }
}


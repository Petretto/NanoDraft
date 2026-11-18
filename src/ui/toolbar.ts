import { ToolManager } from '../tools/tool-manager';
import { CadDocument } from '../model/document';
import { HistoryManager } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { BlocksManager } from './blocks-modal';
import { BomManager } from './bom-modal';
import { svgIcon } from './icons';
import { i18n, tr } from '../i18n/lang';

interface ToolButtonDef {
  id: string;
  name: string;
  key: string;
  iconName: string;
  title?: string;
  onClick?: () => void;
}

interface ToolGroupDef {
  groupId: string;
  title: string;
  items: ToolButtonDef[];
}

export class Toolbar {
  private element: HTMLDivElement;
  private collapsedGroups: Set<string> = new Set();

  constructor(
    private toolManager: ToolManager,
    private doc: CadDocument,
    private history: HistoryManager,
    private transform: ViewportTransform,
    parent: HTMLElement,
    private requestRender: () => void
  ) {
    this.element = document.createElement('div');
    this.element.className = 'cad-toolbar';
    parent.appendChild(this.element);

    this.render();
    this.toolManager.addChangeListener(() => this.render());
    i18n.onChange(() => this.render());
  }

  private render() {
    this.element.innerHTML = '';
    const activeTool = this.toolManager.getActiveTool();

    const groups: ToolGroupDef[] = [
      {
        groupId: 'select',
        title: tr('Wybór', 'Select'),
        items: [
          {
            id: 'select',
            name: tr('Zaznacz', 'Select'),
            key: 'S',
            iconName: 'near_me',
            title: tr('Zaznacz obiekt / Uchwyty Grips [S]', 'Select object / Grips [S]'),
          },
          {
            id: 'measure',
            name: tr('Zmierz', 'Measure'),
            key: 'Q',
            iconName: 'straighten',
            title: tr('Szybki pomiar odległości / pola m² [Q]', 'Quick distance / area m² measurement [Q]'),
          },
        ],
      },
      {
        groupId: 'draw',
        title: tr('Rysowanie', 'Draw'),
        items: [
          { id: 'line', name: tr('Linia', 'Line'), key: 'L', iconName: 'horizontal_rule' },
          { id: 'polyline', name: tr('Polilinia', 'Polyline'), key: 'W', iconName: 'polyline' },
          { id: 'rect', name: tr('Prostokąt', 'Rect'), key: 'R', iconName: 'rectangle' },
          { id: 'circle', name: tr('Okrąg', 'Circle'), key: 'C', iconName: 'radio_button_unchecked' },
          { id: 'arc', name: tr('Łuk', 'Arc'), key: 'A', iconName: 'gesture' },
          {
            id: 'polygon',
            name: tr('Fasolka', 'Slot/Poly'),
            key: 'U',
            iconName: 'hexagon',
            title: tr('Otwór podłużny — Fasolka (Slot) oraz Wielokąt foremny (Polygon) [U]', 'Mounting Slot & Regular Polygon [U]'),
          },
          { id: 'point', name: tr('Punkt', 'Point'), key: 'P', iconName: 'scatter_plot' },
          { id: 'hatch', name: tr('Kreskuj', 'Hatch'), key: 'H', iconName: 'texture' },
        ],
      },
      {
        groupId: 'modify',
        title: tr('Modyfikacja', 'Modify'),
        items: [
          { id: 'move', name: tr('Przesuń', 'Move'), key: 'M', iconName: 'open_with' },
          { id: 'copy', name: tr('Kopiuj', 'Copy'), key: 'K', iconName: 'content_copy' },
          { id: 'rotate', name: tr('Obróć', 'Rotate'), key: 'O', iconName: 'rotate_right' },
          { id: 'mirror', name: tr('Lustro', 'Mirror'), key: 'I', iconName: 'flip' },
          { id: 'scale', name: tr('Skaluj', 'Scale'), key: 'V', iconName: 'open_in_full' },
          { id: 'offset', name: tr('Odsuń', 'Offset'), key: 'F', iconName: 'density_small' },
          { id: 'array', name: tr('Szyk', 'Array'), key: 'Y', iconName: 'grid_view' },
          { id: 'fillet', name: tr('Zaokrąglij', 'Fillet'), key: 'G', iconName: 'rounded_corner' },
          { id: 'trim', name: tr('Przytnij', 'Trim'), key: 'X', iconName: 'content_cut' },
          {
            id: 'match-props',
            name: tr('Pędzel', 'Match'),
            key: 'J',
            iconName: 'format_paint',
            title: tr(
              'Pędzel właściwości — kopiuj warstwę, kolor, grubość/styl linii i czcionkę na inne obiekty [J]',
              'Match Properties — copy layer, color, linetype, lineweight & font size to other objects [J]'
            ),
          },
          {
            id: '__explode_action',
            name: tr('Rozbij', 'Explode'),
            key: 'E',
            iconName: 'explosion',
            title: tr('Rozbij prostokąt/polilinię na pojedyncze odcinki [E]', 'Explode rectangle/polyline into individual line segments [E]'),
            onClick: () => {
              if (!this.doc.explodeSelected(this.history)) {
                alert(tr('Zaznacz prostokąt, polilinię lub grupę do rozbicia (E).', 'Select a rectangle, polyline or group to explode (E).'));
              }
              this.requestRender();
            },
          },
        ],
      },
      {
        groupId: 'annotate',
        title: tr('Opis i Bloki', 'Annotate'),
        items: [
          { id: 'dimension', name: tr('Wymiar', 'Dim'), key: 'D', iconName: 'square_foot' },
          {
            id: 'leader',
            name: tr('Odnośnik', 'Leader'),
            key: 'N',
            iconName: 'call_made',
            title: tr('Odnośnik strzałkowy z półką tekstową (Leader / Callout) [N]', 'Leader Callout with landing shelf [N]'),
          },
          { id: 'text', name: tr('Tekst', 'Text'), key: 'T', iconName: 'title' },
          {
            id: '__group_action',
            name: tr('Grupuj', 'Group'),
            key: '^G',
            iconName: 'link',
            title: tr('Połącz zaznaczone elementy w grupę (Ctrl+G) lub rozgrupuj (Ctrl+U)', 'Group selected elements (Ctrl+G) or ungroup (Ctrl+U)'),
            onClick: () => {
              const sel = this.doc.getSelectedEntities();
              if (sel.length < 2) {
                if (sel.some(e => !!e.groupId)) {
                  this.doc.ungroupSelected(this.history);
                  this.requestRender();
                } else {
                  alert(
                    tr(
                      'Zaznacz co najmniej 2 obiekty na rysunku, aby połączyć je w grupę (Ctrl+G).',
                      'Select at least 2 objects on the drawing to group them together (Ctrl+G).'
                    )
                  );
                }
                return;
              }
              const groupIds = new Set(sel.map(e => e.groupId).filter(Boolean));
              if (groupIds.size === 1 && sel.every(e => !!e.groupId)) {
                this.doc.ungroupSelected(this.history);
              } else {
                this.doc.groupSelected(this.history);
              }
              this.requestRender();
            },
          },
          {
            id: '__blocks_modal',
            name: tr('Bloki', 'Blocks'),
            key: 'B',
            iconName: 'widgets',
            title: tr('Otwórz Bibliotekę Bloków i Symboli CAD [B]', 'Open CAD Blocks & Symbols Library [B]'),
            onClick: () => {
              BlocksManager.openModal(this.doc, this.history, this.transform, () => this.requestRender());
            },
          },
          {
            id: '__bom_modal',
            name: tr('BOM', 'BOM'),
            key: '',
            iconName: 'table_chart',
            title: tr('Automatyczne Zestawienie Materiałowe (BOM) i eksport CSV', 'Automatic Bill of Materials (BOM) & CSV Export'),
            onClick: () => {
              BomManager.openModal(this.doc, this.history, this.transform, () => this.requestRender());
            },
          },
        ],
      },
    ];

    for (const grp of groups) {
      const grpEl = document.createElement('div');
      grpEl.className = 'tool-group';

      const isCollapsed = this.collapsedGroups.has(grp.groupId);
      const headerEl = document.createElement('div');
      headerEl.className = 'tool-group-header';
      headerEl.innerHTML = `<span>${grp.title}</span><span>${isCollapsed ? '▸' : '▾'}</span>`;
      headerEl.addEventListener('click', () => {
        if (this.collapsedGroups.has(grp.groupId)) {
          this.collapsedGroups.delete(grp.groupId);
        } else {
          this.collapsedGroups.add(grp.groupId);
        }
        this.render();
      });
      grpEl.appendChild(headerEl);

      if (!isCollapsed) {
        const gridEl = document.createElement('div');
        gridEl.className = 'tool-group-grid';

        for (const t of grp.items) {
          const btn = document.createElement('button');
          btn.className = `tool-btn ${activeTool.id === t.id ? 'active' : ''}`;
          btn.title = t.title || `${t.name} ${t.key ? `[${t.key}]` : ''}`;

          btn.innerHTML = `
            <span class="tool-icon">${svgIcon(t.iconName, 17)}</span>
            <span class="tool-name">${t.name}</span>
            <span class="tool-key">${t.key}</span>
          `;

          btn.addEventListener('click', () => {
            if (t.onClick) {
              t.onClick();
            } else {
              this.toolManager.setActiveTool(t.id);
            }
          });

          gridEl.appendChild(btn);
        }
        grpEl.appendChild(gridEl);
      }

      this.element.appendChild(grpEl);
    }
  }
}

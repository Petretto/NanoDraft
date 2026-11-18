import { ToolManager } from '../tools/tool-manager';
import { CadDocument } from '../model/document';
import { HistoryManager } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { BlocksManager } from './blocks-modal';
import { BomManager } from './bom-modal';
import { i18n, tr } from '../i18n/lang';

interface ToolButtonDef {
  id: string;
  name: string;
  key: string;
  icon: string;
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
          { id: 'select', name: tr('Zaznacz', 'Select'), key: 'S', icon: '↖' },
          { id: 'measure', name: tr('Zmierz', 'Measure'), key: 'Q', icon: '📏' },
        ],
      },
      {
        groupId: 'draw',
        title: tr('Rysowanie', 'Draw'),
        items: [
          { id: 'line', name: tr('Linia', 'Line'), key: 'L', icon: '╱' },
          { id: 'polyline', name: tr('Polilinia', 'Polyline'), key: 'W', icon: '⌇' },
          { id: 'rect', name: tr('Prostokąt', 'Rect'), key: 'R', icon: '▭' },
          { id: 'circle', name: tr('Okrąg', 'Circle'), key: 'C', icon: '○' },
          { id: 'arc', name: tr('Łuk', 'Arc'), key: 'A', icon: '⌒' },
          {
            id: 'polygon',
            name: tr('Fasolka/Wlk', 'Slot/Poly'),
            key: 'U',
            icon: '⬡',
            title: tr('Otwór podłużny — Fasolka (Slot) oraz Wielokąt foremny (Polygon) [U]', 'Mounting Slot & Regular Polygon [U]'),
          },
          { id: 'point', name: tr('Punkt', 'Point'), key: 'P', icon: '•' },
          { id: 'hatch', name: tr('Kreskuj', 'Hatch'), key: 'H', icon: '▧' },
        ],
      },
      {
        groupId: 'modify',
        title: tr('Modyfikacja', 'Modify'),
        items: [
          { id: 'move', name: tr('Przesuń', 'Move'), key: 'M', icon: '✥' },
          { id: 'copy', name: tr('Kopiuj', 'Copy'), key: 'K', icon: '⧉' },
          { id: 'rotate', name: tr('Obróć', 'Rotate'), key: 'O', icon: '↻' },
          { id: 'mirror', name: tr('Lustro', 'Mirror'), key: 'I', icon: '◫' },
          { id: 'scale', name: tr('Skaluj', 'Scale'), key: 'V', icon: '⤢' },
          { id: 'offset', name: tr('Odsuń', 'Offset'), key: 'F', icon: '≋' },
          { id: 'array', name: tr('Szyk', 'Array'), key: 'Y', icon: '▦' },
          { id: 'fillet', name: tr('Zaokrąglij', 'Fillet'), key: 'G', icon: '◜' },
          { id: 'trim', name: tr('Przytnij', 'Trim'), key: 'X', icon: '✂' },
          {
            id: 'match-props',
            name: tr('Pędzel', 'Match'),
            key: 'J',
            icon: '🖌️',
            title: tr(
              'Pędzel właściwości — kopiuj warstwę, kolor, grubość/styl linii i czcionkę na inne obiekty [J]',
              'Match Properties — copy layer, color, linetype, lineweight & font size to other objects [J]'
            ),
          },
          {
            id: '__explode_action',
            name: tr('Rozbij', 'Explode'),
            key: 'E',
            icon: '💥',
            title: tr('Rozbij prostokąt/polilinię na pojedyncze odcinki (E)', 'Explode rectangle/polyline into individual line segments (E)'),
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
          { id: 'dimension', name: tr('Wymiar', 'Dim'), key: 'D', icon: '↔' },
          {
            id: 'leader',
            name: tr('Odnośnik', 'Leader'),
            key: 'N',
            icon: '↗',
            title: tr('Odnośnik strzałkowy z półką tekstową (Leader / Callout) [N]', 'Leader Callout with landing shelf [N]'),
          },
          { id: 'text', name: tr('Tekst', 'Text'), key: 'T', icon: 'T' },
          {
            id: '__group_action',
            name: tr('Grupuj', 'Group'),
            key: '^G',
            icon: '🔗',
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
            icon: '📦',
            title: tr('Otwórz Bibliotekę Bloków i Symboli CAD (B)', 'Open CAD Blocks & Symbols Library (B)'),
            onClick: () => {
              BlocksManager.openModal(this.doc, this.history, this.transform, () => this.requestRender());
            },
          },
          {
            id: '__bom_modal',
            name: tr('Zestaw. BOM', 'BOM'),
            key: '',
            icon: '📊',
            title: tr('Automatyczne Zestawienie Bloków / Grup (BOM) i eksport CSV', 'Automatic Blocks / Groups Bill of Materials (BOM) & CSV Export'),
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
          btn.title = t.title || `${t.name} (${tr('Skrót', 'Shortcut')}: ${t.key})`;

          btn.innerHTML = `
            <span class="tool-icon">${t.icon}</span>
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

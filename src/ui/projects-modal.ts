/// <reference types="vite/client" />
import { CadDocument } from '../model/document';
import { HistoryManager } from '../model/history';
import { ViewportTransform } from '../math/transform';
import { JsonIO } from '../io/json-io';
import { DxfImporter } from '../io/dxf-import';
import { Geometry } from '../math/geometry';
import { tr } from '../i18n/lang';

// Dynamically discover project files in /Projects directory (bundled eagerly so offline/portable HTML works without a server)
const projectLoaders = import.meta.glob('/Projects/*.{nanodraft,minicad,json,dxf}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string | (() => Promise<string>)>;

export class ProjectsModal {
  static open(
    doc: CadDocument,
    history: HistoryManager,
    transform: ViewportTransform,
    onLoaded: () => void,
    triggerDiskFilePicker: () => void
  ) {
    const existing = document.getElementById('cad-projects-modal-overlay');
    if (existing) existing.remove();

    const entries = Object.keys(projectLoaders)
      .map(fullPath => {
        const fileName = fullPath.split('/').pop() || fullPath;
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        return { fullPath, fileName, ext };
      })
      .sort((a, b) => a.fileName.localeCompare(b.fileName));

    const overlay = document.createElement('div');
    overlay.id = 'cad-projects-modal-overlay';
    overlay.className = 'cad-modal-overlay';

    overlay.innerHTML = `
      <div class="cad-modal" style="width: 480px; max-width: 95vw;">
        <div class="modal-header">
          <h3>📁 ${tr('Katalog Projektów (/Projects)', 'Projects Directory (/Projects)')}</h3>
          <button class="modal-close-btn" id="proj-modal-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:10px; max-height:65vh; overflow-y:auto;">
          <div style="font-size:12px; color:var(--text-muted);">
            ${tr(
              'Wybierz projekt z katalogu <b>Projects/</b> aby wczytać go do obszaru roboczego, lub wskaż dowolny plik z dysku:',
              'Select a project file from the <b>Projects/</b> folder to load it into the workspace, or browse any file from disk:'
            )}
          </div>
          <div id="proj-list" style="display:flex; flex-direction:column; gap:6px;">
            ${
              entries.length === 0
                ? `<div style="padding:12px; text-align:center; color:var(--text-muted);">${tr('Brak plików w katalogu Projects/', 'No files found in Projects/ directory')}</div>`
                : entries
                    .map(
                      e => `
                  <div class="layer-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="font-size:16px;">${e.ext === 'dxf' ? '📐' : '📄'}</span>
                      <div>
                        <div style="font-weight:600; font-size:13px; color:var(--text-main);">${e.fileName}</div>
                        <div style="font-size:11px; color:var(--text-muted);">Projects/${e.fileName}</div>
                      </div>
                    </div>
                    <button class="top-btn highlight proj-load-btn" data-path="${e.fullPath}">
                      📂 ${tr('Wczytaj', 'Load')}
                    </button>
                  </div>
                `
                    )
                    .join('')
            }
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between; gap:8px;">
          <button class="top-btn" id="proj-browse-disk-btn">💻 ${tr('Przeglądaj dysk...', 'Browse Disk...')}</button>
          <button class="top-btn" id="proj-cancel-btn">${tr('Zamknij', 'Close')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#proj-modal-close')?.addEventListener('click', close);
    overlay.querySelector('#proj-cancel-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#proj-browse-disk-btn')?.addEventListener('click', () => {
      close();
      triggerDiskFilePicker();
    });

    overlay.querySelectorAll('.proj-load-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const path = (btn as HTMLElement).getAttribute('data-path');
        if (!path || !projectLoaders[path]) return;

        try {
          const loaderOrRaw = projectLoaders[path];
          const content = typeof loaderOrRaw === 'function' ? await loaderOrRaw() : loaderOrRaw;
          const isDxf = path.toLowerCase().endsWith('.dxf');
          if (isDxf) {
            doc.resetToNew('mm');
            const res = DxfImporter.importDxf(content, doc);
            if (res.error) {
              alert(tr('Błąd importu DXF: ', 'DXF import error: ') + res.error);
              return;
            }
          } else {
            if (!JsonIO.loadFromJson(content, doc)) {
              return;
            }
          }

          history.clear();
          doc.markClean();
          const bounds = Geometry.unionBounds(doc.entities);
          if (bounds) {
            transform.zoomToFit(bounds);
          } else {
            transform.resetView();
          }
          close();
          onLoaded();
        } catch (err) {
          console.error('Failed to load project file:', err);
        }
      });
    });
  }
}


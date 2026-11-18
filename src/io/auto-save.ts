import { CadDocument } from '../model/document';
import { CadEntity, Layer, UnitType } from '../types/cad';
import { tr } from '../i18n/lang';

const AUTOSAVE_KEY = 'nanodraft_autosave_v1';
const LEGACY_AUTOSAVE_KEY = 'minicad_autosave_v1';
const AUTOSAVE_DEBOUNCE_MS = 700;

export interface AutoSavePayload {
  version: '1.0';
  savedAt: number;
  unit: UnitType;
  activeLayerId: string;
  layers: Layer[];
  entities: CadEntity[];
}

export interface AutoSaveStatusInfo {
  status: 'saved' | 'cleared' | 'quota-exceeded' | 'restored';
  savedAt?: number;
  entityCount?: number;
}

export class AutoSaveManager {
  private static debounceTimer: number | null = null;
  private static isRestoring: boolean = false;
  private static onStatusCallback: ((info: AutoSaveStatusInfo) => void) | null = null;

  static attach(doc: CadDocument, onStatus?: (info: AutoSaveStatusInfo) => void) {
    this.onStatusCallback = onStatus || null;

    doc.addChangeListener(() => {
      if (this.isRestoring) return;
      this.scheduleSave(doc);
    });
  }

  private static scheduleSave(doc: CadDocument) {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.saveNow(doc);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  static saveNow(doc: CadDocument): boolean {
    if (this.isRestoring) return false;

    try {
      if (doc.entities.length === 0) {
        localStorage.removeItem(AUTOSAVE_KEY);
        this.onStatusCallback?.({ status: 'cleared' });
        return true;
      }

      const now = Date.now();
      const payload: AutoSavePayload = {
        version: '1.0',
        savedAt: now,
        unit: doc.unit,
        activeLayerId: doc.activeLayerId,
        layers: doc.layers,
        entities: doc.entities.map(e => ({ ...e, selected: false })),
      };

      const serialized = JSON.stringify(payload);
      localStorage.setItem(AUTOSAVE_KEY, serialized);
      this.onStatusCallback?.({
        status: 'saved',
        savedAt: now,
        entityCount: doc.entities.length,
      });
      return true;
    } catch (err) {
      // Handle localStorage QuotaExceededError gracefully (e.g. huge embedded raster image)
      try {
        const lightweightEntities = doc.entities
          .filter(e => e.type !== 'image' || e.dataUrl.length < 250_000)
          .map(e => ({ ...e, selected: false }));
        if (lightweightEntities.length > 0) {
          const now = Date.now();
          const fallbackPayload: AutoSavePayload = {
            version: '1.0',
            savedAt: now,
            unit: doc.unit,
            activeLayerId: doc.activeLayerId,
            layers: doc.layers,
            entities: lightweightEntities,
          };
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(fallbackPayload));
          this.onStatusCallback?.({
            status: 'saved',
            savedAt: now,
            entityCount: lightweightEntities.length,
          });
          return true;
        }
      } catch {
        // Still exceeds quota
      }
      console.warn('AutoSave quota exceeded:', err);
      this.onStatusCallback?.({ status: 'quota-exceeded' });
      return false;
    }
  }

  static loadPayload(): AutoSavePayload | null {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY) || localStorage.getItem(LEGACY_AUTOSAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AutoSavePayload;
      if (parsed && Array.isArray(parsed.entities) && parsed.entities.length > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn('Failed to read autosave payload:', err);
    }
    return null;
  }

  static restore(doc: CadDocument): AutoSavePayload | null {
    const payload = this.loadPayload();
    if (!payload) return null;

    this.isRestoring = true;
    try {
      doc.entities = payload.entities.map(e => ({ ...e, selected: false }));
      if (Array.isArray(payload.layers) && payload.layers.length > 0) {
        doc.layers = payload.layers;
      }
      if (payload.unit) {
        doc.unit = payload.unit;
      }
      if (payload.activeLayerId && doc.layers.some(l => l.id === payload.activeLayerId)) {
        doc.activeLayerId = payload.activeLayerId;
      }
      doc.selectedEntityIds.clear();
      doc.notifyChange();
      doc.markClean();
      this.onStatusCallback?.({
        status: 'restored',
        savedAt: payload.savedAt,
        entityCount: doc.entities.length,
      });
      return payload;
    } finally {
      this.isRestoring = false;
    }
  }

  static clear() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
    } catch {
      // ignore
    }
    this.onStatusCallback?.({ status: 'cleared' });
  }

  static formatTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /**
   * Show a non-intrusive restore banner on top of viewport allowing user to keep or discard restored session
   */
  static showRestoreBanner(
    viewport: HTMLElement,
    payload: AutoSavePayload,
    onDiscardToNew: () => void
  ) {
    const banner = document.createElement('div');
    banner.className = 'cad-dim-mode-bar';
    banner.style.top = '12px';
    banner.style.zIndex = '40';
    banner.style.background = 'rgba(20, 34, 46, 0.95)';
    banner.style.borderColor = '#00e5ff';
    banner.addEventListener('mousedown', e => e.stopPropagation());

    const timeStr = this.formatTime(payload.savedAt);
    banner.innerHTML = `
      <span style="color:#00e5ff; font-weight:600; font-size:12px;">
        💾 ${tr(
          `Przywrócono auto-zapis z ${timeStr} (${payload.entities.length} obiektów)`,
          `Restored auto-save from ${timeStr} (${payload.entities.length} objects)`
        )}
      </span>
      <button id="as-discard-btn" class="dim-mode-btn" style="margin-left:6px;">
        📄 ${tr('Zacznij od nowa', 'Start Fresh')}
      </button>
      <button id="as-close-btn" class="dim-mode-btn" title="${tr('Zamknij powiadomienie', 'Dismiss')}">✕</button>
    `;

    viewport.appendChild(banner);

    const dismiss = () => {
      if (banner.parentElement) banner.remove();
    };

    const autoHide = window.setTimeout(dismiss, 9000);

    banner.querySelector('#as-close-btn')?.addEventListener('click', () => {
      window.clearTimeout(autoHide);
      dismiss();
    });

    banner.querySelector('#as-discard-btn')?.addEventListener('click', () => {
      window.clearTimeout(autoHide);
      dismiss();
      this.clear();
      onDiscardToNew();
    });
  }
}

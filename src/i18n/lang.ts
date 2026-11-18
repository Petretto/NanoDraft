export type LangCode = 'pl' | 'en';

class I18nManager {
  private currentLang: LangCode = 'pl';
  private listeners: (() => void)[] = [];

  get lang(): LangCode {
    return this.currentLang;
  }

  setLang(lang: LangCode) {
    if (this.currentLang === lang) return;
    this.currentLang = lang;
    for (const fn of this.listeners) {
      fn();
    }
  }

  toggleLang() {
    this.setLang(this.currentLang === 'pl' ? 'en' : 'pl');
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Translate helper: pass Polish and English strings, returns active language string */
  t(pl: string, en: string): string {
    return this.currentLang === 'pl' ? pl : en;
  }
}

export const i18n = new I18nManager();
export const tr = (pl: string, en: string): string => i18n.t(pl, en);


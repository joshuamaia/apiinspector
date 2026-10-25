import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

export interface AppSettings {
  theme: Theme;
  /** Persist secrets (tokens, passwords, API keys) encrypted with AES-GCM. When false they are never stored. */
  persistSecrets: boolean;
  historyLimit: number;
  /** Maximum body size kept per history entry (bytes). */
  storedBodyLimit: number;
  /** Workspace layout of the request/response panes. */
  layout: 'horizontal' | 'vertical';
  sidebarOpen: boolean;
}

const DEFAULTS: AppSettings = {
  theme: 'dark',
  persistSecrets: true,
  historyLimit: 300,
  storedBodyLimit: 512 * 1024,
  layout: 'horizontal',
  sidebarOpen: true,
};

const STORAGE_KEY = 'api-inspector.settings';
const TOKEN_KEY = 'api-inspector.bff-token';

function read<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * User preferences (non-sensitive, localStorage). The optional BFF access
 * token lives in sessionStorage only, so it disappears with the tab.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly document = inject(DOCUMENT);
  readonly settings = signal<AppSettings>({ ...DEFAULTS, ...read<Partial<AppSettings>>(globalThis.localStorage, STORAGE_KEY) });
  readonly bffToken = signal<string>(read<string>(globalThis.sessionStorage, TOKEN_KEY) ?? '');

  constructor() {
    effect(() => {
      const s = this.settings();
      this.document.documentElement.dataset['theme'] = s.theme;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      } catch {
        /* storage unavailable */
      }
    });
    effect(() => {
      const token = this.bffToken();
      try {
        if (token) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        else sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* storage unavailable */
      }
    });
  }

  update(patch: Partial<AppSettings>): void {
    this.settings.update((s) => ({ ...s, ...patch }));
  }

  toggleTheme(): void {
    this.update({ theme: this.settings().theme === 'dark' ? 'light' : 'dark' });
  }
}

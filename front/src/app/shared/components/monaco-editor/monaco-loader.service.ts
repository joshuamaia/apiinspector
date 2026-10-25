import { DOCUMENT, Injectable, inject } from '@angular/core';
import type * as MonacoNs from 'monaco-editor';

export type Monaco = typeof MonacoNs;

type AmdRequire = ((deps: string[], onLoad: (...modules: unknown[]) => void, onError?: (err: unknown) => void) => void) & {
  config: (config: object) => void;
};

/**
 * Loads Monaco lazily from `assets/monaco/vs` (AMD build copied by angular.json),
 * keeping the ~3 MB editor out of the main bundle.
 */
@Injectable({ providedIn: 'root' })
export class MonacoLoaderService {
  private readonly document = inject(DOCUMENT);
  private promise: Promise<Monaco> | null = null;

  load(): Promise<Monaco> {
    this.promise ??= new Promise<Monaco>((resolve, reject) => {
      const base = new URL('assets/monaco/vs', this.document.baseURI).href;
      const css = this.document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${base}/editor/editor.main.css`;
      this.document.head.appendChild(css);

      const script = this.document.createElement('script');
      script.src = `${base}/loader.js`;
      script.async = true;
      script.onerror = () => reject(new Error('Failed to load the Monaco editor'));
      script.onload = () => {
        const amdRequire = (globalThis as unknown as { require: AmdRequire }).require;
        amdRequire.config({ paths: { vs: base } });
        amdRequire(
          ['vs/editor/editor.main'],
          (main) => {
            const monaco = ((globalThis as unknown as { monaco?: Monaco }).monaco ?? main) as Monaco;
            this.defineThemes(monaco);
            resolve(monaco);
          },
          (err) => reject(err instanceof Error ? err : new Error('Failed to load the Monaco editor')),
        );
      };
      this.document.body.appendChild(script);
    });
    return this.promise;
  }

  private defineThemes(monaco: Monaco): void {
    monaco.editor.defineTheme('inspector-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'string.key.json', foreground: '9CDCFE' },
        { token: 'string.value.json', foreground: 'E3A17A' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'keyword.json', foreground: '569CD6' },
      ],
      colors: {
        'editor.background': '#0c1322',
        'editor.lineHighlightBackground': '#131d33',
        'editorLineNumber.foreground': '#3c4a66',
        'editorLineNumber.activeForeground': '#9aa9c2',
        'editorGutter.background': '#0c1322',
        'editor.selectionBackground': '#2dd4bf33',
        'editorIndentGuide.background1': '#1c2840',
        'editorWidget.background': '#0f172a',
        'editorWidget.border': '#2a3a5c',
        'scrollbarSlider.background': '#2a3a5c80',
      },
    });
    monaco.editor.defineTheme('inspector-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#f7f9fc',
        'editor.lineHighlightBackground': '#eef2f8',
        'editorGutter.background': '#f7f9fc',
        'editorLineNumber.foreground': '#a3b0c4',
      },
    });
  }
}

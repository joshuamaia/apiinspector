import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as MonacoNs from 'monaco-editor';
import { SettingsService } from '../../../core/services/settings.service';
import { MonacoLoaderService, type Monaco } from './monaco-loader.service';

let modelCounter = 0;

/** Monaco editor wrapper (syntax highlighting, line numbers, JSON validation, formatting). Falls back to a textarea. */
@Component({
  selector: 'app-monaco-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="host" [hidden]="failed()"></div>
    @if (failed()) {
      <textarea class="fallback" [value]="value()" [readOnly]="readOnly()" (input)="valueChange.emit($any($event.target).value)" spellcheck="false"></textarea>
    } @else if (!ready()) {
      <div class="loading"><span class="spinner"></span> Loading editor…</div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      min-height: 0;
      height: 100%;
    }
    .host {
      position: absolute;
      inset: 0;
    }
    .loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--text-faint);
      font-size: 12px;
    }
    .fallback {
      width: 100%;
      height: 100%;
      resize: none;
      border: 0;
      background: var(--bg-elev);
      font-family: var(--font-mono);
      font-size: 12px;
      padding: 8px 12px;
      outline: none;
    }
  `,
})
export class MonacoEditorComponent {
  private readonly loader = inject(MonacoLoaderService);
  private readonly settings = inject(SettingsService);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly value = input<string>('');
  readonly language = input<string>('json');
  readonly readOnly = input(false);
  readonly wordWrap = input(false);
  readonly lineNumbers = input(true);
  readonly fontSize = input(12.5);
  readonly valueChange = output<string>();
  readonly validationChange = output<MonacoNs.editor.IMarker[]>();

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);
  private monaco: Monaco | null = null;
  private editor: MonacoNs.editor.IStandaloneCodeEditor | null = null;
  private model: MonacoNs.editor.ITextModel | null = null;
  private applyingExternal = false;

  constructor() {
    let destroyed = false;
    this.loader
      .load()
      .then((monaco) => {
        if (destroyed) return;
        this.monaco = monaco;
        this.create(monaco);
      })
      .catch(() => this.failed.set(true));
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      this.editor?.dispose();
      this.model?.dispose();
    });

    effect(() => {
      const value = this.value();
      if (!this.ready() || !this.model) return;
      untracked(() => {
        if (this.model!.getValue() !== value) {
          this.applyingExternal = true;
          this.model!.pushEditOperations([], [{ range: this.model!.getFullModelRange(), text: value }], () => null);
          this.applyingExternal = false;
        }
      });
    });
    effect(() => {
      const language = this.language();
      if (this.ready() && this.monaco && this.model) this.monaco.editor.setModelLanguage(this.model, language);
    });
    effect(() => {
      const theme = this.settings.settings().theme;
      if (this.ready() && this.monaco) this.monaco.editor.setTheme(theme === 'dark' ? 'inspector-dark' : 'inspector-light');
    });
    effect(() => {
      const options = { readOnly: this.readOnly(), wordWrap: this.wordWrap() ? 'on' : 'off', lineNumbers: this.lineNumbers() ? 'on' : 'off' } as const;
      if (this.ready()) this.editor?.updateOptions(options);
    });
  }

  private create(monaco: Monaco): void {
    const uri = monaco.Uri.parse(`inmemory://api-inspector/model-${++modelCounter}.${this.language() === 'json' ? 'json' : 'txt'}`);
    this.model = monaco.editor.createModel(this.value(), this.language(), uri);
    this.editor = monaco.editor.create(this.host().nativeElement, {
      model: this.model,
      theme: this.settings.settings().theme === 'dark' ? 'inspector-dark' : 'inspector-light',
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: this.fontSize(),
      lineHeight: 19,
      scrollBeyondLastLine: false,
      readOnly: this.readOnly(),
      wordWrap: this.wordWrap() ? 'on' : 'off',
      lineNumbers: this.lineNumbers() ? 'on' : 'off',
      tabSize: 2,
      renderLineHighlight: 'line',
      folding: true,
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      stickyScroll: { enabled: false },
    });
    this.model.onDidChangeContent(() => {
      if (!this.applyingExternal) this.valueChange.emit(this.model!.getValue());
    });
    monaco.editor.onDidChangeMarkers((uris) => {
      if (this.model && uris.some((u) => u.toString() === this.model!.uri.toString())) {
        this.validationChange.emit(monaco.editor.getModelMarkers({ resource: this.model.uri }));
      }
    });
    this.ready.set(true);
  }

  async format(): Promise<void> {
    await this.editor?.getAction('editor.action.formatDocument')?.run();
  }

  revealLine(line: number, column = 1): void {
    if (!this.editor) return;
    this.editor.revealLineInCenter(line);
    this.editor.setPosition({ lineNumber: line, column });
    this.editor.focus();
  }

  focus(): void {
    this.editor?.focus();
  }
}

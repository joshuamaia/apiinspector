import { ChangeDetectionStrategy, Component, computed, input, output, viewChild } from '@angular/core';
import { BODY_MODES, methodAllowsBody, type BodyConfig, type BodyMode, type HttpMethod, type KeyValue } from '../../../core/models/request.model';
import { formatJson, minifyJson, validateJson } from '../../../core/utils/json';
import { formatXml, isWellFormedXml } from '../../../core/utils/xml';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { KeyValueEditorComponent } from '../../../shared/components/key-value-editor/key-value-editor.component';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor/monaco-editor.component';

const LABELS: Record<BodyMode, string> = {
  none: 'None',
  json: 'JSON',
  text: 'Text',
  xml: 'XML',
  'form-urlencoded': 'Form URL Encoded',
  multipart: 'Multipart',
};

@Component({
  selector: 'app-body-editor',
  imports: [IconComponent, MonacoEditorComponent, KeyValueEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!allowed()) {
      <div class="empty-state">
        <div class="icon-wrap"><app-icon name="info" [size]="24" /></div>
        <h3>{{ method() }} requests have no body</h3>
        <p>Bodies are disabled for GET and HEAD by default. Change the method (e.g. POST, PUT or PATCH) to send a payload.</p>
      </div>
    } @else {
      <div class="body-editor">
        <div class="toolbar">
          <div class="segmented modes" role="radiogroup" aria-label="Body type">
            @for (m of modes; track m) {
              <button type="button" role="radio" [attr.aria-checked]="body().mode === m" [class.active]="body().mode === m" (click)="setMode(m)">{{ labels[m] }}</button>
            }
          </div>
          <span class="spacer"></span>
          @if (body().mode === 'json' || body().mode === 'xml') {
            <button class="btn btn-ghost sm" type="button" (click)="format()" title="Format document"><app-icon name="wand" [size]="13" /> Format</button>
          }
          @if (body().mode === 'json') {
            <button class="btn btn-ghost sm" type="button" (click)="minify()" title="Minify JSON"><app-icon name="minus" [size]="13" /> Minify</button>
          }
        </div>

        @switch (body().mode) {
          @case ('none') {
            <div class="empty-state small-state">
              <p>This request does not send a body. Pick a body type above.</p>
            </div>
          }
          @case ('form-urlencoded') {
            <div class="pad"><app-key-value-editor [items]="body().fields" kind="form" (itemsChange)="setFields($event)" /></div>
          }
          @case ('multipart') {
            <div class="pad"><app-key-value-editor [items]="body().fields" kind="multipart" (itemsChange)="setFields($event)" /></div>
          }
          @default {
            <div class="editor-wrap">
              <app-monaco-editor #editor [value]="body().raw" [language]="language()" (valueChange)="setRaw($event)" />
            </div>
            <div class="status-bar">
              @if (validation(); as v) {
                @if (v.valid) {
                  <span class="text-success"><app-icon name="check-circle" [size]="13" /> {{ v.label }}</span>
                } @else {
                  <button class="link text-danger" type="button" (click)="reveal(v.line, v.column)">
                    <app-icon name="alert" [size]="13" /> {{ v.label }}
                  </button>
                }
              }
              <span class="spacer"></span>
              <span class="faint">{{ body().raw.length }} chars</span>
              <span class="faint">Content-Type: {{ contentTypeHint() }}</span>
            </div>
          }
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body-editor {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      flex-wrap: wrap;
    }
    .modes {
      flex-wrap: wrap;
    }
    .editor-wrap {
      flex: 1;
      min-height: 160px;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .status-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      font-size: 11.5px;
      min-height: 26px;
      span,
      .link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
    }
    .link {
      border: 0;
      background: transparent;
      cursor: pointer;
      font-size: 11.5px;
      padding: 0;
    }
    .pad {
      padding: 4px 12px 12px;
      overflow: auto;
    }
    .small-state {
      height: auto;
      padding: 24px;
    }
  `,
})
export class BodyEditorComponent {
  readonly body = input.required<BodyConfig>();
  readonly method = input.required<HttpMethod>();
  readonly headers = input<KeyValue[]>([]);
  readonly bodyChange = output<BodyConfig>();
  private readonly editor = viewChild<MonacoEditorComponent>('editor');

  protected readonly modes = BODY_MODES;
  protected readonly labels = LABELS;
  protected readonly allowed = computed(() => methodAllowsBody(this.method()));
  protected readonly language = computed(() => (this.body().mode === 'json' ? 'json' : this.body().mode === 'xml' ? 'xml' : 'plaintext'));

  protected readonly validation = computed<{ valid: boolean; label: string; line: number; column: number } | null>(() => {
    const { mode, raw } = this.body();
    if (!raw.trim()) return null;
    if (mode === 'json') {
      // Variables may make otherwise-valid JSON look invalid; validate with placeholders.
      const result = validateJson(raw.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '0'));
      return result.valid
        ? { valid: true, label: 'Valid JSON', line: 0, column: 0 }
        : { valid: false, label: `Line ${result.error!.line}, column ${result.error!.column}: ${result.error!.message}`, line: result.error!.line, column: result.error!.column };
    }
    if (mode === 'xml') {
      const result = isWellFormedXml(raw);
      return result.valid ? { valid: true, label: 'Well-formed XML', line: 0, column: 0 } : { valid: false, label: result.error ?? 'Invalid XML', line: 1, column: 1 };
    }
    return null;
  });

  protected readonly contentTypeHint = computed(() => {
    const custom = this.headers().find((h) => h.enabled && h.key.trim().toLowerCase() === 'content-type');
    if (custom) return `${custom.value} (from Headers)`;
    return { json: 'application/json', text: 'text/plain', xml: 'application/xml' }[this.body().mode as 'json'] ?? '';
  });

  protected setMode(mode: BodyMode): void {
    const body = this.body();
    let raw = body.raw;
    if (mode === 'json' && !raw.trim()) raw = '{\n  \n}';
    this.bodyChange.emit({ ...body, mode, raw });
  }

  protected setRaw(raw: string): void {
    this.bodyChange.emit({ ...this.body(), raw });
  }

  protected setFields(fields: KeyValue[]): void {
    this.bodyChange.emit({ ...this.body(), fields: fields.map((f) => ({ kind: 'text', ...f })) });
  }

  protected format(): void {
    const body = this.body();
    const raw = body.mode === 'json' ? formatJson(body.raw) : formatXml(body.raw);
    this.bodyChange.emit({ ...body, raw });
  }

  protected minify(): void {
    this.bodyChange.emit({ ...this.body(), raw: minifyJson(this.body().raw) });
  }

  protected reveal(line: number, column: number): void {
    this.editor()?.revealLine(line, column);
  }
}

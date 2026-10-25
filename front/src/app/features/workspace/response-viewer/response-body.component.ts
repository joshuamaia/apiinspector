import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml, type SafeResourceUrl } from '@angular/platform-browser';
import type { ProxyResponseData } from '../../../core/models/proxy.model';
import { ToastService } from '../../../core/services/toast.service';
import { base64ToBytes, downloadFile, extensionFor, slugify } from '../../../core/utils/download';
import { formatBytes } from '../../../core/utils/format';
import { isJsonContentType, tryParseJson } from '../../../core/utils/json';
import { formatXml } from '../../../core/utils/xml';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { JsonTreeComponent } from '../../../shared/components/json-tree/json-tree.component';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor/monaco-editor.component';

type ViewMode = 'pretty' | 'raw' | 'tree' | 'preview';

/** Bodies larger than this are not pretty printed (keeps the UI responsive). */
const PRETTY_LIMIT = 3 * 1024 * 1024;

@Component({
  selector: 'app-response-body',
  imports: [IconComponent, MonacoEditorComponent, JsonTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body-view">
      <div class="toolbar">
        <div class="segmented" role="radiogroup" aria-label="Body view">
          @if (!isBinary()) {
            <button type="button" [class.active]="mode() === 'pretty'" (click)="mode.set('pretty')"><app-icon name="braces" [size]="12" /> Pretty</button>
            <button type="button" [class.active]="mode() === 'raw'" (click)="mode.set('raw')"><app-icon name="code" [size]="12" /> Raw</button>
            @if (json().ok) {
              <button type="button" [class.active]="mode() === 'tree'" (click)="mode.set('tree')"><app-icon name="tree" [size]="12" /> Tree</button>
            }
          }
          @if (canPreview()) {
            <button type="button" [class.active]="mode() === 'preview'" (click)="mode.set('preview')"><app-icon name="eye" [size]="12" /> Preview</button>
          }
        </div>
        <span class="faint tiny lang">{{ languageLabel() }}</span>
        <span class="spacer"></span>
        @if (!isBinary() && mode() !== 'tree' && mode() !== 'preview') {
          <button class="btn btn-ghost btn-icon sm" type="button" [class.active]="wrap()" (click)="wrap.set(!wrap())" title="Toggle word wrap"><app-icon name="wrap" [size]="14" /></button>
        }
        <button class="btn btn-ghost btn-icon sm" type="button" (click)="copy()" title="Copy body" [disabled]="!response().body"><app-icon name="copy" [size]="14" /></button>
        <button class="btn btn-ghost btn-icon sm" type="button" (click)="download()" title="Download body" [disabled]="!response().body"><app-icon name="download" [size]="14" /></button>
      </div>

      <div class="content">
        @if (!response().body) {
          <div class="empty-state">
            <div class="icon-wrap"><app-icon name="inbox" [size]="22" /></div>
            <h3>Empty response body</h3>
            <p>The server returned status {{ response().status }} without content.</p>
          </div>
        } @else if (isBinary() && mode() !== 'preview') {
          <div class="binary">
            <div class="alert info small"><app-icon name="file" [size]="14" /> Binary content ({{ response().contentType || 'unknown type' }}, {{ size() }}). Showing the first 512 bytes.</div>
            <pre class="hex mono">{{ hexDump() }}</pre>
          </div>
        } @else {
          @switch (mode()) {
            @case ('pretty') {
              @if (tooLargeForEditor()) {
                <pre class="raw mono" [class.wrap]="wrap()">{{ pretty() }}</pre>
              } @else {
                <app-monaco-editor [value]="pretty()" [language]="language()" [readOnly]="true" [wordWrap]="wrap()" />
              }
            }
            @case ('raw') {
              <pre class="raw mono" [class.wrap]="wrap()">{{ response().body }}</pre>
            }
            @case ('tree') {
              <div class="tree scroll"><app-json-tree [value]="jsonValue()" /></div>
            }
            @case ('preview') {
              @if (imageUrl(); as src) {
                <div class="image-preview"><img [src]="src" alt="Response image preview" /></div>
              } @else {
                <!-- Sandboxed: no scripts, forms, popups or same-origin access. -->
                <iframe class="html-preview" sandbox="" [srcdoc]="previewHtml()" title="HTML preview" referrerpolicy="no-referrer"></iframe>
              }
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
    }
    .lang {
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-left: 6px;
    }
    .content {
      flex: 1;
      min-height: 0;
      position: relative;
      display: flex;
      flex-direction: column;
      > * {
        flex: 1;
        min-height: 0;
      }
    }
    .raw {
      margin: 0;
      padding: 10px 14px;
      overflow: auto;
      white-space: pre;
      &.wrap {
        white-space: pre-wrap;
        word-break: break-all;
      }
    }
    .tree {
      overflow: auto;
    }
    .binary {
      padding: 12px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .hex {
      margin: 0;
      color: var(--text-dim);
      line-height: 1.6;
    }
    .html-preview {
      border: 0;
      width: 100%;
      height: 100%;
      background: #fff;
    }
    .image-preview {
      display: grid;
      place-items: center;
      padding: 16px;
      overflow: auto;
      background: repeating-conic-gradient(var(--panel-2) 0 25%, var(--panel) 0 50%) 0 0 / 20px 20px;
      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
    }
  `,
})
export class ResponseBodyComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly response = input.required<ProxyResponseData>();
  readonly name = input('response');

  protected readonly mode = signal<ViewMode>('pretty');
  protected readonly wrap = signal(false);

  protected readonly isBinary = computed(() => this.response().bodyEncoding === 'base64');
  protected readonly contentType = computed(() => (this.response().contentType ?? '').toLowerCase());
  protected readonly json = computed(() => {
    const r = this.response();
    if (r.bodyEncoding !== 'utf8' || r.body.length > PRETTY_LIMIT * 2) return { ok: false as const };
    if (!isJsonContentType(r.contentType) && !/^\s*[[{]/.test(r.body)) return { ok: false as const };
    return tryParseJson(r.body);
  });
  protected readonly jsonValue = computed(() => {
    const json = this.json();
    return json.ok ? json.value : null;
  });
  protected readonly language = computed(() => {
    if (this.json().ok) return 'json';
    const ct = this.contentType();
    if (ct.includes('html')) return 'html';
    if (ct.includes('xml')) return 'xml';
    if (ct.includes('javascript')) return 'javascript';
    if (ct.includes('css')) return 'css';
    if (ct.includes('yaml')) return 'yaml';
    return 'plaintext';
  });
  protected readonly languageLabel = computed(() => (this.isBinary() ? 'binary' : this.language() === 'plaintext' ? 'text' : this.language()));
  protected readonly pretty = computed(() => {
    const r = this.response();
    const json = this.json();
    if (json.ok) return JSON.stringify(json.value, null, 2);
    if (this.language() === 'xml' && r.body.length < PRETTY_LIMIT) return formatXml(r.body);
    return r.body;
  });
  protected readonly tooLargeForEditor = computed(() => this.pretty().length > PRETTY_LIMIT);
  protected readonly canPreview = computed(() => this.contentType().includes('html') || this.contentType().startsWith('image/'));
  protected readonly imageUrl = computed<SafeResourceUrl | null>(() => {
    const r = this.response();
    if (!this.contentType().startsWith('image/')) return null;
    const data = r.bodyEncoding === 'base64' ? r.body : btoa(unescape(encodeURIComponent(r.body)));
    // Data URL built from the response bytes with the declared image type.
    return this.sanitizer.bypassSecurityTrustResourceUrl(`data:${this.contentType().split(';')[0]};base64,${data}`);
  });
  // Rendered inside <iframe sandbox="">: scripts, forms, popups and same-origin access are all disabled.
  protected readonly previewHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.response().body));
  protected readonly size = computed(() => formatBytes(this.response().size));
  protected readonly hexDump = computed(() => {
    const bytes = base64ToBytes(this.response().body).subarray(0, 512);
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = Array.from(bytes.subarray(i, i + 16));
      const hex = chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
    }
    return lines.join('\n');
  });

  constructor() {
    effect(() => {
      // Pick a sensible default view whenever a new response arrives.
      const r = this.response();
      this.mode.set(r.bodyEncoding === 'base64' ? (this.contentType().startsWith('image/') ? 'preview' : 'raw') : 'pretty');
    });
  }

  protected copy(): void {
    this.clipboard.copy(this.mode() === 'pretty' ? this.pretty() : this.response().body);
    this.toast.show('Body copied to clipboard', 'success', 1800);
  }

  protected download(): void {
    const r = this.response();
    const file = `${slugify(this.name())}.${extensionFor(r.contentType)}`;
    if (r.bodyEncoding === 'base64') downloadFile(file, base64ToBytes(r.body), r.contentType ?? 'application/octet-stream');
    else downloadFile(file, r.body, r.contentType ?? 'text/plain');
  }
}

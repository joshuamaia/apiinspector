import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { HTTP_METHODS, methodAllowsBody, type AuthConfig, type BodyConfig, type HttpMethod, type KeyValue, type RequestDefinition } from '../../../core/models/request.model';
import { referencedVariables } from '../../../core/utils/interpolate';
import { applyParamsToUrl, syncParamsFromUrl, validateRequestUrl } from '../../../core/utils/url';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { KeyValueEditorComponent } from '../../../shared/components/key-value-editor/key-value-editor.component';
import { AuthEditorComponent } from './auth-editor.component';
import { BodyEditorComponent } from './body-editor.component';

type EditorTab = 'params' | 'headers' | 'auth' | 'body' | 'settings';

/**
 * Request editor shared by the workspace tabs and the flow inspector.
 * Emits a full new definition on every change (immutable updates).
 */
@Component({
  selector: 'app-request-editor',
  imports: [IconComponent, KeyValueEditorComponent, AuthEditorComponent, BodyEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './request-editor.component.html',
  styleUrl: './request-editor.component.scss',
})
export class RequestEditorComponent {
  readonly request = input.required<RequestDefinition>();
  readonly running = input(false);
  readonly showSend = input(true);
  readonly compact = input(false);
  /** Variables known in this context (flows); used to flag unresolved references. */
  readonly knownVariables = input<string[] | null>(null);
  readonly requestChange = output<RequestDefinition>();
  readonly send = output<void>();
  readonly cancel = output<void>();

  protected readonly methods = HTTP_METHODS;
  protected readonly tab = signal<EditorTab>('params');
  protected readonly touchedUrl = signal(false);

  protected readonly paramCount = computed(() => this.request().params.filter((p) => p.enabled && p.key.trim()).length);
  protected readonly headerCount = computed(() => this.request().headers.filter((h) => h.enabled && h.key.trim()).length);
  protected readonly hasAuth = computed(() => this.request().auth.type !== 'none');
  protected readonly hasBody = computed(() => methodAllowsBody(this.request().method) && this.request().body.mode !== 'none');

  protected readonly urlError = computed(() => {
    const url = this.request().url;
    if (!url.trim() || !this.touchedUrl()) return null;
    if (/\{\{[^{}]*\}\}/.test(url)) return null;
    const v = validateRequestUrl(url);
    return v.valid ? null : v.error;
  });

  protected readonly unknownVariables = computed(() => {
    const known = this.knownVariables();
    if (!known) return [];
    const req = this.request();
    const texts = [req.url, ...req.headers.map((h) => h.value), req.auth.token, req.auth.value, req.auth.password, req.body.raw];
    return [...new Set(texts.flatMap((t) => referencedVariables(t ?? '')))].filter((v) => !known.includes(v));
  });

  private emit(patch: Partial<RequestDefinition>): void {
    this.requestChange.emit({ ...this.request(), ...patch });
  }

  protected setMethod(method: HttpMethod): void {
    const req = this.request();
    this.emit({ method });
    if (!methodAllowsBody(method) && this.tab() === 'body' && req.body.mode === 'none') this.tab.set('params');
  }

  protected setUrl(url: string): void {
    this.emit({ url, params: syncParamsFromUrl(url, this.request().params) });
  }

  protected setParams(params: KeyValue[]): void {
    this.emit({ params, url: applyParamsToUrl(this.request().url, params) });
  }

  protected setHeaders(headers: KeyValue[]): void {
    this.emit({ headers });
  }

  protected setAuth(auth: AuthConfig): void {
    this.emit({ auth });
  }

  protected setBody(body: BodyConfig): void {
    this.emit({ body });
  }

  protected setTimeout(value: string): void {
    const n = Number(value);
    this.emit({ settings: { ...this.request().settings, timeoutMs: value.trim() && n > 0 ? Math.round(n) : null } });
  }

  protected setFollowRedirects(followRedirects: boolean): void {
    this.emit({ settings: { ...this.request().settings, followRedirects } });
  }

  protected onUrlKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.touchedUrl.set(true);
      this.send.emit();
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.touchedUrl.set(true);
      this.send.emit();
    }
  }
}

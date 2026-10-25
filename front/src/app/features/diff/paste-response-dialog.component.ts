import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { validateJson } from '../../core/utils/json';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { MonacoEditorComponent } from '../../shared/components/monaco-editor/monaco-editor.component';

export interface PastedResponse {
  label: string;
  body: string;
  status?: number;
}

@Component({
  selector: 'app-paste-response-dialog',
  imports: [IconComponent, MonacoEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dialog wide" role="dialog" aria-label="Paste response">
      <header>
        <app-icon name="file-json" />
        <h2>Paste a response ({{ data.side }})</h2>
      </header>
      <div class="dialog-body">
        <div class="grid">
          <div class="field">
            <label for="pr-label">Label</label>
            <input id="pr-label" class="input" [value]="label()" (input)="label.set($any($event.target).value)" />
          </div>
          <div class="field">
            <label for="pr-status">Status (optional)</label>
            <input id="pr-status" class="input" type="number" [value]="status()" (input)="status.set($any($event.target).value)" placeholder="200" />
          </div>
        </div>
        <div class="editor"><app-monaco-editor [value]="body()" language="json" (valueChange)="body.set($event)" /></div>
        @if (body().trim()) {
          @if (validation().valid) {
            <span class="text-success small"><app-icon name="check-circle" [size]="13" /> Valid JSON — structural comparison</span>
          } @else {
            <span class="text-warning small"><app-icon name="alert" [size]="13" /> Not JSON ({{ validation().error?.message }}) — a text diff will be used</span>
          }
        }
      </div>
      <footer>
        <button class="btn" type="button" (click)="ref.close()">Cancel</button>
        <button class="btn btn-primary" type="button" [disabled]="!body().trim()" (click)="apply()">Use this response</button>
      </footer>
    </div>
  `,
  styles: `
    .wide {
      width: min(860px, calc(100vw - 32px));
    }
    .grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 12px;
    }
    .editor {
      height: 380px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
  `,
})
export class PasteResponseDialogComponent {
  protected readonly data = inject<{ side: string; label: string; body: string }>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<PastedResponse>>(DialogRef);
  protected readonly label = signal(this.data.label);
  protected readonly body = signal(this.data.body);
  protected readonly status = signal('');
  protected readonly validation = computed(() => validateJson(this.body()));

  protected apply(): void {
    const status = Number(this.status());
    this.ref.close({ label: this.label().trim() || `Pasted (${this.data.side})`, body: this.body(), status: status > 0 ? status : undefined });
  }
}

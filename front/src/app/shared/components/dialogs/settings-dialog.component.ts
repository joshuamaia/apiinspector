import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ImportExportService } from '../../../core/services/import-export.service';
import { SecretVaultService } from '../../../core/services/secret-vault.service';
import { SettingsService } from '../../../core/services/settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { HistoryStore } from '../../../core/state/history.store';
import { formatBytes } from '../../../core/utils/format';
import { IconComponent } from '../icon/icon.component';
import { ConfirmService } from './confirm-dialog.component';

@Component({
  selector: 'app-settings-dialog',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="dialog" [formGroup]="form" (ngSubmit)="save()" aria-label="Settings">
      <header>
        <app-icon name="settings" />
        <h2>Settings</h2>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-icon sm" type="button" (click)="ref.close()" aria-label="Close"><app-icon name="x" /></button>
      </header>
      <div class="dialog-body">
        <section>
          <h3>Security</h3>
          <label class="switch">
            <input type="checkbox" formControlName="persistSecrets" />
            Persist secrets encrypted (AES-GCM, non-extractable key)
          </label>
          @if (!vault.available) {
            <div class="alert warning small"><app-icon name="alert" [size]="14" /> WebCrypto needs a secure context (HTTPS or localhost). Secrets will not be saved.</div>
          } @else {
            <p class="faint small">When disabled, tokens, passwords and API keys are kept only in memory. History never stores secrets.</p>
          }
          <div class="field">
            <label for="st-token">BFF access token (optional)</label>
            <input id="st-token" class="input mono" type="password" formControlName="bffToken" placeholder="Required only if the BFF sets ACCESS_TOKEN" autocomplete="off" />
            <span class="hint">Kept in sessionStorage for this tab only.</span>
          </div>
        </section>

        <section>
          <h3>History</h3>
          <div class="grid">
            <div class="field">
              <label for="st-limit">Max entries</label>
              <input id="st-limit" class="input" type="number" min="10" max="5000" formControlName="historyLimit" />
            </div>
            <div class="field">
              <label for="st-body">Stored body limit (KB)</label>
              <input id="st-body" class="input" type="number" min="1" max="10240" formControlName="storedBodyKb" />
            </div>
          </div>
          <div class="row">
            <span class="muted small">{{ history.count() }} executions stored locally</span>
            <span class="spacer"></span>
            <button class="btn btn-danger sm" type="button" (click)="clearHistory()"><app-icon name="trash" [size]="13" /> Clear history</button>
          </div>
        </section>

        <section>
          <h3>Demo data</h3>
          <div class="row">
            <span class="muted small">Recreate demo collections, flow and contract baseline.</span>
            <span class="spacer"></span>
            <button class="btn sm" type="button" (click)="loadDemo()"><app-icon name="sparkles" [size]="13" /> Load demo data</button>
          </div>
        </section>

        @if (api.limits(); as limits) {
          <section>
            <h3>Backend limits</h3>
            <div class="limits">
              <span>Timeout</span><b>{{ limits.timeoutMs / 1000 }} s (max {{ limits.maxTimeoutMs / 1000 }} s)</b>
              <span>Max response</span><b>{{ bytes(limits.maxResponseBytes) }}</b>
              <span>Max request body</span><b>{{ bytes(limits.maxRequestBodyBytes) }}</b>
              <span>Max redirects</span><b>{{ limits.maxRedirects }}</b>
              <span>Concurrent requests</span><b>{{ limits.maxConcurrencyPerClient }} per client</b>
              <span>Private networks</span><b [class.text-danger]="limits.allowPrivateNetworks">{{ limits.allowPrivateNetworks ? 'ALLOWED (dev only)' : 'Blocked' }}</b>
            </div>
          </section>
        }
      </div>
      <footer>
        <button class="btn" type="button" (click)="ref.close()">Cancel</button>
        <button class="btn btn-primary" type="submit" [disabled]="form.invalid">Save settings</button>
      </footer>
    </form>
  `,
  styles: `
    section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
    }
    p {
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .limits {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 16px;
      font-size: 12px;
      span {
        color: var(--text-dim);
      }
      b {
        font-weight: 500;
      }
    }
  `,
})
export class SettingsDialogComponent {
  protected readonly ref = inject(DialogRef);
  protected readonly api = inject(ApiService);
  protected readonly vault = inject(SecretVaultService);
  protected readonly history = inject(HistoryStore);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly importExport = inject(ImportExportService);
  private readonly s = this.settings.settings();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    persistSecrets: [this.s.persistSecrets],
    bffToken: [this.settings.bffToken()],
    historyLimit: [this.s.historyLimit, [Validators.required, Validators.min(10), Validators.max(5000)]],
    storedBodyKb: [Math.round(this.s.storedBodyLimit / 1024), [Validators.required, Validators.min(1), Validators.max(10240)]],
  });

  protected bytes = formatBytes;

  constructor() {
    if (!this.vault.available) this.form.controls.persistSecrets.disable();
  }

  protected save(): void {
    const v = this.form.getRawValue();
    this.settings.update({ persistSecrets: v.persistSecrets, historyLimit: v.historyLimit, storedBodyLimit: v.storedBodyKb * 1024 });
    this.settings.bffToken.set(v.bffToken.trim());
    void this.api.checkHealth();
    this.toast.success('Settings saved');
    this.ref.close();
  }

  protected async clearHistory(): Promise<void> {
    if (await this.confirm.confirm({ title: 'Clear history', message: 'All recorded executions will be deleted. Metrics are calculated from history.', danger: true, confirmLabel: 'Clear' })) {
      await this.history.clear();
      this.toast.success('History cleared');
    }
  }

  protected async loadDemo(): Promise<void> {
    await this.importExport.loadDemo();
    this.toast.success('Demo data loaded');
  }
}

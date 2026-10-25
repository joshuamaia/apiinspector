import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ExecutionService } from '../../core/services/execution.service';
import { SettingsService } from '../../core/services/settings.service';
import { WorkspaceStore } from '../../core/state/workspace.store';
import { RequestActionsService } from '../../features/workspace/request-actions.service';
import { SettingsDialogComponent } from '../../shared/components/dialogs/settings-dialog.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-top-bar',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <button class="btn btn-ghost btn-icon" type="button" (click)="settings.update({ sidebarOpen: !sidebarOpen() })" [class.active]="sidebarOpen()" title="Toggle sidebar" aria-label="Toggle sidebar">
        <app-icon name="sidebar" />
      </button>
      <div class="brand">
        <span class="logo"><app-icon name="logo" [size]="18" [stroke]="2.2" /></span>
        <span class="name">API <b>Inspector</b></span>
      </div>

      <div class="actions">
        <button class="btn sm" type="button" (click)="newRequest()" title="New request (Alt+N)">
          <app-icon name="plus" [size]="14" /> <span class="label">New</span>
        </button>
        <button class="btn sm" type="button" (click)="save()" [disabled]="!workspace.active()" title="Save request (Ctrl+S)">
          <app-icon name="save" [size]="14" /> <span class="label">Save</span>
        </button>
      </div>

      <span class="spacer"></span>

      @if (executor.running()) {
        <span class="running" role="status"><span class="spinner"></span> <span class="label">Running…</span></span>
      }
      <span class="bff" [class.online]="api.bffOnline() === true" [class.offline]="api.bffOnline() === false" [title]="bffTitle()">
        <span class="dot"></span><span class="label">{{ api.bffOnline() === false ? 'BFF offline' : api.bffOnline() ? 'BFF online' : 'BFF…' }}</span>
      </span>
      <button class="btn btn-ghost btn-icon" type="button" (click)="settings.toggleTheme()" [title]="isDark() ? 'Switch to light theme' : 'Switch to dark theme'" aria-label="Toggle theme">
        <app-icon [name]="isDark() ? 'sun' : 'moon'" />
      </button>
      <button class="btn btn-ghost btn-icon" type="button" (click)="openSettings()" title="Settings" aria-label="Settings">
        <app-icon name="settings" />
      </button>
    </header>
  `,
  styles: `
    .topbar {
      height: var(--topbar-h);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elev);
      flex: none;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-right: 12px;
      white-space: nowrap;
    }
    .logo {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      color: #04131a;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      box-shadow: 0 0 18px rgba(45, 212, 191, 0.35);
    }
    .name {
      font-size: 15px;
      letter-spacing: -0.01em;
      b {
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
    }
    .actions {
      display: flex;
      gap: 6px;
    }
    .running {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--accent);
      font-size: 12px;
      padding: 0 8px;
      height: 26px;
      border-radius: 20px;
      background: var(--accent-soft);
    }
    .bff {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: var(--text-dim);
      padding: 0 8px;
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-faint);
      }
      &.online .dot {
        background: var(--success);
        box-shadow: 0 0 8px var(--success);
      }
      &.offline {
        color: var(--danger);
        .dot {
          background: var(--danger);
          animation: pulse 1.2s infinite;
        }
      }
    }
    @media (max-width: 720px) {
      .label {
        display: none;
      }
      .name {
        display: none;
      }
    }
  `,
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class TopBarComponent {
  protected readonly settings = inject(SettingsService);
  protected readonly api = inject(ApiService);
  protected readonly executor = inject(ExecutionService);
  protected readonly workspace = inject(WorkspaceStore);
  private readonly actions = inject(RequestActionsService);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);
  protected readonly isDark = computed(() => this.settings.settings().theme === 'dark');
  protected readonly sidebarOpen = computed(() => this.settings.settings().sidebarOpen);
  protected readonly bffTitle = computed(() => {
    const limits = this.api.limits();
    if (this.api.bffOnline() === false) return 'The backend (BFF) is not reachable';
    if (!limits) return 'Checking backend…';
    return `Timeout ${limits.timeoutMs / 1000}s · max response ${Math.round(limits.maxResponseBytes / 1024 / 1024)} MB · max ${limits.maxRedirects} redirects${limits.allowPrivateNetworks ? ' · PRIVATE NETWORKS ALLOWED' : ''}`;
  });

  protected newRequest(): void {
    this.workspace.newTab();
    void this.router.navigateByUrl('/');
  }

  protected save(): void {
    const tab = this.workspace.active();
    if (tab) void this.actions.save(tab.id);
  }

  protected openSettings(): void {
    this.dialog.open(SettingsDialogComponent, { backdropClass: 'cdk-overlay-dark-backdrop' });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save();
    } else if (event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.newRequest();
    }
  }
}

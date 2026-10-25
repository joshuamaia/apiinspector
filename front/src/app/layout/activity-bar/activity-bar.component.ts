import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  exact?: boolean;
}

@Component({
  selector: 'app-activity-bar',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="activity" aria-label="Main navigation">
      @for (item of items; track item.path) {
        <a
          class="item"
          [routerLink]="item.path"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: !!item.exact }"
          [attr.aria-label]="item.label"
          [title]="item.label"
        >
          <app-icon [name]="item.icon" [size]="19" />
          <span class="label">{{ item.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: `
    .activity {
      width: var(--activity-w);
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 8px 0;
      background: var(--bg-elev);
      border-right: 1px solid var(--border);
    }
    .item {
      position: relative;
      width: 44px;
      height: 46px;
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--text-faint);
      text-decoration: none;
      transition:
        color 0.15s,
        background 0.15s;
      &:hover {
        color: var(--text);
        background: var(--hover);
      }
      &.active {
        color: var(--accent);
        background: var(--accent-soft);
        &::before {
          content: '';
          position: absolute;
          left: -6px;
          top: 10px;
          bottom: 10px;
          width: 3px;
          border-radius: 3px;
          background: var(--accent);
        }
      }
    }
    .label {
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    @media (max-width: 640px) {
      .activity {
        width: 100%;
        height: 56px;
        flex-direction: row;
        justify-content: space-around;
        border-right: 0;
        border-top: 1px solid var(--border);
        padding: 0 4px;
      }
      .item.active::before {
        display: none;
      }
    }
  `,
})
export class ActivityBarComponent {
  protected readonly items: NavItem[] = [
    { path: '/', icon: 'send', label: 'Requests', exact: true },
    { path: '/diff', icon: 'compare', label: 'Diff' },
    { path: '/flows', icon: 'workflow', label: 'Flows' },
    { path: '/drift', icon: 'shield', label: 'Drift' },
    { path: '/metrics', icon: 'chart', label: 'Metrics' },
  ];
}

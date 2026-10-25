import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-toasts',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="t.tone">
          <app-icon [name]="t.tone === 'success' ? 'check-circle' : t.tone === 'danger' ? 'x-circle' : t.tone === 'warning' ? 'alert' : 'info'" [size]="16" />
          <span class="grow">{{ t.message }}</span>
          <button class="btn btn-ghost btn-icon sm" type="button" (click)="toast.dismiss(t.id)" aria-label="Dismiss"><app-icon name="x" [size]="13" /></button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 2000;
      max-width: min(420px, calc(100vw - 32px));
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 8px 8px 12px;
      border-radius: var(--radius);
      background: var(--panel);
      border: 1px solid var(--border-strong);
      box-shadow: var(--shadow);
      animation: slide-in 0.15s ease-out;
      font-size: 12.5px;
      &.success app-icon {
        color: var(--success);
      }
      &.danger app-icon:first-child {
        color: var(--danger);
      }
      &.info app-icon:first-child {
        color: var(--info);
      }
      &.warning app-icon:first-child {
        color: var(--warning);
      }
    }
  `,
})
export class ToastsComponent {
  protected readonly toast = inject(ToastService);
}

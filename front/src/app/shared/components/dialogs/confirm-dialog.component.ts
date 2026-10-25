import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../icon/icon.component';

export interface ConfirmData {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** When set, shows a text input and resolves with its value. */
  prompt?: { label: string; value: string; placeholder?: string };
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="data.title">
      <header>
        <app-icon [name]="data.danger ? 'alert' : data.prompt ? 'edit' : 'info'" [class.text-danger]="data.danger" />
        <h2>{{ data.title }}</h2>
      </header>
      <div class="dialog-body">
        @if (data.message) {
          <p class="muted" style="margin: 0">{{ data.message }}</p>
        }
        @if (data.prompt) {
          <div class="field">
            <label for="prompt-input">{{ data.prompt.label }}</label>
            <input
              id="prompt-input"
              class="input"
              [value]="value()"
              [placeholder]="data.prompt.placeholder ?? ''"
              (input)="value.set($any($event.target).value)"
              (keydown.enter)="confirm()"
              autofocus
            />
          </div>
        }
      </div>
      <footer>
        <button class="btn" type="button" (click)="ref.close(undefined)">Cancel</button>
        <button class="btn" [class.btn-danger]="data.danger" [class.btn-primary]="!data.danger" type="button" (click)="confirm()" [disabled]="!!data.prompt && !value().trim()">
          {{ data.confirmLabel ?? 'Confirm' }}
        </button>
      </footer>
    </div>
  `,
})
export class ConfirmDialogComponent {
  protected readonly data = inject<ConfirmData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string | boolean | undefined>>(DialogRef);
  protected readonly value = signal(this.data.prompt?.value ?? '');

  protected confirm(): void {
    if (this.data.prompt) {
      if (this.value().trim()) this.ref.close(this.value().trim());
    } else {
      this.ref.close(true);
    }
  }
}

/** Promise-based confirm / prompt dialogs built on CDK Dialog. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(Dialog);

  async confirm(data: Omit<ConfirmData, 'prompt'>): Promise<boolean> {
    const ref = this.dialog.open<string | boolean | undefined>(ConfirmDialogComponent, { data, backdropClass: 'cdk-overlay-dark-backdrop' });
    return (await firstValueFrom(ref.closed)) === true;
  }

  async prompt(title: string, label: string, value = '', confirmLabel = 'Save'): Promise<string | null> {
    const ref = this.dialog.open<string | boolean | undefined>(ConfirmDialogComponent, {
      data: { title, message: '', confirmLabel, prompt: { label, value } } satisfies ConfirmData,
      backdropClass: 'cdk-overlay-dark-backdrop',
    });
    const result = await firstValueFrom(ref.closed);
    return typeof result === 'string' ? result : null;
  }
}

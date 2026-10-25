import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { AuthConfig } from '../../../core/models/request.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/** Authorization settings (Reactive Form kept in sync with the request definition). */
@Component({
  selector: 'app-auth-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="auth" [formGroup]="form" (submit)="$event.preventDefault()">
      <div class="field type">
        <label for="auth-type">Type</label>
        <select id="auth-type" class="select" formControlName="type">
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
        </select>
      </div>

      @switch (form.controls.type.value) {
        @case ('none') {
          <p class="muted small note">This request does not use authorization.</p>
        }
        @case ('bearer') {
          <div class="field">
            <label for="auth-token">Token</label>
            <div class="secret">
              <input id="auth-token" class="input mono" [type]="reveal() ? 'text' : 'password'" formControlName="token" placeholder="eyJhbGciOi… or {{ varHint }}" autocomplete="off" spellcheck="false" />
              <ng-container *ngTemplateOutlet="eye" />
            </div>
            <span class="hint">Sent as <code>Authorization: Bearer &lt;token&gt;</code></span>
          </div>
        }
        @case ('basic') {
          <div class="grid">
            <div class="field">
              <label for="auth-user">Username</label>
              <input id="auth-user" class="input" formControlName="username" autocomplete="off" />
            </div>
            <div class="field">
              <label for="auth-pass">Password</label>
              <div class="secret">
                <input id="auth-pass" class="input" [type]="reveal() ? 'text' : 'password'" formControlName="password" autocomplete="new-password" />
                <ng-container *ngTemplateOutlet="eye" />
              </div>
            </div>
          </div>
        }
        @case ('apikey') {
          <div class="grid">
            <div class="field">
              <label for="auth-key">Key</label>
              <input id="auth-key" class="input mono" formControlName="key" placeholder="X-API-Key" autocomplete="off" />
            </div>
            <div class="field">
              <label for="auth-value">Value</label>
              <div class="secret">
                <input id="auth-value" class="input mono" [type]="reveal() ? 'text' : 'password'" formControlName="value" autocomplete="off" />
                <ng-container *ngTemplateOutlet="eye" />
              </div>
            </div>
          </div>
          <div class="field">
            <span class="label">Add to</span>
            <div class="segmented">
              <button type="button" [class.active]="form.controls.addTo.value === 'header'" (click)="form.controls.addTo.setValue('header')">Header</button>
              <button type="button" [class.active]="form.controls.addTo.value === 'query'" (click)="form.controls.addTo.setValue('query')">Query parameter</button>
            </div>
          </div>
        }
      }

      @if (form.controls.type.value !== 'none') {
        <div class="alert info small">
          <app-icon name="lock" [size]="14" />
          <span>
            Credentials go to the BFF in the request body (same origin) and are applied server-side. They are masked in responses and logs, never stored in history,
            and encrypted at rest when you save the request.
          </span>
        </div>
      }
    </form>

    <ng-template #eye>
      <button class="btn btn-ghost btn-icon sm eye" type="button" (click)="reveal.set(!reveal())" [attr.aria-label]="reveal() ? 'Hide secret' : 'Show secret'">
        <app-icon [name]="reveal() ? 'eye-off' : 'eye'" [size]="14" />
      </button>
    </ng-template>
  `,
  styles: `
    .auth {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 720px;
    }
    .type {
      max-width: 260px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .secret {
      position: relative;
      .input {
        padding-right: 36px;
      }
      .eye {
        position: absolute;
        right: 3px;
        top: 3px;
      }
    }
    .note {
      margin: 0;
    }
    @media (max-width: 640px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
  imports: [ReactiveFormsModule, IconComponent, NgTemplateOutlet],
})
export class AuthEditorComponent {
  readonly auth = input.required<AuthConfig>();
  readonly authChange = output<AuthConfig>();
  protected readonly reveal = signal(false);
  protected readonly varHint = '{{token}}';
  protected readonly form = inject(FormBuilder).nonNullable.group({
    type: ['none' as AuthConfig['type']],
    token: [''],
    username: [''],
    password: [''],
    key: [''],
    value: [''],
    addTo: ['header' as AuthConfig['addTo']],
  });

  constructor() {
    effect(() => {
      const auth = this.auth();
      const current = this.form.getRawValue();
      if (JSON.stringify(current) !== JSON.stringify({ ...current, ...auth })) this.form.patchValue(auth, { emitEvent: false });
    });
    this.form.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.authChange.emit(this.form.getRawValue()));
  }
}

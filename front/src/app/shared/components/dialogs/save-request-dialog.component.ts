import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CollectionsStore, type SaveMeta } from '../../../core/state/collections.store';
import { IconComponent } from '../icon/icon.component';

export interface SaveDialogData {
  name: string;
  description: string;
  collectionId: string | null;
  folderId: string | null;
}

const NEW = '__new__';

@Component({
  selector: 'app-save-request-dialog',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="dialog" [formGroup]="form" (ngSubmit)="submit()" aria-label="Save request">
      <header>
        <app-icon name="save" />
        <h2>Save request</h2>
      </header>
      <div class="dialog-body">
        <div class="field">
          <label for="sr-name">Name</label>
          <input id="sr-name" class="input" formControlName="name" placeholder="e.g. List users" autofocus [class.invalid]="form.controls.name.touched && form.controls.name.invalid" />
          @if (form.controls.name.touched && form.controls.name.hasError('required')) {
            <span class="error">Name is required</span>
          }
        </div>
        <div class="field">
          <label for="sr-desc">Description</label>
          <textarea id="sr-desc" class="textarea" formControlName="description" rows="2" placeholder="Optional"></textarea>
        </div>
        <div class="grid">
          <div class="field">
            <label for="sr-col">Collection</label>
            <select id="sr-col" class="select" formControlName="collectionId">
              @for (c of store.collections(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
              <option [value]="NEW">+ New collection…</option>
            </select>
          </div>
          <div class="field">
            <label for="sr-folder">Folder</label>
            <select id="sr-folder" class="select" formControlName="folderId">
              <option value="">(root)</option>
              @for (f of folders(); track f.id) {
                <option [value]="f.id">{{ f.path }}</option>
              }
              <option [value]="NEW">+ New folder…</option>
            </select>
          </div>
        </div>
        @if (creatingCollection()) {
          <div class="field">
            <label for="sr-newcol">New collection name</label>
            <input id="sr-newcol" class="input" formControlName="newCollection" placeholder="My API" />
          </div>
        }
        @if (creatingFolder()) {
          <div class="field">
            <label for="sr-newfolder">New folder name</label>
            <input id="sr-newfolder" class="input" formControlName="newFolder" placeholder="Users" />
          </div>
        }
        <p class="faint small" style="margin: 0">
          <app-icon name="lock" [size]="12" /> Tokens, passwords and API keys are stored encrypted (AES-GCM) and are never exported.
        </p>
      </div>
      <footer>
        <button class="btn" type="button" (click)="ref.close()">Cancel</button>
        <button class="btn btn-primary" type="submit" [disabled]="form.invalid">Save</button>
      </footer>
    </form>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 520px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class SaveRequestDialogComponent {
  protected readonly store = inject(CollectionsStore);
  protected readonly ref = inject<DialogRef<SaveMeta>>(DialogRef);
  private readonly data = inject<SaveDialogData>(DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  protected readonly NEW = NEW;

  protected readonly form = this.fb.nonNullable.group({
    name: [this.data.name, [Validators.required, Validators.maxLength(200)]],
    description: [this.data.description],
    collectionId: [this.data.collectionId ?? this.store.collections()[0]?.id ?? NEW, Validators.required],
    folderId: [this.data.folderId ?? ''],
    newCollection: [''],
    newFolder: [''],
  });

  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly creatingCollection = computed(() => this.values().collectionId === NEW);
  protected readonly creatingFolder = computed(() => this.values().folderId === NEW);
  protected readonly folders = computed(() => {
    const collectionId = this.values().collectionId;
    return this.store
      .folders()
      .filter((f) => f.collectionId === collectionId)
      .map((f) => ({ id: f.id, path: this.store.folderPath(f.id) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  });

  constructor() {
    this.form.controls.collectionId.valueChanges.subscribe((id) => {
      const folder = this.form.controls.folderId;
      folder.setValue('');
      if (id === NEW) folder.disable();
      else folder.enable();
    });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    let collectionId = v.collectionId;
    let folderId: string | null = v.folderId || null;
    if (collectionId === NEW) {
      collectionId = (await this.store.createCollection(v.newCollection || 'My collection')).id;
      folderId = null;
    }
    if (folderId === NEW) {
      folderId = (await this.store.createFolder(collectionId, v.newFolder || 'New folder')).id;
    }
    this.ref.close({ name: v.name, description: v.description, collectionId, folderId });
  }
}

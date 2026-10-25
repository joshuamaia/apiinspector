import { CdkDrag, CdkDragHandle, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { FormField, KeyValue } from '../../../core/models/request.model';
import { headerWarning, suggestHeaders, suggestHeaderValues } from '../../../core/utils/headers';
import { uid } from '../../../core/utils/id';
import { formatBytes } from '../../../core/utils/format';
import { IconComponent } from '../icon/icon.component';

type Row = KeyValue & Partial<Pick<FormField, 'kind' | 'fileName' | 'contentType' | 'base64'>>;
export type KeyValueKind = 'params' | 'headers' | 'form' | 'multipart' | 'variables';

const MAX_FILE_BYTES = 3 * 1024 * 1024;

/**
 * Editable key/value table with enable checkboxes, drag & drop reordering,
 * bulk edit, header autocomplete (CDK Overlay) and file fields for multipart.
 * A trailing blank row is always present; typing into it creates a new entry.
 */
@Component({
  selector: 'app-key-value-editor',
  imports: [IconComponent, CdkDropList, CdkDrag, CdkDragHandle, CdkConnectedOverlay, CdkOverlayOrigin],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './key-value-editor.component.html',
  styleUrl: './key-value-editor.component.scss',
})
export class KeyValueEditorComponent {
  readonly items = input.required<Row[]>();
  readonly kind = input<KeyValueKind>('params');
  readonly keyPlaceholder = input('Key');
  readonly valuePlaceholder = input('Value');
  readonly itemsChange = output<Row[]>();

  protected readonly variableExample = '{{name}}';
  protected readonly bulk = signal(false);
  protected readonly bulkText = signal('');
  protected readonly ghostId = signal(uid());
  protected readonly ac = signal<{ rowId: string; field: 'key' | 'value'; index: number } | null>(null);
  protected readonly fileError = signal<string | null>(null);

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 2 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -2 },
  ];

  protected readonly rows = computed<Row[]>(() => [...this.items(), { id: this.ghostId(), key: '', value: '', enabled: true, kind: 'text' }]);
  protected readonly activeCount = computed(() => this.items().filter((i) => i.enabled && i.key.trim()).length);

  protected readonly suggestions = computed<{ label: string; detail: string }[]>(() => {
    const state = this.ac();
    if (!state || this.kind() !== 'headers') return [];
    const row = this.rows().find((r) => r.id === state.rowId);
    if (!row) return [];
    if (state.field === 'key') {
      return suggestHeaders(row.key)
        .filter((h) => h.name.toLowerCase() !== row.key.trim().toLowerCase())
        .map((h) => ({ label: h.name, detail: h.description }));
    }
    return suggestHeaderValues(row.key, row.value)
      .filter((v) => v !== row.value)
      .map((v) => ({ label: v, detail: '' }));
  });

  protected isGhost(row: Row): boolean {
    return row.id === this.ghostId();
  }

  protected warning(row: Row): string | null {
    return this.kind() === 'headers' ? headerWarning(row.key) : null;
  }

  protected patch(id: string, patch: Partial<Row>): void {
    if (id === this.ghostId()) {
      this.ghostId.set(uid());
      this.itemsChange.emit([...this.items(), { id, key: '', value: '', enabled: true, ...(this.kind() === 'multipart' ? { kind: 'text' } : {}), ...patch }]);
      return;
    }
    this.itemsChange.emit(this.items().map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  protected remove(id: string): void {
    this.itemsChange.emit(this.items().filter((i) => i.id !== id));
  }

  protected drop(event: CdkDragDrop<Row[]>): void {
    const list = [...this.items()];
    if (event.previousIndex >= list.length || event.currentIndex >= list.length) return;
    const [moved] = list.splice(event.previousIndex, 1);
    list.splice(event.currentIndex, 0, moved);
    this.itemsChange.emit(list);
  }

  protected toggleAll(enabled: boolean): void {
    this.itemsChange.emit(this.items().map((i) => ({ ...i, enabled })));
  }

  // ---- autocomplete ----
  protected openAc(rowId: string, field: 'key' | 'value'): void {
    if (this.kind() === 'headers') this.ac.set({ rowId, field, index: 0 });
  }

  protected closeAc(): void {
    // Delay so a click on a suggestion is processed first.
    setTimeout(() => this.ac.set(null), 150);
  }

  protected choose(row: Row, value: string): void {
    const state = this.ac();
    if (!state) return;
    this.patch(row.id, state.field === 'key' ? { key: value } : { value });
    this.ac.set(null);
  }

  protected onKeydown(event: KeyboardEvent, row: Row): void {
    const state = this.ac();
    const list = this.suggestions();
    if (!state || !list.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.ac.set({ ...state, index: (state.index + delta + list.length) % list.length });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (event.key === 'Enter') event.preventDefault();
      this.choose(row, list[state.index].label);
    } else if (event.key === 'Escape') {
      this.ac.set(null);
    }
  }

  protected acOpen(row: Row, field: 'key' | 'value'): boolean {
    const state = this.ac();
    return !!state && state.rowId === row.id && state.field === field && this.suggestions().length > 0;
  }

  // ---- files (multipart) ----
  protected pickFile(row: Row, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      this.fileError.set(`"${file.name}" is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}`);
      return;
    }
    this.fileError.set(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      this.patch(row.id, { kind: 'file', fileName: file.name, contentType: file.type || 'application/octet-stream', base64: result.slice(result.indexOf(',') + 1), value: '' });
    };
    reader.readAsDataURL(file);
  }

  protected fileSize(row: Row): string {
    return row.base64 ? formatBytes(Math.floor((row.base64.length * 3) / 4)) : '';
  }

  // ---- bulk edit ----
  protected toggleBulk(): void {
    if (!this.bulk()) {
      this.bulkText.set(
        this.items()
          .filter((i) => i.kind !== 'file')
          .map((i) => `${i.enabled ? '' : '// '}${i.key}${this.separator()}${i.value}`)
          .join('\n'),
      );
      this.bulk.set(true);
    } else {
      this.applyBulk();
      this.bulk.set(false);
    }
  }

  private separator(): string {
    return this.kind() === 'headers' ? ': ' : '=';
  }

  protected applyBulk(): void {
    const sep = this.kind() === 'headers' ? ':' : '=';
    const files = this.items().filter((i) => i.kind === 'file');
    const existing = this.items();
    const parsed: Row[] = this.bulkText()
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim())
      .map((line, index) => {
        const disabled = line.trimStart().startsWith('//');
        const content = disabled ? line.trimStart().slice(2).trimStart() : line;
        const at = content.indexOf(sep);
        const key = (at < 0 ? content : content.slice(0, at)).trim();
        const value = at < 0 ? '' : content.slice(at + 1).trim();
        return { id: existing[index]?.id ?? uid(), key, value, enabled: !disabled, ...(this.kind() === 'multipart' ? { kind: 'text' as const } : {}) };
      });
    this.itemsChange.emit([...parsed, ...files]);
  }
}

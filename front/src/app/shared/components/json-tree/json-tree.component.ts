import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { jsonTypeOf, pathSegment } from '../../../core/utils/json';
import { IconComponent } from '../icon/icon.component';
import { ToastService } from '../../../core/services/toast.service';

const PAGE = 100;

/** Collapsible JSON tree. Large containers render children in pages of 100. Click a key to copy its JSONPath. */
@Component({
  selector: 'app-json-node',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="node" [style.padding-left.px]="depth() * 16">
      @if (isContainer()) {
        <button class="toggle" type="button" (click)="expanded.set(!expanded())" [attr.aria-expanded]="expanded()">
          <app-icon [name]="expanded() ? 'chevron-down' : 'chevron-right'" [size]="12" />
        </button>
      } @else {
        <span class="toggle-space"></span>
      }
      @if (label() !== null) {
        <button class="key" type="button" [class.index]="isIndex()" (click)="copyPath()" [title]="'Copy path ' + path()">{{ label() }}</button>
        <span class="tok-punct">:&nbsp;</span>
      }
      @if (isContainer()) {
        <span class="tok-punct">{{ type() === 'array' ? '[' : '{' }}</span>
        @if (!expanded()) {
          <button class="summary" type="button" (click)="expanded.set(true)">{{ summary() }}</button>
          <span class="tok-punct">{{ type() === 'array' ? ']' : '}' }}</span>
        }
      } @else {
        <span [class]="'tok-' + type()" class="value">{{ display() }}</span>
      }
    </div>
    @if (isContainer() && expanded()) {
      @for (entry of visibleEntries(); track entry[0]) {
        <app-json-node [value]="entry[1]" [label]="entry[0]" [depth]="depth() + 1" [path]="childPath(entry[0])" [isIndex]="type() === 'array'" [expandDepth]="expandDepth()" />
      }
      @if (entries().length > limit()) {
        <div class="node" [style.padding-left.px]="(depth() + 1) * 16 + 18">
          <button class="more" type="button" (click)="showMore()">Show {{ remaining() }} more…</button>
        </div>
      }
      <div class="node" [style.padding-left.px]="depth() * 16 + 18"><span class="tok-punct">{{ type() === 'array' ? ']' : '}' }}</span></div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .node {
      display: flex;
      align-items: center;
      min-height: 20px;
      white-space: nowrap;
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .toggle,
    .toggle-space {
      width: 18px;
      height: 18px;
      flex: none;
    }
    .toggle {
      border: 0;
      background: transparent;
      color: var(--text-faint);
      cursor: pointer;
      display: inline-grid;
      place-items: center;
      border-radius: 4px;
      padding: 0;
      &:hover {
        background: var(--hover);
        color: var(--text);
      }
    }
    .key {
      border: 0;
      background: transparent;
      padding: 0 2px;
      color: var(--syn-key);
      cursor: copy;
      font: inherit;
      border-radius: 3px;
      &:hover {
        background: var(--hover);
      }
      &.index {
        color: var(--text-faint);
      }
    }
    .value {
      white-space: pre-wrap;
      word-break: break-all;
    }
    .summary,
    .more {
      border: 0;
      background: var(--panel-3);
      color: var(--text-dim);
      font: inherit;
      font-size: 11px;
      padding: 0 6px;
      margin: 0 4px;
      border-radius: 4px;
      cursor: pointer;
    }
  `,
})
export class JsonNodeComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(ToastService);
  readonly value = input<unknown>();
  readonly label = input<string | null>(null);
  readonly isIndex = input(false);
  readonly depth = input(0);
  readonly path = input('$');
  readonly expandDepth = input(2);

  protected readonly type = computed(() => jsonTypeOf(this.value()));
  protected readonly isContainer = computed(() => this.type() === 'object' || this.type() === 'array');
  protected readonly expanded = signal(false);
  protected readonly limit = signal(PAGE);
  protected readonly entries = computed<[string, unknown][]>(() => {
    const v = this.value();
    if (Array.isArray(v)) return v.map((item, i) => [String(i), item]);
    if (v && typeof v === 'object') return Object.entries(v);
    return [];
  });
  protected readonly visibleEntries = computed(() => this.entries().slice(0, this.limit()));
  protected readonly remaining = computed(() => Math.min(PAGE, this.entries().length - this.limit()));
  protected readonly summary = computed(() => {
    const n = this.entries().length;
    return this.type() === 'array' ? `${n} item${n === 1 ? '' : 's'}` : `${n} key${n === 1 ? '' : 's'}`;
  });
  protected readonly display = computed(() => JSON.stringify(this.value()));

  constructor() {
    queueMicrotask(() => this.expanded.set(this.depth() < this.expandDepth() && this.entries().length <= 200));
  }

  protected showMore(): void {
    this.limit.update((n) => n + PAGE);
  }

  protected childPath(key: string): string {
    return this.type() === 'array' ? `${this.path()}[${key}]` : `${this.path()}${pathSegment(key)}`;
  }

  protected copyPath(): void {
    this.clipboard.copy(this.path());
    this.toast.show(`Copied ${this.path()}`, 'info', 1800);
  }
}

@Component({
  selector: 'app-json-tree',
  imports: [JsonNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="tree"><app-json-node [value]="value()" [expandDepth]="expandDepth()" /></div>`,
  styles: `
    .tree {
      padding: 8px 12px;
    }
  `,
})
export class JsonTreeComponent {
  readonly value = input<unknown>();
  readonly expandDepth = input(2);
}

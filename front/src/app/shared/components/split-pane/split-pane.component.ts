import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal } from '@angular/core';

/** Two resizable panes separated by a draggable gutter (pointer + keyboard). Size is remembered per `storageKey`. */
@Component({
  selector: 'app-split-pane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pane pane-a" [style.flex-basis.%]="size()"><ng-content select="[paneA]" /></div>
    <div
      class="gutter"
      role="separator"
      tabindex="0"
      [attr.aria-orientation]="direction() === 'horizontal' ? 'vertical' : 'horizontal'"
      [attr.aria-valuenow]="size()"
      (pointerdown)="start($event)"
      (dblclick)="reset()"
      (keydown)="keydown($event)"
      title="Drag to resize · double-click to reset"
    ></div>
    <div class="pane pane-b"><ng-content select="[paneB]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 0;
      min-width: 0;
    }
    :host(.vertical) {
      flex-direction: column;
    }
    .pane {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pane-a {
      flex-grow: 0;
      flex-shrink: 0;
    }
    .pane-b {
      flex: 1 1 0;
    }
    .gutter {
      flex: none;
      width: 5px;
      cursor: col-resize;
      background: var(--border);
      position: relative;
      transition: background 0.15s;
      touch-action: none;
      &:hover,
      &:focus-visible,
      &.dragging {
        background: var(--accent);
      }
    }
    :host(.vertical) .gutter {
      width: auto;
      height: 5px;
      cursor: row-resize;
    }
  `,
  host: { '[class.vertical]': "direction() === 'vertical'" },
})
export class SplitPaneComponent {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly direction = input<'horizontal' | 'vertical'>('horizontal');
  readonly initial = input(50);
  readonly min = input(15);
  readonly max = input(85);
  readonly storageKey = input<string | null>(null);
  protected readonly size = signal(50);

  constructor() {
    effect(() => {
      const key = this.storageKey();
      let stored: number | null = null;
      try {
        stored = key ? Number(localStorage.getItem(`split.${key}.${this.direction()}`)) || null : null;
      } catch {
        stored = null;
      }
      this.size.set(stored ?? this.initial());
    });
  }

  private persist(): void {
    const key = this.storageKey();
    try {
      if (key) localStorage.setItem(`split.${key}.${this.direction()}`, String(this.size()));
    } catch {
      /* ignore */
    }
  }

  private clamp(v: number): number {
    return Math.min(this.max(), Math.max(this.min(), v));
  }

  protected start(event: PointerEvent): void {
    const gutter = event.target as HTMLElement;
    gutter.setPointerCapture(event.pointerId);
    gutter.classList.add('dragging');
    const rect = this.el.nativeElement.getBoundingClientRect();
    const horizontal = this.direction() === 'horizontal';
    const move = (e: PointerEvent) => {
      const ratio = horizontal ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      this.size.set(this.clamp(Math.round(ratio * 1000) / 10));
    };
    const end = () => {
      gutter.classList.remove('dragging');
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', end);
      gutter.removeEventListener('pointercancel', end);
      this.persist();
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', end);
    gutter.addEventListener('pointercancel', end);
    event.preventDefault();
  }

  protected keydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 10 : 2;
    const dec = this.direction() === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const inc = this.direction() === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === dec || event.key === inc) {
      event.preventDefault();
      this.size.set(this.clamp(this.size() + (event.key === inc ? step : -step)));
      this.persist();
    }
  }

  protected reset(): void {
    this.size.set(this.initial());
    this.persist();
  }
}

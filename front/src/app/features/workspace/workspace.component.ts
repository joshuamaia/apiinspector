import { CdkDrag, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { RequestDefinition } from '../../core/models/request.model';
import { SettingsService } from '../../core/services/settings.service';
import { WorkspaceStore, type RequestTab } from '../../core/state/workspace.store';
import { ConfirmService } from '../../shared/components/dialogs/confirm-dialog.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SplitPaneComponent } from '../../shared/components/split-pane/split-pane.component';
import { RequestActionsService } from './request-actions.service';
import { RequestEditorComponent } from './request-editor/request-editor.component';
import { ResponseViewerComponent } from './response-viewer/response-viewer.component';

@Component({
  selector: 'app-workspace',
  imports: [IconComponent, RequestEditorComponent, ResponseViewerComponent, SplitPaneComponent, CdkDropList, CdkDrag, CdkMenu, CdkMenuItem, CdkContextMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="workspace">
      <div class="tab-strip">
        <div class="tab-list" cdkDropList cdkDropListOrientation="horizontal" cdkDropListLockAxis="x" (cdkDropListDropped)="drop($event)" role="tablist">
          @for (tab of store.tabs(); track tab.id) {
            <div
              class="req-tab"
              cdkDrag
              role="tab"
              [attr.aria-selected]="tab.id === store.activeId()"
              [class.active]="tab.id === store.activeId()"
              (click)="store.select(tab.id)"
              (auxclick)="$event.button === 1 && close(tab)"
              [title]="tab.draft.url || tab.name"
              [cdkContextMenuTriggerFor]="tabMenu"
              [cdkContextMenuTriggerData]="{ $implicit: tab }"
            >
              <span class="method" [class]="tab.draft.method">{{ tab.draft.method === 'DELETE' ? 'DEL' : tab.draft.method === 'OPTIONS' ? 'OPT' : tab.draft.method }}</span>
              <span class="name ellipsis">{{ tab.name }}</span>
              @if (tab.running) {
                <span class="spinner tiny-spin"></span>
              } @else if (tab.dirty) {
                <span class="dirty" title="Unsaved changes"></span>
              }
              <button class="close" type="button" (click)="$event.stopPropagation(); close(tab)" aria-label="Close tab"><app-icon name="x" [size]="12" /></button>
            </div>
          }
        </div>
        <button class="btn btn-ghost btn-icon sm new" type="button" (click)="store.newTab()" title="New tab (Alt+N)" aria-label="New tab"><app-icon name="plus" [size]="15" /></button>
        <span class="spacer"></span>
        <div class="segmented layout-toggle" aria-label="Layout">
          <button type="button" [class.active]="layout() === 'horizontal'" (click)="settings.update({ layout: 'horizontal' })" title="Side by side"><app-icon name="columns" [size]="13" /></button>
          <button type="button" [class.active]="layout() === 'vertical'" (click)="settings.update({ layout: 'vertical' })" title="Stacked"><app-icon name="rows" [size]="13" /></button>
        </div>
      </div>

      <ng-template #tabMenu let-tab>
        <div class="menu" cdkMenu>
          <button class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="rename(tab)"><app-icon name="edit" [size]="14" /> Rename</button>
          <button class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="actions.save(tab.id)"><app-icon name="save" [size]="14" /> Save</button>
          <button class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="actions.save(tab.id, true)"><app-icon name="copy" [size]="14" /> Save as…</button>
          <button class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="store.duplicate(tab.id)"><app-icon name="layers" [size]="14" /> Duplicate tab</button>
          <div class="menu-separator"></div>
          <button class="menu-item" cdkMenuItem (cdkMenuItemTriggered)="store.closeOthers(tab.id)"><app-icon name="x" [size]="14" /> Close others</button>
          <button class="menu-item danger" cdkMenuItem (cdkMenuItemTriggered)="close(tab)"><app-icon name="x" [size]="14" /> Close</button>
        </div>
      </ng-template>

      @if (store.active(); as tab) {
        <app-split-pane class="split" [direction]="effectiveLayout()" [initial]="effectiveLayout() === 'horizontal' ? 50 : 45" storageKey="workspace" [min]="20" [max]="80">
          <div paneA class="pane-card">
            <app-request-editor [request]="tab.draft" [running]="tab.running" (requestChange)="update(tab, $event)" (send)="send(tab)" (cancel)="store.cancel(tab.id)" />
          </div>
          <div paneB class="pane-card">
            <app-response-viewer [record]="tab.lastExecution" [running]="tab.running" (cancel)="store.cancel(tab.id)" (retry)="send(tab)" />
          </div>
        </app-split-pane>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    .workspace {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .tab-strip {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 42px;
      padding: 0 8px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elev);
      flex: none;
    }
    .tab-list {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 100%;
      overflow-x: auto;
      scrollbar-width: none;
      min-width: 0;
      &::-webkit-scrollbar {
        display: none;
      }
    }
    .req-tab {
      display: flex;
      align-items: center;
      gap: 7px;
      height: 34px;
      max-width: 220px;
      min-width: 120px;
      padding: 0 6px 0 12px;
      border: 1px solid transparent;
      border-bottom: 0;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      color: var(--text-dim);
      font-size: 12.5px;
      user-select: none;
      background: transparent;
      position: relative;
      &:hover {
        background: var(--hover);
        color: var(--text);
        .close {
          opacity: 1;
        }
      }
      &.active {
        background: var(--bg);
        border-color: var(--border);
        color: var(--text);
        &::after {
          content: '';
          position: absolute;
          left: -1px;
          right: -1px;
          top: -1px;
          height: 2px;
          border-radius: 2px 2px 0 0;
          background: var(--accent);
        }
        .close {
          opacity: 1;
        }
      }
      .method {
        font-size: 9.5px;
      }
      .name {
        flex: 1;
      }
    }
    .cdk-drag-preview.req-tab {
      background: var(--panel);
      box-shadow: var(--shadow);
      border-radius: 8px;
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
    }
    .dirty {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--warning);
      flex: none;
    }
    .tiny-spin {
      width: 10px;
      height: 10px;
      color: var(--accent);
    }
    .close {
      opacity: 0;
      border: 0;
      background: transparent;
      color: var(--text-faint);
      width: 20px;
      height: 20px;
      border-radius: 5px;
      display: grid;
      place-items: center;
      cursor: pointer;
      padding: 0;
      &:hover {
        background: var(--hover);
        color: var(--text);
      }
    }
    .split {
      flex: 1;
      min-height: 0;
      padding: 8px;
      gap: 0;
    }
    .pane-card {
      flex: 1;
      min-height: 0;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      margin: 2px;
    }
    @media (max-width: 900px) {
      .layout-toggle {
        display: none;
      }
    }
  `,
})
export class WorkspaceComponent {
  protected readonly store = inject(WorkspaceStore);
  protected readonly settings = inject(SettingsService);
  protected readonly actions = inject(RequestActionsService);
  private readonly confirm = inject(ConfirmService);
  protected readonly layout = computed(() => this.settings.settings().layout);
  protected readonly effectiveLayout = computed<'horizontal' | 'vertical'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 900 ? 'vertical' : this.layout(),
  );

  protected update(tab: RequestTab, draft: RequestDefinition): void {
    this.store.updateDraft(tab.id, draft);
  }

  protected send(tab: RequestTab): void {
    void this.store.send(tab.id);
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    this.store.reorder(event.previousIndex, event.currentIndex);
  }

  protected async close(tab: RequestTab): Promise<void> {
    if (tab.dirty && tab.draft.url) {
      const ok = await this.confirm.confirm({ title: 'Close tab', message: `"${tab.name}" has unsaved changes. Close anyway?`, confirmLabel: 'Close', danger: true });
      if (!ok) return;
    }
    this.store.close(tab.id);
  }

  protected async rename(tab: RequestTab): Promise<void> {
    const name = await this.confirm.prompt('Rename tab', 'Name', tab.name, 'Rename');
    if (name) this.store.rename(tab.id, name);
  }
}

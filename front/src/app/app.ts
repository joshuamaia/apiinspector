import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BootstrapService } from './core/services/bootstrap.service';
import { SettingsService } from './core/services/settings.service';
import { ActivityBarComponent } from './layout/activity-bar/activity-bar.component';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { TopBarComponent } from './layout/top-bar/top-bar.component';
import { IconComponent } from './shared/components/icon/icon.component';
import { ToastsComponent } from './shared/components/toasts/toasts.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopBarComponent, ActivityBarComponent, SidebarComponent, ToastsComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly boot = inject(BootstrapService);
  private readonly settings = inject(SettingsService);
  protected readonly sidebarOpen = computed(() => this.settings.settings().sidebarOpen);

  constructor() {
    void this.boot.init();
  }

  protected closeSidebarOnMobile(): void {
    if (window.matchMedia('(max-width: 900px)').matches) this.settings.update({ sidebarOpen: false });
  }
}

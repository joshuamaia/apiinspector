import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import type { Chart, ChartConfiguration } from 'chart.js';

type ChartModule = typeof import('chart.js');
let chartModule: Promise<ChartModule> | null = null;

/** Chart.js loaded on demand (keeps it out of the initial bundle). */
function loadChartJs(): Promise<ChartModule> {
  chartModule ??= import('chart.js').then((m) => {
    m.Chart.register(...m.registerables);
    return m;
  });
  return chartModule;
}

@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas [attr.aria-label]="label()" role="img"></canvas>`,
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
  `,
})
export class ChartComponent {
  readonly config = input.required<ChartConfiguration>();
  readonly label = input('Chart');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart | null = null;
  private chartType: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
    effect(() => {
      const config = this.config();
      const canvas = this.canvas().nativeElement;
      void loadChartJs().then(({ Chart }) => {
        if (this.chart && this.chartType === config.type) {
          this.chart.data = config.data;
          this.chart.options = config.options ?? {};
          this.chart.update();
        } else {
          this.chart?.destroy();
          this.chart = new Chart(canvas, { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options } });
          this.chartType = config.type;
        }
      });
    });
  }
}

import { Routes } from '@angular/router';
import { WorkspaceComponent } from './features/workspace/workspace.component';

export const routes: Routes = [
  { path: '', component: WorkspaceComponent, title: 'API Inspector' },
  { path: 'diff', loadComponent: () => import('./features/diff/diff-page.component').then((m) => m.DiffPageComponent), title: 'Smart API Diff · API Inspector' },
  { path: 'flows', loadComponent: () => import('./features/flows/flows-page.component').then((m) => m.FlowsPageComponent), title: 'API Flow · API Inspector' },
  { path: 'drift', loadComponent: () => import('./features/drift/drift-page.component').then((m) => m.DriftPageComponent), title: 'Contract Drift · API Inspector' },
  { path: 'metrics', loadComponent: () => import('./features/metrics/metrics-page.component').then((m) => m.MetricsPageComponent), title: 'Metrics · API Inspector' },
  { path: '**', redirectTo: '' },
];

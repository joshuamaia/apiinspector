import { Injectable, signal } from '@angular/core';
import { uid } from '../utils/id';

export type ToastTone = 'success' | 'danger' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  show(message: string, tone: ToastTone = 'info', durationMs = 3200): void {
    const toast = { id: uid(), tone, message };
    this.toasts.update((list) => [...list.slice(-4), toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'danger', 5000);
  }

  dismiss(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

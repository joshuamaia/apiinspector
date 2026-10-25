import { Injectable, inject, signal } from '@angular/core';
import type { ProxyErrorInfo, ProxyFailure, ProxyLimits, ProxySuccess } from '../models/proxy.model';
import type { ProxyPayload } from '../utils/request';
import { SettingsService } from './settings.service';

export type ProxyResult =
  | { ok: true; data: ProxySuccess; elapsedMs: number }
  | { ok: false; error: ProxyErrorInfo; startedAt: string; elapsedMs: number };

const API_BASE = '/api';

/** Client of the BFF. All target API calls go through `POST /api/proxy/execute`. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly settings = inject(SettingsService);
  readonly bffOnline = signal<boolean | null>(null);
  readonly limits = signal<ProxyLimits | null>(null);

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.settings.bffToken();
    if (token) headers['x-api-inspector-token'] = token;
    return headers;
  }

  async execute(payload: ProxyPayload, signal?: AbortSignal): Promise<ProxyResult> {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const elapsed = () => Math.round((performance.now() - started) * 100) / 100;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/proxy/execute`, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload), signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { ok: false, startedAt, elapsedMs: elapsed(), error: { kind: 'CANCELLED', message: 'Request cancelled', statusCode: 0 } };
      }
      this.bffOnline.set(false);
      return {
        ok: false,
        startedAt,
        elapsedMs: elapsed(),
        error: { kind: 'BFF_UNREACHABLE', message: 'Could not reach the API Inspector backend (BFF). Is it running?', statusCode: 0 },
      };
    }

    let body: ProxySuccess | ProxyFailure | null = null;
    try {
      body = (await res.json()) as ProxySuccess | ProxyFailure;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { ok: false, startedAt, elapsedMs: elapsed(), error: { kind: 'CANCELLED', message: 'Request cancelled', statusCode: 0 } };
      }
      body = null;
    }
    this.bffOnline.set(true);
    if (body && body.ok === true) return { ok: true, data: body, elapsedMs: elapsed() };
    if (body && body.ok === false) return { ok: false, startedAt: body.startedAt, error: body.error, elapsedMs: elapsed() };
    return {
      ok: false,
      startedAt,
      elapsedMs: elapsed(),
      error: { kind: 'BFF_UNREACHABLE', message: `Unexpected response from the backend (HTTP ${res.status})`, statusCode: res.status },
    };
  }

  async checkHealth(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/health`, { headers: this.headers() });
      this.bffOnline.set(res.ok);
      if (res.ok) {
        const limits = await fetch(`${API_BASE}/proxy/limits`, { headers: this.headers() });
        if (limits.ok) this.limits.set((await limits.json()) as ProxyLimits);
      }
    } catch {
      this.bffOnline.set(false);
    }
  }
}

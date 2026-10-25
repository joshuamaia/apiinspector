import { Injectable, inject } from '@angular/core';
import type { EncryptedBlob } from '../models/collection.model';
import type { RequestDefinition } from '../models/request.model';
import { mergeSecrets, splitSecrets, type RequestSecrets } from '../utils/request';
import { DbService } from './db.service';
import { SettingsService } from './settings.service';

const KEY_ID = 'vault-key';

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encrypts secrets at rest with AES-GCM. The key is generated as
 * NON-EXTRACTABLE and stored in IndexedDB, so the raw key material never
 * appears in storage or exports. WebCrypto requires a secure context
 * (https or localhost); without it secrets are simply not persisted.
 */
@Injectable({ providedIn: 'root' })
export class SecretVaultService {
  private readonly db = inject(DbService);
  private readonly settings = inject(SettingsService);
  private keyPromise: Promise<CryptoKey> | null = null;

  get available(): boolean {
    return typeof crypto !== 'undefined' && !!crypto.subtle && globalThis.isSecureContext !== false;
  }

  get enabled(): boolean {
    return this.available && this.settings.settings().persistSecrets;
  }

  private key(): Promise<CryptoKey> {
    this.keyPromise ??= (async () => {
      const existing = await this.db.getKv<CryptoKey>(KEY_ID);
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await this.db.setKv(KEY_ID, key);
      return key;
    })();
    return this.keyPromise;
  }

  async encrypt(value: unknown): Promise<EncryptedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(value));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.key(), data);
    return { iv: toBase64(iv), data: toBase64(cipher) };
  }

  async decrypt<T>(blob: EncryptedBlob): Promise<T | null> {
    if (!this.available) return null;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, await this.key(), fromBase64(blob.data));
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      return null;
    }
  }

  /** Splits a request into a secret-free definition plus an encrypted blob (or none when disabled). */
  async seal(def: RequestDefinition): Promise<{ def: RequestDefinition; secrets: EncryptedBlob | null }> {
    const { publicDef, secrets } = splitSecrets(def);
    if (!secrets || !this.enabled) return { def: publicDef, secrets: null };
    return { def: publicDef, secrets: await this.encrypt(secrets) };
  }

  async unseal(def: RequestDefinition, blob: EncryptedBlob | null | undefined): Promise<RequestDefinition> {
    if (!blob) return def;
    return mergeSecrets(def, await this.decrypt<RequestSecrets>(blob));
  }

  /** Seals many definitions at once into a single blob keyed by id (used by flows). */
  async sealMany(defs: Record<string, RequestDefinition>): Promise<{ defs: Record<string, RequestDefinition>; secrets: EncryptedBlob | null }> {
    const publicDefs: Record<string, RequestDefinition> = {};
    const all: Record<string, RequestSecrets> = {};
    for (const [id, def] of Object.entries(defs)) {
      const { publicDef, secrets } = splitSecrets(def);
      publicDefs[id] = publicDef;
      if (secrets) all[id] = secrets;
    }
    if (!Object.keys(all).length || !this.enabled) return { defs: publicDefs, secrets: null };
    return { defs: publicDefs, secrets: await this.encrypt(all) };
  }

  async unsealMany(defs: Record<string, RequestDefinition>, blob: EncryptedBlob | null | undefined): Promise<Record<string, RequestDefinition>> {
    if (!blob) return defs;
    const all = (await this.decrypt<Record<string, RequestSecrets>>(blob)) ?? {};
    return Object.fromEntries(Object.entries(defs).map(([id, def]) => [id, mergeSecrets(def, all[id] ?? null)]));
  }
}

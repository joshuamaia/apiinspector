import type { RequestDefinition } from './request.model';

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  /** Demo collections are recreated on demand and flagged in the UI. */
  demo?: boolean;
}

export interface Folder {
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  createdAt: number;
}

/** Encrypted payload produced by the crypto service. */
export interface EncryptedBlob {
  iv: string;
  data: string;
}

export interface SavedRequest extends RequestDefinition {
  id: string;
  name: string;
  description: string;
  collectionId: string;
  folderId: string | null;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  /** Secrets (auth, sensitive headers/params) encrypted at rest; never plain text. */
  secrets?: EncryptedBlob | null;
}

/** Application export format (`api-inspector`). Secrets are never exported. */
export interface ExportBundle {
  format: 'api-inspector';
  version: 1;
  exportedAt: string;
  collections: Collection[];
  folders: Folder[];
  requests: Omit<SavedRequest, 'secrets'>[];
  flows?: unknown[];
  baselines?: unknown[];
}

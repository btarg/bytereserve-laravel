export const SCHEMAS = {
    files: 'id, name, type, path, folder_id, mime_type, size, pending_upload, created_at, updated_at',
    folders: 'id, name, path, parent_id, size, created_at, updated_at',
    syncInfo: 'key'
};

// Model definitions for sync endpoints
export const MODEL_DEFINITIONS = {
    files: {
        schema: SCHEMAS.files,
        endpoint: 'explorer.index',
        syncEndpoint: 'explorer.files.sync'
    },
    folders: {
        schema: SCHEMAS.folders,
        endpoint: 'explorer.index',
        syncEndpoint: 'explorer.folders.sync'
    }
};

// Database version - increment when schema changes
export const DB_VERSION = 1;

// Database name
export const DB_NAME = 'chirperFileDB';

// Interface definitions for type safety
export interface FileRecord {
    id?: string | number;
    name: string;
    type: 'file';
    path: string;
    folder_id: number | null;
    mime_type: string | null;
    size: number;
    pending_upload?: boolean;
    local_blob?: Blob;
    created_at?: number;
    updated_at?: number;
}

export interface FolderRecord {
    id?: string | number;
    name: string;
    type: 'folder';
    path?: string;
    parent_id: number | null;
    size: number;
    created_at?: number;
    updated_at?: number;
}

export interface SyncInfoRecord {
    key: string;
    timestamp: number;
}
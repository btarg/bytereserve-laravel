export const DB_NAME = 'chirperFileDB';

// id always has to be first in the schema!
export const SCHEMAS = {
    files: {
        1: 'id, type, name, path, folder_id, mime_type, size, pending_upload, created_at, updated_at',
        2: 'id, type, name, path, folder_id, mime_type, size, pending_upload, created_at, updated_at, hash',
    },
    folders: {
        1: 'id, type, name, path, parent_id, size, created_at, updated_at'

    },
    syncInfo: 'key'
};

export const LATEST_VERSIONS = Object.entries(SCHEMAS).reduce((versions, [tableName, tableSchemas]) => {
    // Skip non-versioned tables like syncInfo
    if (typeof tableSchemas === 'string') {
        return versions;
    }

    // Get the highest version number from the schema keys
    const latestVersion = Math.max(
        ...Object.keys(tableSchemas)
            .map(v => parseInt(v, 10))
            .filter(v => !isNaN(v))
    );

    return {
        ...versions,
        [tableName]: latestVersion
    };
}, {} as Record<string, number>);

// Model definitions for sync endpoints - use the latest version for each table
export const MODEL_DEFINITIONS = {
    files: {
        schema: SCHEMAS.files[LATEST_VERSIONS.files],
        endpoint: 'explorer.index',
        syncEndpoint: 'explorer.files.sync'
    },
    folders: {
        schema: SCHEMAS.folders[LATEST_VERSIONS.folders],
        endpoint: 'explorer.index',
        syncEndpoint: 'explorer.folders.sync'
    }
};


export interface FileRecord {
    id?: string | number;
    type: 'file';
    name: string;
    path: string;
    folder_id: number | null;
    mime_type: string | null;
    size: number;
    pending_upload?: boolean;
    local_blob?: Blob;
    created_at?: number;
    updated_at?: number;
    hash: string;
}

export interface FolderRecord {
    id?: string | number;
    type: 'folder';
    name: string;
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
import { route } from 'ziggy-js';
import dbService from './Database';
import { DB_NAME, MODEL_DEFINITIONS } from './Schemas';

// Initialize database
export async function initializeDatabase() {
    console.log('Starting database initialization with version-controlled schema');

    try {
        await dbService.initialize(DB_NAME, MODEL_DEFINITIONS);
        console.log('Database initialized successfully');

        // Register sync handlers for each model
        Object.entries(MODEL_DEFINITIONS).forEach(([modelName, definition]) => {
            if (definition.syncEndpoint) {
                dbService.registerSyncHandler(modelName, async (lastSync) => {
                    return syncModel(modelName, definition.syncEndpoint, lastSync);
                });
            }
        });

        return dbService;
    } catch (error) {
        console.error('Failed to initialize database:', error);
        throw error;
    }
}

// Generic sync function for any model
async function syncModel(modelName: string, syncEndpoint: string, lastSync: number) {
    try {
        const response = await window.cacheFetch.fetch(
            route(syncEndpoint) + '?' + new URLSearchParams({
                since: lastSync.toString()
            }).toString(),
            {
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin'
            }
        );

        if (!response.ok) {
            // Create a more informative error with status code
            const errorText = await response.text();
            console.error(`Sync error (${response.status}):`, errorText);
            throw new Error(`Server returned ${response.status}: ${errorText.substring(0, 100)}`);
        }

        const changes = await response.json();

        // Apply changes to the database
        await dbService.db.transaction('rw', dbService.db[modelName], async () => {
            // Process changes
            if (changes.items && changes.items.length > 0) {
                for (const item of changes.items) {
                    if (item.deleted) {
                        // Check if item exists before trying to delete
                        const exists = await dbService.db[modelName].get(item.id);
                        if (exists) {
                            await dbService.db[modelName].delete(item.id);
                        }
                    } else {
                        await dbService.db[modelName].put(item);
                    }
                }
            }
        });

        return { timestamp: changes.timestamp };
    } catch (error) {
        console.error(`Sync failed for ${modelName}:`, error);
        // Allow retrying later by returning current time
        return { timestamp: lastSync };
    }
}

export async function getItemsByPath(path: string, forceSync = false) {
    if (!dbService.initialized || !dbService.db) {
        throw new Error('Database not initialized');
    }

    try {
        // Only sync with server if explicitly requested
        if (forceSync) {
            try {
                await dbService.syncAll();
            } catch (error) {
                console.warn('Failed to sync before fetching items, using cached data', error);
            }
        }
        
        // For root path, get items with null folder_id/parent_id
        if (path === '/') {
            // Use filter function rather than equals() for null values
            const [files, folders] = await Promise.all([
                dbService.db.table('files')
                    .filter(file => file.folder_id === null)
                    .toArray(),
                dbService.db.table('folders')
                    .filter(folder => folder.parent_id === null)
                    .toArray()
            ]);
            
            return {
                items: [
                    ...files.map(file => ({ ...file, type: 'file' })),
                    ...folders.map(folder => ({ ...folder, type: 'folder' }))
                ],
                current_folder_id: null
            };
        } else {
            // For subfolder, first find the folder by its path
            const segments = path.split('/').filter(Boolean);
            const folderName = segments[segments.length - 1];
            
            // Find the folder - first try by path
            let currentFolder = await dbService.db.table('folders')
                .filter(folder => folder.path === path || `/${folder.path}` === path)
                .first();
                
            // If not found by path, try by name (less reliable but fallback)
            if (!currentFolder) {
                currentFolder = await dbService.db.table('folders')
                    .filter(folder => folder.name === folderName)
                    .first();
            }
            
            if (!currentFolder) {
                // If not found locally, return empty result
                return { items: [], current_folder_id: null };
            }
            
            // Get files and subfolders for this folder using filter instead of equals for stability
            const [files, subfolders] = await Promise.all([
                dbService.db.table('files')
                    .filter(file => file.folder_id === currentFolder.id)
                    .toArray(),
                dbService.db.table('folders')
                    .filter(folder => folder.parent_id === currentFolder.id)
                    .toArray()
            ]);
            
            return {
                items: [
                    ...files.map(file => ({ ...file, type: 'file' })),
                    ...subfolders.map(folder => ({ ...folder, type: 'folder' }))
                ],
                current_folder_id: currentFolder.id
            };
        }
    } catch (error) {
        console.error('Error fetching items from IndexedDB:', error);
        throw error;
    }
}

// Export repositories for each model
export const Files = () => dbService.repository('files');
export const Folders = () => dbService.repository('folders');

export default {
    initializeDatabase,
    Files,
    Folders,
    getItemsByPath
};
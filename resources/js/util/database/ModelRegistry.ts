import { route } from 'ziggy-js';
import dbService from './Database';
import { DB_NAME, MODEL_DEFINITIONS } from './Schemas';

export async function initializeDatabase() {
    console.log('Starting database initialization with version-controlled schema');

    try {
        // Initialize the database structure
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

        // Perform initial data load from server (always sync after fresh initialization)
        // Check if database is empty first to avoid unnecessary syncs
        const filesCount = await dbService.db.table('files').count();
        const foldersCount = await dbService.db.table('folders').count();
        
        if (filesCount === 0 && foldersCount === 0) {
            console.log('Empty database detected - performing initial data sync from server');
            try {
                // Force timestamp to 0 to get all data
                await dbService.db.table('syncInfo').put({ key: 'lastSync', timestamp: 0 });
                await dbService.syncAll();
                console.log('Initial data sync completed');
            } catch (syncError) {
                console.error('Initial data sync failed:', syncError);
                // Continue even if sync fails - app can retry later
            }
        }

        return dbService;
    } catch (error) {
        console.error('Failed to initialize database:', error);
        throw error;
    }
}

// Enhance getItemsByPath to better handle missing data scenarios
export async function getItemsByPath(path: string, forceSync = false) {
    if (!dbService.initialized || !dbService.db) {
        throw new Error('Database not initialized');
    }

    try {
        // Check if we need to sync with server
        let shouldSync = forceSync;
        
        // If not explicitly syncing, check if we have data locally
        if (!shouldSync) {
            const filesCount = await dbService.db.table('files').count();
            const foldersCount = await dbService.db.table('folders').count();
            shouldSync = filesCount === 0 && foldersCount === 0;
            
            if (shouldSync) {
                console.log('Empty local database detected, syncing with server...');
            }
        }
        
        // Sync if needed
        if (shouldSync) {
            try {
                await dbService.syncAll();
            } catch (error) {
                console.warn('Failed to sync before fetching items, using cached data', error);
            }
        }
        
        // Rest of your existing function for retrieving items...
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
            
            // If we still have no data after sync, try one more time with force sync
            if (files.length === 0 && folders.length === 0 && !forceSync) {
                console.log('No items found locally, forcing server sync');
                return getItemsByPath(path, true);
            }
            
            return {
                items: [
                    ...files.map(file => ({ ...file, type: 'file' })),
                    ...folders.map(folder => ({ ...folder, type: 'folder' }))
                ],
                current_folder_id: null
            };
        } else {
            // Existing subfolder handling code...
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
            
            if (!currentFolder && !forceSync) {
                console.log(`Folder not found locally for path ${path}, forcing server sync`);
                return getItemsByPath(path, true);
            }
            
            if (!currentFolder) {
                // If still not found after sync, return empty result
                return { items: [], current_folder_id: null };
            }
            
            // Rest of your existing code for retrieving subfolder items...
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

// Export repositories for each model
export const Files = () => dbService.repository('files');
export const Folders = () => dbService.repository('folders');

export default {
    initializeDatabase,
    Files,
    Folders,
    getItemsByPath
};
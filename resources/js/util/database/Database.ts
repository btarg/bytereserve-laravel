import Dexie, { IndexableType } from 'dexie';
import { LATEST_VERSIONS, SCHEMAS } from './Schemas';

// Define types for our database operations
interface SyncInfo {
    key: string;
    timestamp: number;
}

interface ModelDefinition {
    schema: string;
    [key: string]: any;
}

interface ModelDefinitions {
    [modelName: string]: ModelDefinition;
}

interface SyncHandler {
    (lastSync: number): Promise<{ timestamp: number } | null | undefined>;
}

interface SyncHandlers {
    [modelName: string]: SyncHandler;
}

interface Record {
    id?: string | number;
    created_at?: number;
    updated_at?: number;
    [key: string]: any;
}

interface Repository {
    all: () => Promise<Record[]>;
    find: (id: string | number) => Promise<Record | undefined>;
    where: (filterFn: (item: Record) => boolean) => Promise<Record[]>;
    whereEqual: (field: string, value: any) => Promise<Record[]>;
    save: (record: Record) => Promise<IndexableType>;
    delete: (id: string | number) => Promise<void>;
    table: () => Dexie.Table<Record, IndexableType>;
}

class DatabaseService {
    public db: Dexie | null;
    public initialized: boolean;
    public modelDefinitions: ModelDefinitions;
    public syncHandlers: SyncHandlers;

    constructor() {
        this.db = null;
        this.initialized = false;
        this.modelDefinitions = {};
        this.syncHandlers = {};
    }

    /**
     * Initialize the database with the given schema
     * @param dbName Name of the database
     * @param modelDefinitions Model definitions with table schemas
     */
    async initialize(dbName: string, modelDefinitions: ModelDefinitions): Promise<Dexie> {
        if (this.initialized && this.db) return this.db;

        // Get the overall DB version (highest of all table versions)
        const OVERALL_DB_VERSION = Math.max(...Object.values(LATEST_VERSIONS));

        try {
            this.modelDefinitions = modelDefinitions;
            this.db = new Dexie(dbName);

            // Handle each version sequentially
            for (let version = 1; version <= OVERALL_DB_VERSION; version++) {
                const versionStores: { [key: string]: string } = {};

                // For each model, get the appropriate schema for this version
                Object.entries(SCHEMAS).forEach(([tableName, tableSchemas]) => {
                    if (tableName === 'syncInfo') {
                        versionStores[tableName] = tableSchemas as string; // Not versioned
                        return;
                    }

                    // Get the highest schema version that doesn't exceed current version
                    const applicableVersions = Object.keys(tableSchemas)
                        .map(v => parseInt(v))
                        .filter(v => v <= version)
                        .sort((a, b) => b - a);

                    if (applicableVersions.length > 0) {
                        const schemaVersion = applicableVersions[0];
                        versionStores[tableName] = tableSchemas[schemaVersion];
                    }
                });

                // Define this version of the schema
                this.db.version(version).stores(versionStores);
                // console.log(`Defined schema version ${version}:`, versionStores);
            }

            // Rest of initialization...
            console.log('Opening database connection...');
            await this.db.open();
            console.log('Database opened successfully with version:', this.db.verno);

            // Initialize sync timestamp if not exists
            const syncInfo = await this.db.table('syncInfo').get('lastSync') as SyncInfo | undefined;
            if (!syncInfo) {
                await this.db.table('syncInfo').put({ key: 'lastSync', timestamp: 0 });
            }

            this.initialized = true;
            return this.db;
        } catch (error) {
            console.error('Error initializing database:', error);
            // Reset for retry
            this.db = null;
            this.initialized = false;
            throw error;
        }
    }

    /**
     * Register a sync handler for a specific model
     * @param modelName Name of the model
     * @param handler Sync handler function
     */
    registerSyncHandler(modelName: string, handler: SyncHandler): void {
        this.syncHandlers[modelName] = handler;
    }

    /**
     * Sync all registered models with the server
     * @returns Promise resolving to boolean indicating if all syncs were successful
     */
    async syncAll(): Promise<boolean> {
        if (!this.initialized || !this.db) {
            throw new Error('Database not initialized');
        }

        const syncInfo = await this.db.table('syncInfo').get('lastSync') as SyncInfo | undefined;
        const lastSync = syncInfo ? syncInfo.timestamp : 0;
        let latestTimestamp = lastSync;

        // Run all registered sync handlers
        const syncPromises = Object.entries(this.syncHandlers).map(async ([modelName, handler]) => {
            try {
                const result = await handler(lastSync);
                if (result && result.timestamp > latestTimestamp) {
                    latestTimestamp = result.timestamp;
                }
                return true;
            } catch (error) {
                console.error(`Sync failed for ${modelName}:`, error);
                return false;
            }
        });

        const results = await Promise.all(syncPromises);
        const allSuccessful = results.every(result => result === true);

        // Update sync timestamp if all syncs were successful
        if (allSuccessful && latestTimestamp > lastSync) {
            await this.db.table('syncInfo').put({ key: 'lastSync', timestamp: latestTimestamp });
        }

        return allSuccessful;
    }

    /**
     * Get a repository for a specific model
     * @param modelName Name of the model
     * @returns Repository with CRUD methods
     */
    repository(modelName: string): Repository {
        if (!this.initialized || !this.db) {
            throw new Error('Database not initialized');
        }

        if (!this.db[modelName]) {
            throw new Error(`Model ${modelName} not found in database`);
        }

        const table = this.db.table(modelName);

        return {
            /**
             * Get all records
             */
            all: () => table.toArray(),

            /**
             * Get a record by ID
             */
            find: (id) => table.get(id),

            /**
             * Query records with a filter function
             */
            where: (filterFn) => table.filter(filterFn).toArray(),

            /**
             * Query records by a field value
             */
            whereEqual: (field, value) => table.where(field).equals(value).toArray(),

            /**
             * Save a record (create or update)
             */
            save: (record: Record) => {
                // Add timestamps
                const now = Date.now();
                const updatedRecord = {
                    ...record,
                    updated_at: now
                };

                // Add created_at if it's a new record (no ID or temporary ID)
                if (!record.id || String(record.id).startsWith('temp_')) {
                    updatedRecord.created_at = now;
                    // Generate temporary ID if none exists
                    if (!record.id) {
                        updatedRecord.id = 'temp_' + now + '_' + Math.random().toString(36).substr(2, 9);
                    }
                }

                return table.put(updatedRecord);
            },

            /**
             * Delete a record
             */
            delete: (id) => table.delete(id),

            /**
             * Get the Dexie table object for advanced operations
             */
            table: () => table
        };
    }
}

// Create and export a singleton instance
const dbService = new DatabaseService();
export default dbService;
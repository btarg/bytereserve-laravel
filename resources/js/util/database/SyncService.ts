import dbService from './Database';
import { S3UploadService } from "../uploads/S3UploadService";


export class SyncService {
    private uploadService: S3UploadService;
    private syncInterval: number | null = null;

    constructor() {
        this.uploadService = new S3UploadService();
    }

    /**
     * Start background sync process
     */
    startSync(intervalMs = 30000) {
        // Clear any existing interval
        this.stopSync();

        // Start a new interval
        this.syncInterval = window.setInterval(() => {
            this.syncPendingUploads();
            this.syncWithServer();
        }, intervalMs);

        // Run an initial sync immediately
        this.syncPendingUploads();
        this.syncWithServer();

        return this;
    }

    /**
     * Stop background sync
     */
    stopSync() {
        if (this.syncInterval !== null) {
            window.clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        return this;
    }

    /**
     * Sync with server (pull changes)
     */
    async syncWithServer() {
        if (!dbService.initialized || !dbService.db) {
            console.warn('Database not initialized, skipping sync');
            return false;
        }

        try {
            console.log('Starting sync with server...');
            const result = await dbService.syncAll().catch(error => {
                console.error('Sync failed with error:', error);
                return false;
            });
            console.log('Sync completed:', result ? 'success' : 'with some errors');
            return true; // Return true even if there were errors - we'll retry next time
        } catch (error) {
            console.error('Sync with server failed:', error);
            return false;
        }
    }

    /**
     * Upload any pending files
     */
    async syncPendingUploads() {
        if (!dbService.initialized || !dbService.db) {
            console.warn('Database not initialized, skipping pending uploads');
            return;
        }
    
        try {
            // Find all files with pending_upload flag
            // Note: We're using filter instead of where/equals since pending_upload might not be indexed yet
            const allFiles = await dbService.db.table('files').toArray();
            const pendingFiles = allFiles.filter(file => file.pending_upload === true);
    
            if (pendingFiles.length === 0) {
                console.log('No pending uploads found');
                return { success: true, uploaded: 0 };
            }
    
            console.log(`Found ${pendingFiles.length} pending uploads to process`);
    
            const results = await Promise.allSettled(
                pendingFiles.map(async (fileRecord) => {
                    try {
                        // Skip if no local_blob is available
                        if (!fileRecord.local_blob) {
                            console.warn(`No local blob for file ${fileRecord.id}, skipping`);
                            return { success: false, id: fileRecord.id };
                        }
                        
                        // Upload the file
                        const result = await this.uploadService.uploadFile(
                            fileRecord.local_blob,
                            "password",
                            fileRecord.folder_id
                        );
                        
                        // If successful, update the record
                        if (result && result.id) {
                            // Delete the temporary record
                            await dbService.db.table('files').delete(fileRecord.id);
                            
                            // Save the new record from the server
                            await dbService.db.table('files').put({
                                id: result.id,
                                name: result.name,
                                type: 'file',
                                path: result.path,
                                folder_id: fileRecord.folder_id,
                                mime_type: result.mime_type,
                                size: result.size,
                                pending_upload: false,
                                created_at: Date.now(),
                                updated_at: Date.now()
                            });
                            
                            return { success: true, id: result.id };
                        }
                        
                        return { success: false, id: fileRecord.id };
                    } catch (error) {
                        console.error(`Failed to upload pending file ${fileRecord.id}:`, error);
                        return { success: false, id: fileRecord.id, error };
                    }
                })
            );
            
            const uploaded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            console.log(`Uploaded ${uploaded} pending files`);
            
            return { success: true, uploaded };
        } catch (error) {
            console.error('Failed to process pending uploads:', error);
            return { success: false, error };
        }
    }
}

// Create and export singleton
const syncService = new SyncService();
export default syncService;
import { initializeDatabase } from './util/database/ModelRegistry';
import syncService from './util/database/SyncService';
import cacheFetchInstance, { AutoCacheableFetch } from "./util/AutoCacheableFetch";

// Initialize database with retry logic
function initWithRetry(retries = 3, delay = 1000) {
    return initializeDatabase()
        .then(() => {
            console.log('Offline database initialized successfully');
            // Only start pending uploads check (avoid full sync)
            syncService.startSync(300000); // Check every 5 minutes
        })
        .catch(error => {
            console.error(`Failed to initialize database (attempts left: ${retries}):`, error);
            
            if (retries > 0) {
                console.log(`Retrying database initialization in ${delay}ms...`);
                return new Promise(resolve => setTimeout(resolve, delay))
                    .then(() => initWithRetry(retries - 1, delay * 1.5)); // Exponential backoff
            } else {
                console.error('Database initialization failed after multiple attempts');
                throw error;
            }
        });
}

// Export the initialization promise so components can await it if needed
const dbInitPromise = initWithRetry();
window.dbInitPromise = dbInitPromise;

// Type definition for window
declare global {
    interface Window {
        cacheFetch: AutoCacheableFetch;
        dbInitPromise: Promise<any>;
    }
}

window.cacheFetch = cacheFetchInstance;

// DB offline syncing listeners - only sync pending uploads
window.addEventListener('online', () => {
    console.log('App is online. Checking for pending uploads...');
    syncService.syncPendingUploads(); // Only upload pending files, don't do full sync
});

window.addEventListener('offline', () => {
    console.log('App is offline. Will check for uploads when connection returns.');
});
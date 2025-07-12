<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, defineProps, defineEmits } from 'vue';
import { UIFileEntry } from '../../types';
import { getItemsByPath } from '@/util/database/ModelRegistry';


import {
    FolderIcon,
    DocumentIcon,
    CheckCircleIcon,
    ArrowDownTrayIcon
} from '@heroicons/vue/24/outline';

import { S3UploadService } from "@/util/uploads/S3UploadService";
import { S3DownloadService } from "@/util/downloads/S3DownloadService";
import EncryptionKeyModal from "./EncryptionKeyModal.vue";
import { useToast } from "vue-toastification";
import { route } from 'ziggy-js';
import { formatFileSize } from '@/util/FormattingUtils';
const toast = useToast();
const props = defineProps<{
    currentPath: string;
}>();

const emit = defineEmits<{
    (e: 'selection-change', items: UIFileEntry[]): void;
    (e: 'path-change', path: string): void;
}>();

const isDragging = ref(false);
const isLoading = ref(false);
const selectedItems = ref<UIFileEntry[]>([]);
const uiFileEntries = ref<UIFileEntry[]>([]);
const currentFolderId = ref<number | null>(null);
const downloading = ref<Record<number, boolean>>({});

const uploadService = new S3UploadService();
const downloadService = new S3DownloadService();
const uploadProgress = ref<Record<string, number>>({});
const uploadsInProgress = ref<number>(0);

// Download progress and encryption key management
const downloadProgress = ref<Record<number, { progress: number; fileName: string }>>({});
const downloadQueue = ref<Array<{ id: number; fileName: string; status: 'pending' | 'downloading' | 'completed' | 'failed' }>>([]);

// Upload progress management
const uploadQueue = ref<Array<{ id: string; fileName: string; status: 'pending' | 'uploading' | 'completed' | 'failed'; progress: number }>>([]);
const showUploadModal = ref(false);

const showEncryptionKeyModal = ref(false);
const encryptionKey = ref('');
const pendingDownload = ref<UIFileEntry | null>(null);
const isFileEncrypted = ref(false);

const refreshFiles = async (forceSync = false) => {
    console.log("Refreshing files, forceSync:", forceSync);
    selectedItems.value = [];
    emit('selection-change', []);

    await fetchItems(forceSync);
};

defineExpose({
    refreshFiles
});

const handleItemClick = async (item: UIFileEntry) => {
    if (item.type === 'folder') {
        navigateToFolder(item.path);
    } else {
        await downloadFile(item);
    }
};

// Separate function to handle folder navigation
const navigateToFolder = (folderPath: string) => {
    // Emit event to update the current path in parent components
    emit('path-change', folderPath);

    // Update browser history
    const url = new URL(window.location.href);
    url.searchParams.set('folder', folderPath);
    history.pushState({}, '', url);
};

const downloadFile = async (item: UIFileEntry) => {
    if (!item.id) {
        toast.error("Cannot download file: Missing file ID");
        return;
    }

    try {
        downloading.value[item.id] = true;

        // Add to download queue
        downloadQueue.value.push({
            id: item.id as number,
            fileName: item.name,
            status: 'pending'
        });

        // Get download URL to check if file is encrypted
        const response = await fetch(
            route('files.download.{file}', { file: item.id }),
            {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-XSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to get download URL: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.download_url) {
            throw new Error('No download URL provided');
        }

        // Check if file is encrypted by downloading a small sample
        const isEncrypted = await checkIfFileIsEncrypted(data.download_url);
        
        if (isEncrypted) {
            // Show encryption key modal
            pendingDownload.value = item;
            isFileEncrypted.value = true;
            showEncryptionKeyModal.value = true;
            
            // Remove from queue temporarily
            const queueIndex = downloadQueue.value.findIndex(q => q.id === item.id);
            if (queueIndex !== -1) {
                downloadQueue.value.splice(queueIndex, 1);
            }
            
            downloading.value[item.id] = false;
            return;
        }

        // File is not encrypted, proceed with download
        await performDownload(item, "");
        
    } catch (error) {
        console.error('Error downloading file:', error);
        toast.error(`Error downloading file: ${error.message || 'Unknown error'}`);
        
        // Update queue status
        const queueItem = downloadQueue.value.find(q => q.id === item.id);
        if (queueItem) {
            queueItem.status = 'failed';
        }
        
        downloading.value[item.id] = false;
    }
};

const checkIfFileIsEncrypted = async (downloadUrl: string): Promise<boolean> => {
    try {
        // Download just the first few bytes to check for salt
        const response = await fetch(downloadUrl, {
            headers: {
                'Range': 'bytes=0-31' // Get first 32 bytes
            }
        });
        
        if (!response.ok) {
            return false; // Assume not encrypted if we can't check
        }
        
        const buffer = await response.arrayBuffer();
        const dataView = new Uint8Array(buffer);
        
        // Check if file has the minimum size for encryption (salt + iv + auth tag)
        if (dataView.length >= 16) {
            // This is a simple heuristic - in a real app you might want to store encryption metadata
            return true; // Assume encrypted if file is large enough
        }
        
        return false;
    } catch (error) {
        console.error('Error checking encryption status:', error);
        return false; // Default to not encrypted
    }
};

const performDownload = async (item: UIFileEntry, password: string) => {
    try {
        downloading.value[item.id] = true;
        
        // Update queue status
        const queueItem = downloadQueue.value.find(q => q.id === item.id);
        if (queueItem) {
            queueItem.status = 'downloading';
        }

        // Use the download service to handle encrypted downloads
        const decryptedBlob = await downloadService.downloadFile(
            item.id as number,
            item.name,
            password || "password", // Use provided password or default
            (progress) => {
                downloadProgress.value[item.id] = {
                    progress: progress.percentage,
                    fileName: item.name
                };
                console.log(`Download progress: ${progress.percentage.toFixed(1)}%`);
            }
        );

        // Create a more reliable download completion tracking using focus events
        let downloadProcessed = false;
        let timeoutId: number;
        
        const cleanupDownload = (wasSuccessful: boolean) => {
            if (downloadProcessed) return;
            downloadProcessed = true;
            
            clearTimeout(timeoutId);
            
            if (wasSuccessful) {
                toast.success(`Downloaded ${item.name}`);
                
                // Update queue status
                if (queueItem) {
                    queueItem.status = 'completed';
                }
                
                // Clean up after delay
                setTimeout(() => {
                    delete downloadProgress.value[item.id];
                    const index = downloadQueue.value.findIndex(q => q.id === item.id);
                    if (index !== -1) {
                        downloadQueue.value.splice(index, 1);
                    }
                }, 2000);
            } else {
                // Download was cancelled
                toast.info(`Download cancelled for ${item.name}`);
                
                // Remove from queue immediately
                const index = downloadQueue.value.findIndex(q => q.id === item.id);
                if (index !== -1) {
                    downloadQueue.value.splice(index, 1);
                }
                
                delete downloadProgress.value[item.id];
            }
            
            // Cleanup event listeners
            window.removeEventListener('focus', handleWindowFocus);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
        
        // Listen for window focus events (user comes back after save dialog)
        const handleWindowFocus = () => {
            // Short delay to let the save dialog finish
            setTimeout(() => {
                cleanupDownload(true);
            }, 100);
        };
        
        // Fallback: visibility change detection
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                setTimeout(() => {
                    cleanupDownload(true);
                }, 100);
            }
        };
        
        window.addEventListener('focus', handleWindowFocus, { once: true });
        document.addEventListener('visibilitychange', handleVisibilityChange, { once: true });
        
        // Trigger the download
        S3DownloadService.triggerDownload(decryptedBlob, item.name);
        
        // Shorter timeout to detect cancelled downloads faster
        timeoutId = setTimeout(() => {
            cleanupDownload(false);
        }, 1500); // Reduced from 3000ms to 1500ms

    } catch (error) {
        console.error('Error downloading file:', error);
        toast.error(`Error downloading file: ${error.message || 'Unknown error'}`);
        
        // Update queue status
        const queueItem = downloadQueue.value.find(q => q.id === item.id);
        if (queueItem) {
            queueItem.status = 'failed';
        }
    } finally {
        downloading.value[item.id] = false;
    }
};

const handleEncryptionKeySubmit = async (key: string) => {
    if (!pendingDownload.value) return;
    
    // Add back to download queue
    downloadQueue.value.push({
        id: pendingDownload.value.id as number,
        fileName: pendingDownload.value.name,
        status: 'pending'
    });
    
    // Close modal
    showEncryptionKeyModal.value = false;
    
    // Perform download with provided key
    await performDownload(pendingDownload.value, key);
    
    // Reset modal state
    pendingDownload.value = null;
    encryptionKey.value = '';
    isFileEncrypted.value = false;
};

const cancelEncryptionKeyModal = () => {
    showEncryptionKeyModal.value = false;
    pendingDownload.value = null;
    encryptionKey.value = '';
    isFileEncrypted.value = false;
};


const fetchItems = async (forceSync = false) => {
    isLoading.value = true;
    try {
        // Ensure database is initialized before fetching
        if (window.dbInitPromise) {
            try {
                await window.dbInitPromise;
            } catch (initError) {
                console.error('Database initialization error:', initError);
                // Continue to network fallback
            }
        }

        let data;

        // First try to get data from IndexedDB
        try {
            data = await getItemsByPath(props.currentPath, forceSync);
            console.log('Loaded files from IndexedDB');
        } catch (offlineError) {
            console.warn('Failed to get items from IndexedDB:', offlineError);

            // Fall back to the network if IndexedDB fails
            try {
                const response = await window.cacheFetch.get(
                    route('explorer.index') + '?' + new URLSearchParams({
                        path: props.currentPath
                    }).toString(),
                );
                data = await response.json();
                console.log('Loaded files from network');
            } catch (networkError) {
                console.error('Failed to load files from network:', networkError);

                // If both IndexedDB and network fail, provide an empty data structure
                data = { items: [], current_folder_id: null };
                toast.error("Failed to load files. Working in offline mode with limited data.");
            }
        }

        // Map the items to our expected format
        uiFileEntries.value = data.items.map(item => {
            // For folders, create the correct path
            let itemPath = '';

            if (item.type === 'folder') {
                // Use the path from the database if available, otherwise construct it
                itemPath = item.path || `${props.currentPath === '/' ? '' : props.currentPath}/${item.name}`;
            } else {
                // For files, use the path from the database (S3 key)
                itemPath = item.path || '';
            }

            return {
                id: item.id,
                name: item.name,
                type: item.type,
                size: item.size || 0,
                modified_at: new Date(item.updated_at || item.created_at),
                path: itemPath,
                mime_type: item.mime_type || null
            };
        });

        currentFolderId.value = data.current_folder_id;

        // Update the browser URL
        updateBrowserURL(props.currentPath);
    } catch (error) {
        console.error('Error fetching files:', error);
        toast.error("Failed to load files. Please try again.");
        uiFileEntries.value = []; // Reset files on error
    } finally {
        isLoading.value = false;
    }
};


// Selection handling
const toggleSelection = (item: UIFileEntry) => {
    const index = selectedItems.value.findIndex(i => i.id === item.id);
    if (index === -1) {
        selectedItems.value.push(item);
    } else {
        selectedItems.value.splice(index, 1);
    }
    emit('selection-change', selectedItems.value);
};

const isSelected = (item: UIFileEntry): boolean => {
    return selectedItems.value.some(i => i.id === item.id);
};

// Update browser URL without navigating
const updateBrowserURL = (path: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('folder', path);
    history.replaceState({}, '', url);
};

// Handle browser back/forward navigation
const handlePopState = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const folderPath = urlParams.get('folder') || '/';
    emit('path-change', folderPath);
};

// Drag and drop handlers
const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    isDragging.value = true;
};

const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const relatedTarget = event.relatedTarget as HTMLElement;

    // Only set isDragging to false if we're leaving the drop zone
    if (!target.contains(relatedTarget)) {
        isDragging.value = false;
    }
};


async function processFile(file: File) {
    try {
        // Initialize progress tracking
        const fileId = `${file.name}-${file.size}-${Date.now()}`;
        uploadProgress.value[fileId] = 0;

        // Add to upload queue
        uploadQueue.value.push({
            id: fileId,
            fileName: file.name,
            status: 'pending',
            progress: 0
        });

        // Show upload modal if not already visible
        if (uploadQueue.value.length === 1) {
            showUploadModal.value = true;
        }

        // Update queue status
        const queueItem = uploadQueue.value.find(q => q.id === fileId);
        if (queueItem) {
            queueItem.status = 'uploading';
        }

        // Start timing the upload
        const startTime = performance.now();

        // Try to upload to S3
        let result = null;
        try {
            result = await uploadService.uploadFile(
                file, 
                "password", // Use default password for testing
                currentFolderId.value, 
                (progress) => {
                    uploadProgress.value[fileId] = progress;
                    if (queueItem) {
                        queueItem.progress = progress;
                    }
                }
                // Remove the false parameter - encryption is now default
            );
        } catch (uploadError) {
            console.error('Upload failed:', uploadError);
            // Will handle this case below
        }

        // Calculate upload duration
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000; // Convert to seconds

        uploadsInProgress.value--;

        if (result) {
            toast.success(`Uploaded ${file.name} in ${duration.toFixed(2)}s`);
            if (queueItem) {
                queueItem.status = 'completed';
                queueItem.progress = 100;
            }
        } else {
            toast.info(`${file.name} saved locally and will upload when connection is available`);
            if (queueItem) {
                queueItem.status = 'failed';
            }
        }

        // Remove completed/failed items after delay
        setTimeout(() => {
            const index = uploadQueue.value.findIndex(q => q.id === fileId);
            if (index !== -1) {
                uploadQueue.value.splice(index, 1);
            }
            delete uploadProgress.value[fileId];
            
            // Hide modal if no more uploads
            if (uploadQueue.value.length === 0) {
                showUploadModal.value = false;
            }
        }, 3000);

        return result;
    } catch (error) {
        uploadsInProgress.value--;
        console.error('File processing failed:', error);
        toast.error(`Failed to process ${file.name}`);
        
        // Update queue status
        const fileId = `${file.name}-${file.size}-${Date.now()}`;
        const queueItem = uploadQueue.value.find(q => q.id === fileId);
        if (queueItem) {
            queueItem.status = 'failed';
        }
        
        return null;
    }
}


const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    isDragging.value = false;

    const droppedFiles = event.dataTransfer?.files;
    if (!droppedFiles?.length) return;

    uploadsInProgress.value = droppedFiles.length;

    // Process files concurrently but limit the number
    const filesToProcess = Array.from(droppedFiles);
    const batchSize = 5;

    try {
        // Process files in batches
        for (let i = 0; i < filesToProcess.length; i += batchSize) {
            const batch = filesToProcess.slice(i, i + batchSize);
            await Promise.all(batch.map((file) => processFile(file)));
        }
    } finally {
        await refreshFiles();
    }
};


watch(() => props.currentPath, () => {
    selectedItems.value = [];
    emit('selection-change', []);
    fetchItems();
});

onMounted(async () => {
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    window.addEventListener('popstate', handlePopState);

    try {
        // Wait for database to initialize before fetching
        if (window.dbInitPromise) {
            await window.dbInitPromise;
        }
    } catch (error) {
        console.error('Error waiting for database initialization:', error);
    }

    refreshFiles(false);
});

onUnmounted(() => {
    document.removeEventListener('dragover', handleDragOver);
    document.removeEventListener('dragleave', handleDragLeave);
    document.removeEventListener('drop', handleDrop);
    window.removeEventListener('popstate', handlePopState);
    uploadService.terminate();
});
</script>

<template>
    <div class="flex-1 overflow-auto p-6" :class="{ 'border-2 border-dashed border-blue-400 bg-blue-50': isDragging }">
        <div v-if="isLoading" class="flex justify-center p-12">
            <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
        </div>

        <div v-else class="grid grid-cols-1 gap-2">
            <div class="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-gray-500 bg-gray-50 rounded-lg">
                <div class="col-span-6">Name</div>
                <div class="col-span-3">Modified</div>
                <div class="col-span-3">Size</div>
            </div>

            <div v-if="uiFileEntries.length === 0" class="py-12 text-center text-gray-500">
                No files or folders in this location. Drop files to upload.
            </div>

            <div v-for="entry in uiFileEntries" :key="entry.id"
                class="grid grid-cols-12 gap-4 px-4 py-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                :class="{ 'bg-blue-50': isSelected(entry) }" @click="toggleSelection(entry)">
                <div class="col-span-6 flex items-center space-x-3">
                    <CheckCircleIcon class="w-5 h-5" :class="isSelected(entry) ? 'text-blue-500' : 'text-gray-200'" />
                    <div class="flex items-center" @click.stop="handleItemClick(entry)">
                        <FolderIcon v-if="entry.type === 'folder'" class="w-5 h-5 text-yellow-500" />
                        <DocumentIcon v-else class="w-5 h-5 text-blue-500" />
                        <span class="truncate ml-3">{{ entry.name }}</span>
                    </div>
                </div>
                <div class="col-span-3 flex items-center">
                    {{ entry.modified_at.toLocaleDateString() }}
                </div>
                <div class="col-span-3 flex items-center">{{ formatFileSize(entry.size) }}</div>
            </div>

            <!-- Drop zone overlay -->
            <div v-if="isDragging" class="absolute inset-0 bg-blue-100 bg-opacity-50 flex items-center justify-center">
                <div class="text-xl font-semibold text-blue-600">
                    Drop files here to upload
                </div>
            </div>
        </div>

        <!-- Action buttons for selected items -->
        <div v-if="selectedItems.length === 1" class="fixed bottom-5 right-5 bg-white shadow-lg rounded-lg p-2 flex">
            <button v-if="selectedItems[0].type === 'file'" @click="downloadFile(selectedItems[0])"
                class="p-2 text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                :disabled="downloading[selectedItems[0].id]">
                <span v-if="downloading[selectedItems[0].id]"
                    class="animate-spin h-5 w-5 border-2 border-blue-500 rounded-full border-t-transparent"></span>
                <ArrowDownTrayIcon v-else class="w-5 h-5" />
                Download
            </button>
        </div>

        <!-- Download Progress Panel -->
        <div v-if="downloadQueue.length > 0 || Object.keys(downloadProgress).length > 0" 
             class="fixed bottom-5 left-5 bg-white shadow-lg rounded-lg p-4 w-80 max-h-64 overflow-y-auto">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-800 flex items-center">
                    <ArrowDownTrayIcon class="w-4 h-4 mr-2" />
                    Downloads ({{ downloadQueue.length }})
                </h3>
                <button @click="downloadQueue = []; Object.keys(downloadProgress).forEach(key => delete downloadProgress[key])" 
                        class="text-gray-400 hover:text-gray-600">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            
            <!-- Download Queue Items -->
            <div v-for="queueItem in downloadQueue" :key="queueItem.id" class="mb-3 last:mb-0">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-medium text-gray-700 truncate">{{ queueItem.fileName }}</span>
                    <span class="text-xs px-2 py-1 rounded-full" 
                          :class="{
                              'bg-yellow-100 text-yellow-800': queueItem.status === 'pending',
                              'bg-blue-100 text-blue-800': queueItem.status === 'downloading',
                              'bg-green-100 text-green-800': queueItem.status === 'completed',
                              'bg-red-100 text-red-800': queueItem.status === 'failed'
                          }">
                        {{ queueItem.status }}
                    </span>
                </div>
                
                <!-- Progress bar for downloading files -->
                <div v-if="queueItem.status === 'downloading' && downloadProgress[queueItem.id]" 
                     class="w-full bg-gray-200 rounded-full h-2">
                    <div class="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                         :style="{ width: downloadProgress[queueItem.id].progress + '%' }">
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        {{ Math.round(downloadProgress[queueItem.id].progress) }}%
                    </div>
                </div>
                
                <!-- Simple progress indicator for pending -->
                <div v-else-if="queueItem.status === 'pending'" class="w-full bg-gray-200 rounded-full h-2">
                    <div class="bg-yellow-400 h-2 rounded-full w-0"></div>
                </div>
                
                <!-- Completed indicator -->
                <div v-else-if="queueItem.status === 'completed'" class="w-full bg-green-200 rounded-full h-2">
                    <div class="bg-green-600 h-2 rounded-full w-full"></div>
                </div>
                
                <!-- Failed indicator -->
                <div v-else-if="queueItem.status === 'failed'" class="w-full bg-red-200 rounded-full h-2">
                    <div class="bg-red-600 h-2 rounded-full w-full"></div>
                </div>
            </div>
        </div>

        <!-- Upload Progress Panel -->
        <div v-if="uploadQueue.length > 0" 
             class="fixed bottom-20 right-5 bg-white shadow-lg rounded-lg p-4 w-80 max-h-64 overflow-y-auto">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-800 flex items-center">
                    <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                    </svg>
                    Uploads ({{ uploadQueue.length }})
                </h3>
                <button @click="showUploadModal = false; uploadQueue = []; Object.keys(uploadProgress).forEach(key => delete uploadProgress[key])" 
                        class="text-gray-400 hover:text-gray-600">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            
            <!-- Upload Queue Items -->
            <div v-for="queueItem in uploadQueue" :key="queueItem.id" class="mb-3 last:mb-0">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-medium text-gray-700 truncate">{{ queueItem.fileName }}</span>
                    <span class="text-xs px-2 py-1 rounded-full" 
                          :class="{
                              'bg-yellow-100 text-yellow-800': queueItem.status === 'pending',
                              'bg-blue-100 text-blue-800': queueItem.status === 'uploading',
                              'bg-green-100 text-green-800': queueItem.status === 'completed',
                              'bg-red-100 text-red-800': queueItem.status === 'failed'
                          }">
                        {{ queueItem.status }}
                    </span>
                </div>
                
                <!-- Progress bar for uploading files -->
                <div v-if="queueItem.status === 'uploading' && queueItem.progress !== undefined" 
                     class="w-full bg-gray-200 rounded-full h-2">
                    <div class="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                         :style="{ width: queueItem.progress + '%' }">
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        {{ Math.round(queueItem.progress) }}%
                    </div>
                </div>
                
                <!-- Simple progress indicator for pending -->
                <div v-else-if="queueItem.status === 'pending'" class="w-full bg-gray-200 rounded-full h-2">
                    <div class="bg-yellow-400 h-2 rounded-full w-0"></div>
                </div>
                
                <!-- Completed indicator -->
                <div v-else-if="queueItem.status === 'completed'" class="w-full bg-green-200 rounded-full h-2">
                    <div class="bg-green-600 h-2 rounded-full w-full"></div>
                </div>
                
                <!-- Failed indicator -->
                <div v-else-if="queueItem.status === 'failed'" class="w-full bg-red-200 rounded-full h-2">
                    <div class="bg-red-600 h-2 rounded-full w-full"></div>
                </div>
            </div>
        </div>

        <!-- Encryption Key Modal -->
        <EncryptionKeyModal
            :show="showEncryptionKeyModal"
            :fileName="pendingDownload?.name"
            v-model:encryptionKey="encryptionKey"
            @submit="handleEncryptionKeySubmit"
            @cancel="cancelEncryptionKeyModal"
        />
    </div>
</template>
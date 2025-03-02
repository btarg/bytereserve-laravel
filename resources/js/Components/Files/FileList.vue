<!-- filepath: /c:/Users/BenTa/Documents/Laravel/chirper/resources/js/Components/Files/FileList.vue -->
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, defineProps, defineEmits } from 'vue';
import { FileItem } from '../../types';
import { getItemsByPath, Files, Folders } from '@/util/database/ModelRegistry';


import {
    FolderIcon,
    DocumentIcon,
    CheckCircleIcon,
    ArrowDownTrayIcon
} from '@heroicons/vue/24/outline';

import { S3UploadService } from "@/util/S3UploadService";
import { useToast } from "vue-toastification";
import { route } from '../../../../vendor/tightenco/ziggy/src/js';
import { formatFileSize } from '@/util/FormattingUtils';
import { FileRecord } from '@/util/database/Schemas';

const toast = useToast();
const props = defineProps<{
    currentPath: string;
}>();

const emit = defineEmits<{
    (e: 'selection-change', items: FileItem[]): void;
    (e: 'path-change', path: string): void;
}>();

const isDragging = ref(false);
const isLoading = ref(false);
const selectedItems = ref<FileItem[]>([]);
const files = ref<FileItem[]>([]);
const currentFolderId = ref<number | null>(null);
const downloading = ref<Record<number, boolean>>({});

const uploadService = new S3UploadService();
const uploadProgress = ref<Record<string, number>>({});
const uploadsInProgress = ref<number>(0);

const refreshFiles = async (forceSync = false) => {
    console.log("Refreshing files, forceSync:", forceSync);
    selectedItems.value = [];
    emit('selection-change', []);

    await fetchItems(forceSync);
};

defineExpose({
    refreshFiles
});

const handleItemClick = async (item: FileItem) => {
    if (item.type === 'folder') {
        // Navigate to the folde
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

const downloadFile = async (item: FileItem) => {
    if (!item.id) {
        toast.error("Cannot download file: Missing file ID");
        return;
    }

    try {
        downloading.value[item.id] = true;

        const response = await window.cacheFetch.get(route('files.download.{file}', { file: item.id }));
        const data = await response.json();
        console.log(data);


        if (data.download_url) {
            // Create a temporary link and click it
            const link = document.createElement('a');
            link.href = data.download_url;
            link.setAttribute('download', item.name);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success(`Downloading ${item.name}`);
        } else {
            toast.error("Download URL not found");
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        toast.error(`Error downloading file: ${error.response?.data?.error || 'Unknown error'}`);
    } finally {
        downloading.value[item.id] = false;
    }
};

// Update the fetchItems function to ensure DB is initialized
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
        files.value = data.items.map(item => {
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
        files.value = []; // Reset files on error
    } finally {
        isLoading.value = false;
    }
};


// Selection handling
const toggleSelection = (item: FileItem) => {
    const index = selectedItems.value.findIndex(i => i.id === item.id);
    if (index === -1) {
        selectedItems.value.push(item);
    } else {
        selectedItems.value.splice(index, 1);
    }
    emit('selection-change', selectedItems.value);
};

const isSelected = (item: FileItem): boolean => {
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
        
        // Start timing the upload
        const startTime = performance.now();
        
        // First save to Dexie with a temporary ID
        const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const fileRecord: FileRecord = {
            id: tempId,
            name: file.name,
            type: 'file',
            path: tempId, // Will be replaced with S3 key after upload
            folder_id: currentFolderId.value,
            mime_type: file.type || 'application/octet-stream',
            size: file.size,
            local_blob: file, // Store the file blob locally for later upload
            pending_upload: true,
            created_at: Date.now(),
            updated_at: Date.now()
        };
        
        // Save to Dexie
        await Files().save(fileRecord);
        
        let result;
        
        try {
            // Try to upload to S3
            result = await uploadService.uploadFile(file, "password", currentFolderId.value, (progress) => {
                uploadProgress.value[fileId] = progress;
            });
            
            // If successful, update the record with real ID and S3 path
            if (result && result.id) {
                // Delete the temporary record
                await Files().delete(tempId);
                
                // The server should have already created the record, but we'll update local DB
                const serverRecord: FileRecord = {
                    id: result.id,
                    name: result.name,
                    type: 'file',
                    path: result.path,
                    folder_id: currentFolderId.value,
                    mime_type: result.mime_type,
                    size: result.size,
                    created_at: Date.now(),
                    updated_at: Date.now()
                };
                
                await Files().save(serverRecord);
                
                // Then force fetch with the latest data including updated folder sizes
                await fetchItems(true);
            }
        } catch (uploadError) {
            console.error('Upload failed, file will be saved locally:', uploadError);
            // Keep the local record with pending_upload flag
            // Will be uploaded later when connection is available
        }
        
        // Calculate upload duration
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000; // Convert to seconds
        
        uploadsInProgress.value--;
        console.log(`Upload completed: ${file.name} (${formatFileSize(file.size)}) in ${duration.toFixed(2)}s`);
        toast.success(`Uploaded ${file.name} in ${duration.toFixed(2)}s`);
        
        return result || fileRecord; // Return either S3 result or local record
    } catch (error) {
        uploadsInProgress.value--;
        console.error('File upload failed:', error);
        toast.error(`Failed to upload ${file.name}`);
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
            await Promise.all(batch.map(file => processFile(file)));
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

            <div v-if="files.length === 0" class="py-12 text-center text-gray-500">
                No files or folders in this location. Drop files to upload.
            </div>

            <div v-for="item in files" :key="item.id"
                class="grid grid-cols-12 gap-4 px-4 py-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                :class="{ 'bg-blue-50': isSelected(item) }"
                @click="toggleSelection(item)">
                <div class="col-span-6 flex items-center space-x-3">
                    <CheckCircleIcon class="w-5 h-5" :class="isSelected(item) ? 'text-blue-500' : 'text-gray-200'" />
                    <div class="flex items-center" @click.stop="handleItemClick(item)">
                        <FolderIcon v-if="item.type === 'folder'" class="w-5 h-5 text-yellow-500" />
                        <DocumentIcon v-else class="w-5 h-5 text-blue-500" />
                        <span class="truncate ml-3">{{ item.name }}</span>
                    </div>
                </div>
                <div class="col-span-3 flex items-center">
                    {{ item.modified_at.toLocaleDateString() }}
                </div>
                <div class="col-span-3 flex items-center">{{ formatFileSize(item.size) }}</div>
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
    </div>
</template>
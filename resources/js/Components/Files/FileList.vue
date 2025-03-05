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

        // Get the download URL from the API
        const response = await window.cacheFetch.get(
            route('files.download.{file}', { file: item.id }),
            {},
            {}
        );

        const data = await response.json();
        console.log(data);

        if (data.download_url) {
            try {
                // Parse the URL to check expiration
                const url = new URL(data.download_url);
                const amzDate = url.searchParams.get('X-Amz-Date');
                const amzExpires = url.searchParams.get('X-Amz-Expires');

                let isExpired = false;

                if (amzDate && amzExpires) {
                    // Parse the date and expiration time
                    // Format: YYYYMMDDTHHMMSSZ (ISO 8601 format)
                    const year = parseInt(amzDate.substring(0, 4));
                    const month = parseInt(amzDate.substring(4, 6)) - 1; // Months are 0-indexed in JS
                    const day = parseInt(amzDate.substring(6, 8));
                    const hour = parseInt(amzDate.substring(9, 11));
                    const minute = parseInt(amzDate.substring(11, 13));
                    const second = parseInt(amzDate.substring(13, 15));

                    const dateObj = new Date(Date.UTC(year, month, day, hour, minute, second));
                    const expiresInSeconds = parseInt(amzExpires);
                    const expirationTime = new Date(dateObj.getTime() + expiresInSeconds * 1000);

                    // Check if the URL has expired
                    isExpired = new Date() > expirationTime;
                    console.log(`URL expiration check: Current time: ${new Date().toISOString()}, Expires: ${expirationTime.toISOString()}, Expired: ${isExpired}`);
                }

                if (!isExpired) {
                    // URL is still valid, proceed with download
                    const link = document.createElement('a');
                    link.href = data.download_url;
                    link.setAttribute('download', item.name);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success(`Downloading ${item.name}`);
                } else {
                    // URL has expired, get a fresh one
                    console.log("Download link expired, generating a new one...");

                    const newLinkResponse = await window.cacheFetch.get(
                        route('files.download.{file}', { file: item.id }),
                        {},
                        { cacheStrategy: 'network-only' }
                    );

                    const newData = await newLinkResponse.json();

                    if (newData.download_url) {
                        const link = document.createElement('a');
                        link.href = newData.download_url;
                        link.setAttribute('download', item.name);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        toast.success(`Downloading ${item.name}`);
                    } else {
                        toast.error("Failed to generate a new download link");
                    }
                }
            } catch (error) {
                console.error('Error processing download URL:', error);

                // If URL parsing fails, try direct download as a fallback
                console.log("Attempting direct download as fallback...");
                const link = document.createElement('a');
                link.href = data.download_url;
                link.setAttribute('download', item.name);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast.success(`Downloading ${item.name}`);
            }
        } else {
            toast.error("Download URL not found");
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        toast.error(`Error downloading file: ${error.message || 'Unknown error'}`);
    } finally {
        downloading.value[item.id] = false;
    }
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

        // Start timing the upload
        const startTime = performance.now();

        // Try to upload to S3
        let result = null;
        try {
            result = await uploadService.uploadFile(file, "password", currentFolderId.value, (progress) => {
                uploadProgress.value[fileId] = progress;
            });
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
        } else {
            toast.info(`${file.name} saved locally and will upload when connection is available`);
        }

        return result;
    } catch (error) {
        uploadsInProgress.value--;
        console.error('File processing failed:', error);
        toast.error(`Failed to process ${file.name}`);
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
    </div>
</template>
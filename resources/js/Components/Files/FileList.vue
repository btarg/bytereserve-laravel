<!-- filepath: /c:/Users/BenTa/Documents/Laravel/chirper/resources/js/Components/Files/FileList.vue -->
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, defineProps, defineEmits } from 'vue';
import { FileItem } from '../../types';
import {
    FolderIcon,
    DocumentIcon,
    CheckCircleIcon,
    ArrowDownTrayIcon
} from '@heroicons/vue/24/outline';

import { S3UploadService } from "@/util/S3UploadService";
import { useToast } from "vue-toastification";
import { CacheableFetch } from '@/util/CacheableFetch';
import { route } from '../../../../vendor/tightenco/ziggy/src/js';

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
const workers = new Map<string, Worker>();
const selectedItems = ref<FileItem[]>([]);
const files = ref<FileItem[]>([]);
const currentFolderId = ref<number | null>(null);
const downloading = ref<Record<number, boolean>>({});

const uploadService = new S3UploadService();
const uploadProgress = ref<Record<string, number>>({});
const uploadsInProgress = ref<number>(0);

const clearExplorerCaches = async () => {
    try {
        window.cacheFetch.clearCaches();
    } catch (error) {
        console.error('Error clearing explorer caches:', error);
    }
}

const refreshFiles = async () => {
    console.log("Refreshing files");
    selectedItems.value = [];
    emit('selection-change', []);
    
    try {
        // Clear all explorer caches to ensure we get fresh data
        await clearExplorerCaches();
        console.log('Explorer caches cleared');
        
        // Then fetch with network-only to ensure fresh data
        await fetchItems();
    } catch (error) {
        console.error('Error refreshing files:', error);
        toast.error("Failed to refresh files");
    }
};

defineExpose({
    refreshFiles
});

const handleItemClick = async (item: FileItem) => {
    if (item.type === 'folder') {
        // Navigate to the folder
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

// Fetch files and folders for the current path
const fetchItems = async () => {
    isLoading.value = true;
    try {
        const response = await window.cacheFetch.get(
            // Convert the route to a URL with query parameters
            route('explorer.index') + '?' + new URLSearchParams({
                path: props.currentPath
            }).toString(),
        );

        const data = await response.json();


        files.value = data.items.map(item => {
            // For folders, create the correct path
            let itemPath = '';
            if (item.type === 'folder') {
                // Construct proper folder path
                itemPath = `${props.currentPath === '/' ? '' : props.currentPath}/${item.name}`;
            } else {
                // For files, use the path from the database (S3 key)
                itemPath = item.path || '';
            }

            return {
                id: item.id,
                name: item.name,
                type: item.type, // Use the explicitly set type from backend
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
    } finally {
        isLoading.value = false;
    }
};

// Format file size for display
const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
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
        
        const result = await uploadService.uploadFile(file, "password", currentFolderId.value, (progress) => {
            uploadProgress.value[fileId] = progress;
        });
        
        // Calculate upload duration
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000; // Convert to seconds
        
        uploadsInProgress.value--;
        console.log(`Upload completed: ${result.name} (${formatFileSize(file.size)}) in ${duration.toFixed(2)}s`);
        toast.success(`Uploaded ${file.name} in ${duration.toFixed(2)}s`);
        
        // Don't call refreshFiles() inside the loop - we'll refresh once at the end
        return result;
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
        // IMPORTANT: Refresh files once after all uploads complete
        await refreshFiles();
    }
};

watch(() => props.currentPath, () => {
    selectedItems.value = [];
    emit('selection-change', []);
    fetchItems();
});

onMounted(() => {
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    window.addEventListener('popstate', handlePopState);
    fetchItems();
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
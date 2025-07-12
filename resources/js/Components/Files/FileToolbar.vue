<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import {
    ArrowDownTrayIcon,
    TrashIcon,
    FolderPlusIcon,
    ArrowUpTrayIcon
} from '@heroicons/vue/24/outline';
import { UIFileEntry } from '../../types';
import { route } from 'ziggy-js';
import { Files, Folders } from '@/util/database/ModelRegistry';
import { storeNewFolder } from '@/util/uploads/FolderManagement';
import UploadConfigModal from './UploadConfigModal.vue';

const props = defineProps<{
    selectedItems: UIFileEntry[];
    currentPath: string;
}>();

const emit = defineEmits<{
    (e: 'path-change', path: string): void;
    (e: 'refresh-files', forceSync?: boolean): void;
    (e: 'upload-files', files: FileList, config: any): void;
}>();

const isCreatingFolder = ref(false);
const newFolderName = ref('');
const downloading = ref(false);
const showUploadModal = ref(false);
const pendingFiles = ref<FileList | null>(null);
const encryptionKey = ref('');

const newFolderInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// Watch for changes to isCreatingFolder
watch(isCreatingFolder, async (newValue) => {
    if (newValue) {
        // Wait for DOM to update
        await nextTick();
        // Focus the input
        newFolderInput.value?.focus();
    }
});

const createNewFolder = async () => {
    if (!newFolderName.value.trim()) return;

    isCreatingFolder.value = true;
    try {
        
        await storeNewFolder(props.currentPath, newFolderName.value.trim());
        
        // Reset UI state
        isCreatingFolder.value = false;
        newFolderName.value = '';

        // Force refresh with true parameter to ensure fresh data after folder creation
        emit('refresh-files', true);
        
    } catch (error) {
        console.error('Failed to create folder:', error);
        isCreatingFolder.value = false;
    }
};

const downloadSelectedFiles = async () => {
    const filesToDownload = props.selectedItems.filter(item => item.type === 'file');
    
    if (filesToDownload.length === 0) {
        alert('No files selected for download');
        return;
    }

    downloading.value = true;

    try {
        for (const file of filesToDownload) {
            const response = await window.cacheFetch.get(route('files.download.' + file.id));
            const data = await response.json();

            if (data.download_url) {
                const link = document.createElement('a');
                link.href = data.download_url;
                link.setAttribute('download', file.name);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Add a small delay between downloads to avoid browser blocking
                if (filesToDownload.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
    } catch (error) {
        console.error('Error downloading files:', error);
    } finally {
        downloading.value = false;
    }
};

const deleteSelectedItems = async () => {
    if (!props.selectedItems.length) return;

    if (!confirm(`Are you sure you want to delete ${props.selectedItems.length} item(s)?`)) {
        return;
    }

    try {
        for (const item of props.selectedItems) {
            if (item.type === 'file') {
                // Delete from the server
                await window.cacheFetch.delete(route('files.destroy.{file}', { file: item.id }));

                // Also delete from IndexedDB
                try {
                    await Files().delete(item.id);
                    console.log(`File ${item.id} deleted from IndexedDB`);
                } catch (dbError) {
                    console.warn(`Could not delete file ${item.id} from IndexedDB:`, dbError);
                }
            } else {
                // Delete from the server
                await window.cacheFetch.delete(route('folders.destroy.{folder}', { folder: item.id }));

                // Also delete from IndexedDB
                try {
                    await Folders().delete(item.id);
                    console.log(`Folder ${item.id} deleted from IndexedDB`);
                } catch (dbError) {
                    console.warn(`Could not delete folder ${item.id} from IndexedDB:`, dbError);
                }
            }
        }

        // Refresh the UI
        emit('refresh-files');
    } catch (error) {
        console.error('Failed to delete items:', error);
    }
};

const triggerFileUpload = () => {
    fileInput.value?.click();
};

const handleFileSelection = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        pendingFiles.value = target.files;
        showUploadModal.value = true;
    }
};

const handleUploadSubmit = (config: any) => {
    if (pendingFiles.value) {
        // Close modal immediately to prevent spam clicking
        showUploadModal.value = false;
        const filesToUpload = pendingFiles.value;
        pendingFiles.value = null;
        
        // Reset the file input
        if (fileInput.value) {
            fileInput.value.value = '';
        }
        
        // Emit the upload event
        emit('upload-files', filesToUpload, config);
    }
};

const handleUploadCancel = () => {
    showUploadModal.value = false;
    pendingFiles.value = null;
    
    // Reset the file input
    if (fileInput.value) {
        fileInput.value.value = '';
    }
};


</script>

<template>
    <div class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 transition-colors duration-200">
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <!-- New Folder Button -->
                <button v-if="!isCreatingFolder" @click="isCreatingFolder = true"
                    class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition-colors duration-200">
                    <FolderPlusIcon class="w-5 h-5 mr-2" />
                    New Folder
                </button>

                <!-- New Folder Form -->
                <form v-else @submit.prevent="createNewFolder" class="flex items-center space-x-2">
                    <input type="text" ref="newFolderInput" v-model="newFolderName" placeholder="Enter folder name"
                        class="block w-64 rounded-lg border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:focus:border-blue-400 dark:focus:ring-blue-400 sm:text-sm transition-colors duration-200"
                        autoFocus />
                    <button type="submit"
                        class="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 focus:outline-none transition-colors duration-200">
                        Create
                    </button>
                    <button type="button" @click="isCreatingFolder = false"
                        class="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none transition-colors duration-200">
                        Cancel
                    </button>
                </form>

                <!-- Upload Button -->
                <button @click="triggerFileUpload"
                    class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-gray-800 transition-colors duration-200">
                    <ArrowUpTrayIcon class="w-5 h-5 mr-2" />
                    Upload Files
                </button>

                <!-- Hidden file input -->
                <input
                    ref="fileInput"
                    type="file"
                    multiple
                    @change="handleFileSelection"
                    class="hidden"
                />
            </div>
            
            <div class="flex items-center space-x-3">
                <!-- Download Button -->
                <button :disabled="selectedItems.filter(item => item.type === 'file').length === 0"
                    @click="downloadSelectedFiles"
                    class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200">
                    <template v-if="downloading">
                        <span
                            class="animate-spin h-5 w-5 mr-2 border-2 border-blue-500 dark:border-blue-400 rounded-full border-t-transparent"></span>
                    </template>
                    <ArrowDownTrayIcon v-else class="w-5 h-5 mr-2" />
                    Download
                    <span v-if="selectedItems.filter(item => item.type === 'file').length > 0" 
                          class="ml-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full">
                        {{ selectedItems.filter(item => item.type === 'file').length }}
                    </span>
                </button>

                <!-- Delete Button -->
                <button :disabled="selectedItems.length === 0" @click="deleteSelectedItems"
                    class="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-600">
                    <TrashIcon class="w-5 h-5 mr-2" />
                    Delete
                    <span v-if="selectedItems.length > 0" 
                          class="ml-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full">
                        {{ selectedItems.length }}
                    </span>
                </button>
            </div>
        </div>

        <!-- Upload Configuration Modal -->
        <UploadConfigModal
            :show="showUploadModal"
            v-model:encryptionKey="encryptionKey"
            @submit="handleUploadSubmit"
            @cancel="handleUploadCancel"
        />
    </div>
</template>
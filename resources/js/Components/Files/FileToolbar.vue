<!-- filepath: /c:/Users/BenTa/Documents/Laravel/chirper/resources/js/Components/Files/FileToolbar.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import {
    ArrowDownTrayIcon,
    TrashIcon,
    ShareIcon,
    FolderPlusIcon
} from '@heroicons/vue/24/outline';
import { FileItem } from '../../types';
import { route } from 'ziggy-js';
import { Files, Folders } from '@/util/database/ModelRegistry';
import { FolderRecord } from '@/util/database/Schemas';

const props = defineProps<{
    selectedItems: FileItem[];
    currentPath: string;
}>();

const emit = defineEmits<{
    (e: 'path-change', path: string): void;
    (e: 'refresh-files', forceSync?: boolean): void;
}>();

const isCreatingFolder = ref(false);
const newFolderName = ref('');
const downloading = ref(false);

const createNewFolder = async () => {
    if (!newFolderName.value.trim()) return;

    try {
        isCreatingFolder.value = true;
        
        // Create on the server
        const response = await window.cacheFetch.post(route('folders.store'), {
            name: newFolderName.value,
            parent_path: props.currentPath
        });
        
        // Get the newly created folder data
        const folderData = await response.json();
        
        // Also save to IndexedDB for offline access
        if (folderData && folderData.id) {
            try {
                // Create folder record for IndexedDB
                const folderRecord: FolderRecord = {
                    id: folderData.id,
                    name: folderData.name,
                    type: 'folder',
                    path: props.currentPath === '/' ? 
                        `/${folderData.name}` : 
                        `${props.currentPath}/${folderData.name}`,
                    parent_id: folderData.parent_id,
                    size: 0,
                    created_at: Date.now(),
                    updated_at: Date.now()
                };
                
                // Save to IndexedDB
                await Folders().save(folderRecord);
                console.log(`Folder ${folderData.id} saved to IndexedDB`);

            } catch (dbError) {
                console.warn(`Could not save folder to IndexedDB:`, dbError);
            }
        }
        
        // Give the server a moment to process the folder creation
        await new Promise(resolve => setTimeout(resolve, 300));
        
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

const downloadSelectedFile = async () => {
    if (props.selectedItems.length !== 1 || props.selectedItems[0].type !== 'file') return;

    const file = props.selectedItems[0];
    downloading.value = true;

    try {
        const response = await window.cacheFetch.get(route('files.download.' + file.id));
        const data = await response.json();

        if (data.download_url) {
            const link = document.createElement('a');
            link.href = data.download_url;
            link.setAttribute('download', file.name);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    } catch (error) {
        console.error('Error downloading file:', error);
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


</script>

<template>
    <div class="bg-white border-b border-gray-200 p-4">
        <div class="flex items-center space-x-4">
            <!-- New Folder Button -->
            <button v-if="!isCreatingFolder" @click="isCreatingFolder = true"
                class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                <FolderPlusIcon class="w-5 h-5 mr-2" />
                New Folder
            </button>

            <!-- New Folder Form -->
            <form v-else @submit.prevent="createNewFolder" class="flex items-center space-x-2">
                <input type="text" v-model="newFolderName" placeholder="Enter folder name"
                    class="block w-64 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    autoFocus />
                <button type="submit"
                    class="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none">
                    Create
                </button>
                <button type="button" @click="isCreatingFolder = false"
                    class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md bg-white hover:bg-gray-50 focus:outline-none">
                    Cancel
                </button>
            </form>

            <!-- Share Button -->
            <button :disabled="selectedItems.length === 0"
                class="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
                <ShareIcon class="w-5 h-5 mr-2" />
                Share
            </button>

            <!-- Download Button -->
            <button :disabled="selectedItems.length !== 1 || selectedItems[0].type !== 'file'"
                @click="downloadSelectedFile"
                class="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
                <template v-if="downloading">
                    <span
                        class="animate-spin h-5 w-5 mr-2 border-2 border-blue-500 rounded-full border-t-transparent"></span>
                </template>
                <ArrowDownTrayIcon v-else class="w-5 h-5 mr-2" />
                Download
            </button>

            <!-- Delete Button -->
            <button :disabled="selectedItems.length === 0" @click="deleteSelectedItems"
                class="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
                <TrashIcon class="w-5 h-5 mr-2" />
                Delete
            </button>
        </div>
    </div>
</template>
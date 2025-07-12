<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { UIFileEntry } from '../../types.ts';
import FileList from './FileList.vue';
import FileToolbar from './FileToolbar.vue';
import Breadcrumb from './Breadcrumb.vue';

const currentPath = ref('/');
const selectedItems = ref<UIFileEntry[]>([]);
const fileListRef = ref<InstanceType<typeof FileList> | null>(null);

const refreshFileList = (forceSync = false) => {
    if (fileListRef.value) {
        fileListRef.value.refreshFiles(forceSync);
    }
};

onMounted(() => {
    // Check for folder in URL on initial load
    const urlParams = new URLSearchParams(window.location.search);
    const folderPath = urlParams.get('folder');

    if (folderPath) {
        currentPath.value = folderPath;
    }
});

const handlePathChange = (newPath: string) => {
    currentPath.value = newPath;

    // Update URL when path changes
    const url = new URL(window.location.href);
    url.searchParams.set('folder', newPath);
    history.pushState({}, '', url);
};

const handleSelectionChange = (items: UIFileEntry[]) => {
    selectedItems.value = items;
};

const handleUploadFiles = (files: FileList, config: any) => {
    if (fileListRef.value) {
        fileListRef.value.handleUploadFiles(files, config);
    }
};
</script>

<template>
    <div class="h-screen bg-gray-50">
        <div class="flex flex-col h-full">
            <!-- Header -->
            <header class="bg-white border-b border-gray-200 px-6 py-4">
                <h1 class="text-2xl font-semibold text-gray-800">Files</h1>
            </header>

            <!-- Main content -->
            <div class="flex-1 flex">
                

                <!-- Main content area -->
                <main class="flex-1 flex flex-col">
                    <FileToolbar :selected-items="selectedItems" :current-path="currentPath"
                        @path-change="handlePathChange" @refresh-files="(forceSync) => refreshFileList(forceSync)" 
                        @upload-files="handleUploadFiles" />
                    <Breadcrumb :current-path="currentPath" @path-change="handlePathChange" />
                    <FileList ref="fileListRef" :current-path="currentPath" @selection-change="handleSelectionChange"
                        @path-change="handlePathChange" />
                </main>
            </div>
        </div>
    </div>
</template>
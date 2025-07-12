<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { UIFileEntry } from '../../types.ts';
import FileList from './FileList.vue';
import FileToolbar from './FileToolbar.vue';
import Breadcrumb from './Breadcrumb.vue';
import { useDarkMode } from '@/composables/useDarkMode';
import { MoonIcon, SunIcon } from '@heroicons/vue/24/outline';

const { isDarkMode, toggleDarkMode } = useDarkMode();

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
    <div class="h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
        <div class="flex flex-col h-full">
            <!-- Header -->
            <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 transition-colors duration-200">
                <div class="flex justify-between items-center">
                    <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Files</h1>
                    
                    <!-- Dark mode toggle -->
                    <button 
                        @click="toggleDarkMode"
                        class="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200"
                        :title="isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
                    >
                        <SunIcon v-if="isDarkMode" class="w-5 h-5 text-yellow-500" />
                        <MoonIcon v-else class="w-5 h-5 text-gray-600" />
                    </button>
                </div>
            </header>

            <!-- Main content -->
            <div class="flex-1 flex overflow-hidden">
                <!-- Main content area -->
                <main class="flex-1 flex flex-col">
                    <FileToolbar 
                        :selected-items="selectedItems" 
                        :current-path="currentPath"
                        @path-change="handlePathChange" 
                        @refresh-files="(forceSync) => refreshFileList(forceSync)" 
                        @upload-files="handleUploadFiles" 
                    />
                    <Breadcrumb :current-path="currentPath" @path-change="handlePathChange" />
                    <FileList 
                        ref="fileListRef" 
                        :current-path="currentPath" 
                        @selection-change="handleSelectionChange"
                        @path-change="handlePathChange" 
                    />
                </main>
            </div>
        </div>
    </div>
</template>
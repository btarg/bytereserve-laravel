<template>
    <div class="relative">
        <div
            v-if="shareStatus !== null"
            class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full transition-colors duration-200"
            :class="shareStatus.is_active 
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'"
        >
            <EyeIcon v-if="shareStatus.is_active" class="w-3 h-3 mr-1" />
            <EyeSlashIcon v-else class="w-3 h-3 mr-1" />
            
            <span v-if="shareStatus.is_active">
                {{ shareStatus.download_count || 0 }}
            </span>
            <span v-else>
                Off
            </span>
        </div>
        
        <div v-else-if="loading" class="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
            <div class="w-3 h-3 mr-1 animate-spin rounded-full border border-gray-300 dark:border-gray-600 border-t-transparent"></div>
            ...
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { EyeIcon, EyeSlashIcon } from '@heroicons/vue/24/outline';
import { route } from 'ziggy-js';

interface ShareStatus {
    is_active: boolean;
    download_count: number;
    token: string;
}

const props = defineProps<{
    fileId: number;
}>();

const shareStatus = ref<ShareStatus | null>(null);
const loading = ref(false);

const loadShareStatus = async () => {
    if (!props.fileId) return;
    
    loading.value = true;
    try {
        const response = await window.cacheFetch.get(
            route('files.share', { file: props.fileId }),
            {},
            { 
                maxAge: 60000, // Cache for 1 minute
                cacheName: 'share-status'
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            shareStatus.value = {
                is_active: data.is_active,
                download_count: data.download_count || 0,
                token: data.token
            };
        } else {
            shareStatus.value = null;
        }
    } catch (error) {
        console.error('Error loading share status:', error);
        shareStatus.value = null;
    } finally {
        loading.value = false;
    }
};

// Watch for fileId changes
watch(() => props.fileId, () => {
    if (props.fileId) {
        loadShareStatus();
    }
}, { immediate: true });

onMounted(() => {
    if (props.fileId) {
        loadShareStatus();
    }
});

// Expose method to refresh status (for parent components)
defineExpose({
    refreshStatus: loadShareStatus
});
</script>

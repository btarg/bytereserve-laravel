<template>
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        @click="handleBackdropClick">
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 w-96 max-w-md mx-4 border border-gray-200 dark:border-gray-700" @click.stop>
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center">
                    <div class="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mr-3">
                        <svg class="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z">
                            </path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-lg font-medium text-gray-900 dark:text-white">Share File</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400">Create a shareable link</p>
                    </div>
                </div>
                <button @click="handleCancel" class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clip-rule="evenodd"></path>
                    </svg>
                </button>
            </div>

            <div class="mb-4">
                <div class="flex items-center mb-3">
                    <FileTypeIcon v-if="fileName" :fileName="fileName" size="w-5 h-5" className="mr-2" />
                    <p class="text-sm text-gray-700 dark:text-gray-300">
                        Share "<span class="font-medium">{{ fileName }}</span>" with others.
                    </p>
                </div>

                <!-- Share Status -->
                <div class="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center">
                            <div class="w-2 h-2 rounded-full mr-2" :class="isShareEnabled ? 'bg-green-500' : 'bg-gray-400'"></div>
                            <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                                {{ isShareEnabled ? 'Share link is active' : 'Share link is disabled' }}
                            </span>
                        </div>
                        <button 
                            @click="toggleShare"
                            :disabled="isLoading"
                            class="px-3 py-1 text-xs font-medium rounded-md transition-colors"
                            :class="isShareEnabled 
                                ? 'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800' 
                                : 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800'"
                        >
                            {{ isLoading ? 'Updating...' : (isShareEnabled ? 'Disable' : 'Enable') }}
                        </button>
                    </div>
                    <div v-if="shareExists && downloadCount > 0" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Downloaded {{ downloadCount }} time{{ downloadCount !== 1 ? 's' : '' }}
                        <span v-if="maxDownloads"> of {{ maxDownloads }}</span>
                    </div>
                </div>

                <div v-if="isShareEnabled" class="mb-4">
                    <label class="flex items-center">
                        <input type="checkbox" v-model="includeEncryptionKey"
                            class="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50" />
                        <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">Include encryption key in link</span>
                    </label>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        The encryption key will be included in the URL hash and never sent to the server.
                    </p>
                </div>

                <div v-if="isShareEnabled" class="mb-4">
                    <label for="expirationOption" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Link Expiration
                    </label>
                    <select 
                        id="expirationOption" 
                        v-model="expirationOption"
                        @change="toggleShare"
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="never">Never expires</option>
                        <option value="1h">1 hour</option>
                        <option value="24h">24 hours</option>
                        <option value="7d">7 days</option>
                        <option value="30d">30 days</option>
                    </select>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Choose when this share link should expire and become unavailable.
                    </p>
                </div>

                <div v-if="isShareEnabled && includeEncryptionKey" class="mb-4">
                    <label for="shareEncryptionKey" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Encryption Key
                    </label>
                    <input ref="keyInput" id="shareEncryptionKey" v-model="encryptionKey" data-1p-ignore
                        data-lpignore="true"
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter encryption key to include in link..." />
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        For testing, try "password"
                    </p>
                </div>

                <div v-if="isShareEnabled && shareUrl" class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Share URL
                    </label>
                    <div class="flex">
                        <input ref="urlInput" :value="shareUrl" readonly
                            class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-l-md bg-gray-50 dark:bg-gray-700 dark:text-white text-sm" />
                        <button @click="copyToClipboard"
                            class="px-3 py-2 bg-blue-600 dark:bg-blue-500 text-white border border-blue-600 dark:border-blue-500 rounded-r-md hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z">
                                </path>
                            </svg>
                        </button>
                    </div>
                    <p v-if="copied" class="text-xs text-green-600 dark:text-green-400 mt-1">
                        Copied to clipboard!
                    </p>
                </div>
            </div>

            <div class="flex justify-end space-x-3">
                <button v-if="isShareEnabled && shareUrl && supportsNativeShare" @click="shareNative"
                    class="px-4 py-2 text-sm font-medium text-white bg-green-600 dark:bg-green-500 border border-transparent rounded-md hover:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500">
                    <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z">
                        </path>
                    </svg>
                    Share
                </button>
                <button @click="handleCancel"
                    class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500">
                    Done
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { route } from 'ziggy-js';
import FileTypeIcon from './FileTypeIcon.vue';

const props = defineProps<{
    show: boolean;
    fileName?: string;
    fileId?: number;
}>();

const emit = defineEmits<{
    (e: 'cancel'): void;
}>();

const includeEncryptionKey = ref(false);
const encryptionKey = ref('');
const shareUrl = ref('');
const copied = ref(false);
const keyInput = ref<HTMLInputElement>();
const urlInput = ref<HTMLInputElement>();
const expirationOption = ref<string>('never'); // never, 1h, 24h, 7d, 30d
const isShareEnabled = ref(false);
const shareExists = ref(false);
const shareToken = ref('');
const downloadCount = ref(0);
const maxDownloads = ref<number | null>(null);
const isLoading = ref(false);

// Check if native share is available
const supportsNativeShare = computed(() => {
    return typeof navigator !== 'undefined' && 'share' in navigator;
});

// Watch for show prop changes to reset the modal when it opens
watch(() => props.show, (show) => {
    if (show) {
        includeEncryptionKey.value = false;
        encryptionKey.value = '';
        shareUrl.value = '';
        copied.value = false;
        expirationOption.value = 'never';
        isShareEnabled.value = false;
        shareExists.value = false;
        shareToken.value = '';
        downloadCount.value = 0;
        maxDownloads.value = null;
        isLoading.value = false;
        nextTick(() => {
            loadShareStatus();
        });
    }
});

// Watch for encryption key checkbox changes
watch(includeEncryptionKey, (include) => {
    if (include) {
        nextTick(() => {
            keyInput.value?.focus();
        });
    } else {
        encryptionKey.value = '';
    }
    // Regenerate URL when checkbox changes
    if (shareUrl.value && isShareEnabled.value) {
        generateShareUrl();
    }
});

// Watch for encryption key changes to regenerate URL
watch(encryptionKey, () => {
    if (shareUrl.value && isShareEnabled.value) {
        generateShareUrl();
    }
});

const loadShareStatus = async () => {
    if (!props.fileId) return;
    
    try {
        isLoading.value = true;
        
        // Get current share status
        const response = await window.cacheFetch.post(route('files.share', { file: props.fileId }), {});

        if (!response.ok) {
            throw new Error('Failed to load share status');
        }

        const data = await response.json();
        
        shareExists.value = true;
        shareToken.value = data.share_token;
        isShareEnabled.value = data.is_active;
        downloadCount.value = data.download_count || 0;
        maxDownloads.value = data.max_downloads;
        
        // Update expiration option based on existing share
        if (data.expires_at) {
            const expiresAt = new Date(data.expires_at);
            const now = new Date();
            const diffHours = Math.abs(expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
            
            if (diffHours <= 1) {
                expirationOption.value = '1h';
            } else if (diffHours <= 24) {
                expirationOption.value = '24h';
            } else if (diffHours <= 168) { // 7 days
                expirationOption.value = '7d';
            } else if (diffHours <= 720) { // 30 days
                expirationOption.value = '30d';
            } else {
                expirationOption.value = 'never';
            }
        } else {
            expirationOption.value = 'never';
        }
        
        // Generate URL if share is active
        if (isShareEnabled.value) {
            generateShareUrl();
        }
    } catch (error) {
        console.error('Error loading share status:', error);
    } finally {
        isLoading.value = false;
    }
};

const toggleShare = async () => {
    if (!props.fileId) return;
    
    try {
        isLoading.value = true;
        
        const payload: any = {
            is_active: !isShareEnabled.value
        };
        
        // Add expiration if set
        if (expirationOption.value !== 'never') {
            const now = new Date();
            let expiresAt: Date;
            
            switch (expirationOption.value) {
                case '1h':
                    expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
                    break;
                case '24h':
                    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                    break;
            }
            
            if (expiresAt!) {
                payload.expires_at = expiresAt.toISOString();
            }
        }
        
        const response = await window.cacheFetch.put(route('files.share.update', { file: props.fileId }), payload);

        if (!response.ok) {
            throw new Error('Failed to update share');
        }

        const data = await response.json();
        
        isShareEnabled.value = data.is_active;
        downloadCount.value = data.download_count || 0;
        maxDownloads.value = data.max_downloads;
        
        // Generate URL if share is now active
        if (isShareEnabled.value) {
            generateShareUrl();
        } else {
            shareUrl.value = '';
        }
    } catch (error) {
        console.error('Error updating share:', error);
    } finally {
        isLoading.value = false;
    }
};

const generateShareUrl = async () => {
    if (!props.fileId || !shareToken.value) return;
    
    try {
        let url = `${window.location.origin}/share/${shareToken.value}`;
        
        // Add encryption key to URL hash if included
        if (includeEncryptionKey.value && encryptionKey.value) {
            url += `#key=${encodeURIComponent(encryptionKey.value)}`;
        }
        
        shareUrl.value = url;
        copied.value = false;
        
        // Automatically copy to clipboard when URL is generated
        await copyToClipboard();
    } catch (error) {
        console.error('Error generating share URL:', error);
    }
};

const copyToClipboard = async () => {
    if (!shareUrl.value) return;
    
    try {
        await navigator.clipboard.writeText(shareUrl.value);
        copied.value = true;
        setTimeout(() => {
            copied.value = false;
        }, 2000);
    } catch (error) {
        console.error('Error copying to clipboard:', error);
    }
};

const shareNative = async () => {
    if (!shareUrl.value) return;
    
    try {
        if (navigator.share) {
            await navigator.share({
                title: `Shared file: ${props.fileName}`,
                text: `Check out this file: ${props.fileName}`,
                url: shareUrl.value
            });
        } else {
            // Fallback to copying
            await copyToClipboard();
        }
    } catch (error) {
        console.error('Error sharing:', error);
        // Fallback to copying
        await copyToClipboard();
    }
};

const copyAndClose = async () => {
    await copyToClipboard();
    setTimeout(() => {
        handleCancel();
    }, 500); // Small delay to show the "copied" message
};

const handleCancel = () => {
    emit('cancel');
};

const handleBackdropClick = () => {
    handleCancel();
};
</script>

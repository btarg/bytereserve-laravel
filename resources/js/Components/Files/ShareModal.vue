<template>
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        @click="handleBackdropClick">
        <div class="bg-white rounded-lg p-6 w-96 max-w-md mx-4" @click.stop>
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center">
                    <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                        <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z">
                            </path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-lg font-medium text-gray-900">Share File</h3>
                        <p class="text-sm text-gray-500">Create a shareable link</p>
                    </div>
                </div>
                <button @click="handleCancel" class="text-gray-400 hover:text-gray-600">
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
                    <p class="text-sm text-gray-700">
                        Share "<span class="font-medium">{{ fileName }}</span>" with others.
                    </p>
                </div>

                <div class="mb-4">
                    <label class="flex items-center">
                        <input type="checkbox" v-model="includeEncryptionKey"
                            class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50" />
                        <span class="ml-2 text-sm text-gray-700">Include encryption key in link</span>
                    </label>
                    <p class="text-xs text-gray-500 mt-1">
                        The encryption key will be included in the URL hash and never sent to the server.
                    </p>
                </div>

                <div class="mb-4">
                    <label for="expirationOption" class="block text-sm font-medium text-gray-700 mb-2">
                        Link Expiration
                    </label>
                    <select id="expirationOption" v-model="expirationOption"
                        class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        <option value="never">Never expires</option>
                        <option value="1h">1 hour</option>
                        <option value="24h">24 hours</option>
                        <option value="7d">7 days</option>
                        <option value="30d">30 days</option>
                    </select>
                    <p class="text-xs text-gray-500 mt-1">
                        Choose when this share link should expire and become unavailable.
                    </p>
                </div>

                <div v-if="includeEncryptionKey" class="mb-4">
                    <label for="shareEncryptionKey" class="block text-sm font-medium text-gray-700 mb-2">
                        Encryption Key
                    </label>
                    <input ref="keyInput" id="shareEncryptionKey" v-model="encryptionKey" data-1p-ignore
                        data-lpignore="true"
                        class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter encryption key to include in link..." />
                    <p class="text-xs text-gray-500 mt-1">
                        For testing, try "password"
                    </p>
                </div>

                <div v-if="shareUrl" class="mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        Share URL
                    </label>
                    <div class="flex">
                        <input ref="urlInput" :value="shareUrl" readonly
                            class="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-gray-50 text-sm" />
                        <button @click="copyToClipboard"
                            class="px-3 py-2 bg-blue-600 text-white border border-blue-600 rounded-r-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z">
                                </path>
                            </svg>
                        </button>
                    </div>
                    <p v-if="copied" class="text-xs text-green-600 mt-1">
                        Copied to clipboard!
                    </p>
                </div>
            </div>

            <div class="flex justify-end space-x-3">

                <button v-if="shareUrl && supportsNativeShare" @click="shareNative"
                    class="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500">
                    <svg class="w-4 h-4 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z">
                        </path>
                    </svg>
                    Share
                </button>
                <button @click="handleCancel"
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500">
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
        nextTick(() => {
            generateShareUrl();
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
    if (shareUrl.value) {
        generateShareUrl();
    }
});

// Watch for encryption key changes to regenerate URL
watch(encryptionKey, () => {
    if (shareUrl.value) {
        generateShareUrl();
    }
});

// Watch for expiration option changes to regenerate URL
watch(expirationOption, () => {
    if (shareUrl.value) {
        generateShareUrl();
    }
});

const generateShareUrl = async () => {
    if (!props.fileId) return;
    
    try {
        // Prepare request payload with expiration
        const payload: any = {};
        
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
        
        // Create share link on the server
        const response = await window.cacheFetch.post(route('files.share', { file: props.fileId }), payload);

        if (!response.ok) {
            throw new Error('Failed to generate share link');
        }

        const data = await response.json();
        let url = `${window.location.origin}/share/${data.share_token}`;
        
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

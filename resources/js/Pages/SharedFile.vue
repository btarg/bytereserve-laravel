<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { Head } from '@inertiajs/vue3';
import { S3DownloadService } from '@/util/downloads/S3DownloadService';
import { formatFileSize } from '@/util/FormattingUtils';
import FileTypeIcon from '@/Components/Files/FileTypeIcon.vue';

interface Props {
    share_token: string;
    file_name: string;
    file_size: number;
    mime_type?: string;
    uploader?: string;
}

const props = defineProps<Props>();

const downloadService = new S3DownloadService();
const downloading = ref(false);
const encryptionKey = ref('');
const downloadProgress = ref(0);
const errorMessage = ref('');
const successMessage = ref('');
const previewUrl = ref('');
const previewType = ref<'none' | 'image' | 'video' | 'audio' | 'text' | 'pdf'>('none');
const previewContent = ref('');
const showPreview = ref(false);
const decryptedBlob = ref<Blob | null>(null); // Store decrypted blob to avoid re-decryption

// Cleanup blob URLs on component unmount
onUnmounted(() => {
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl.value);
    }
    // Clean up decrypted blob reference
    if (decryptedBlob.value) {
        decryptedBlob.value = null;
    }
});

// Check URL hash for encryption key
onMounted(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#key=')) {
        encryptionKey.value = decodeURIComponent(hash.substring(5));
    }

    // Try to load preview if no encryption key is needed
    if (!encryptionKey.value) {
        loadPreview();
    }
});

// Computed property to determine file type
const fileType = computed(() => {
    const ext = props.file_name.split('.').pop()?.toLowerCase();
    const mimeType = props.mime_type?.toLowerCase();

    if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) {
        return 'image';
    } else if (mimeType?.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext || '')) {
        return 'video';
    } else if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext || '')) {
        return 'audio';
    } else if (mimeType === 'application/pdf' || ext === 'pdf') {
        return 'pdf';
    } else if (mimeType?.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'csv', 'log'].includes(ext || '')) {
        return 'text';
    }
    return 'unknown';
});

// Computed property to determine if file can be previewed
const isPreviewable = computed(() => {
    return ['image', 'video', 'audio', 'pdf', 'text'].includes(fileType.value);
});

const loadPreview = async () => {
    // Don't try to load preview for non-previewable files
    if (!isPreviewable.value) {
        return;
    }

    try {
        // Get preview URL for shared file (inline display)
        const response = await fetch(`/share/${props.share_token}/preview`, {
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            return; // No preview available
        }

        const data = await response.json();

        // Try to load preview directly for unencrypted files
        // If the file is encrypted, this will fail gracefully
        if (fileType.value === 'image' || fileType.value === 'video' || fileType.value === 'audio' || fileType.value === 'pdf') {
            // Test if we can load the resource directly (will fail if encrypted)
            try {
                const testResponse = await fetch(data.preview_url, {
                    method: 'HEAD' // Just check if accessible
                });
                
                if (testResponse.ok) {
                    previewUrl.value = data.preview_url;
                    previewType.value = fileType.value;
                    showPreview.value = true;
                } else {
                    console.log('File preview not accessible, likely encrypted');
                }
            } catch (error) {
                console.log('Could not load preview, likely encrypted:', error);
            }
        } else if (fileType.value === 'text') {
            // Load text content for preview
            try {
                const textResponse = await fetch(data.preview_url);
                if (textResponse.ok) {
                    const text = await textResponse.text();
                    // Check if the text looks like encrypted binary data
                    if (text.length > 0 && text.charCodeAt(0) < 32 && text.includes('\x00')) {
                        console.log('Text file appears to be encrypted');
                        return;
                    }
                    previewContent.value = text.substring(0, 5000); // Limit to 5KB
                    previewType.value = 'text';
                    showPreview.value = true;
                }
            } catch (error) {
                console.log('Could not load text preview:', error);
            }
        }
    } catch (error) {
        console.log('Preview not available:', error);
    }
};

const decryptAndPreview = async () => {
    if (!encryptionKey.value.trim()) {
        errorMessage.value = 'Please enter the decryption key';
        return;
    }

    try {
        downloading.value = true;
        errorMessage.value = '';
        successMessage.value = '';
        downloadProgress.value = 0;

        // Get download URL for shared file
        const response = await window.cacheFetch.fetch(`/share/${props.share_token}/download`);

        if (!response.ok) {
            throw new Error('Failed to get download URL');
        }

        const data = await response.json();

        // Download and decrypt the file
        const encryptedResponse = await fetch(data.download_url);
        if (!encryptedResponse.ok) {
            throw new Error('Failed to download file');
        }

        const encryptedData = await encryptedResponse.arrayBuffer();

        // Decrypt the file
        const decryptedData = await downloadService.decryptFile(encryptedData, encryptionKey.value);

        // Create blob for preview or download
        const blob = new Blob([decryptedData]);
        decryptedBlob.value = blob; // Store for later use

        if (isPreviewable.value) {
            // Update preview with decrypted content
            updatePreviewWithDecryptedContent(blob);
            successMessage.value = 'File decrypted successfully! You can now preview or download it.';
        } else {
            // For non-previewable files, trigger download directly
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = props.file_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            successMessage.value = 'File decrypted and downloaded successfully!';
        }

    } catch (error) {
        console.error('Decryption failed:', error);
        errorMessage.value = error instanceof Error ? error.message : 'Decryption failed. Please check your decryption key.';
    } finally {
        downloading.value = false;
    }
};

const downloadDecryptedFile = async () => {
    // If we already have a decrypted blob, use it directly
    if (decryptedBlob.value) {
        try {
            downloading.value = true;
            
            const url = URL.createObjectURL(decryptedBlob.value);
            const a = document.createElement('a');
            a.href = url;
            a.download = props.file_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            successMessage.value = 'File downloaded successfully!';
        } catch (error) {
            console.error('Download failed:', error);
            errorMessage.value = 'Download failed. Please try again.';
        } finally {
            downloading.value = false;
        }
        return;
    }

    // Fallback: decrypt again if no blob is available
    if (!encryptionKey.value.trim()) {
        errorMessage.value = 'Please enter the decryption key';
        return;
    }

    try {
        downloading.value = true;
        errorMessage.value = '';
        downloadProgress.value = 0;

        // Get download URL for shared file
        const response = await fetch(`/share/${props.share_token}/download`, {
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to get download URL');
        }

        const data = await response.json();

        // Download and decrypt the file
        const encryptedResponse = await fetch(data.download_url);
        if (!encryptedResponse.ok) {
            throw new Error('Failed to download file');
        }

        const encryptedData = await encryptedResponse.arrayBuffer();

        // Decrypt the file
        const decryptedData = await downloadService.decryptFile(encryptedData, encryptionKey.value);

        // Create blob and trigger download
        const blob = new Blob([decryptedData]);
        decryptedBlob.value = blob; // Store for future use
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = props.file_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        successMessage.value = 'File downloaded successfully!';

    } catch (error) {
        console.error('Download failed:', error);
        errorMessage.value = error instanceof Error ? error.message : 'Download failed. Please check your decryption key.';
    } finally {
        downloading.value = false;
    }
};

const updatePreviewWithDecryptedContent = (blob: Blob) => {
    // Only update preview for previewable files
    if (!isPreviewable.value) {
        return;
    }

    try {
        const url = URL.createObjectURL(blob);

        if (fileType.value === 'image' || fileType.value === 'video' || fileType.value === 'audio' || fileType.value === 'pdf') {
            // Clean up previous preview URL
            if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
                URL.revokeObjectURL(previewUrl.value);
            }
            previewUrl.value = url;
            previewType.value = fileType.value;
            showPreview.value = true;
        } else if (fileType.value === 'text') {
            // Read text content for preview
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result as string;
                previewContent.value = text.substring(0, 5000); // Limit to 5KB
                previewType.value = 'text';
                showPreview.value = true;
            };
            reader.readAsText(blob);
            URL.revokeObjectURL(url); // Clean up since we're not using it for text
        }
    } catch (error) {
        console.log('Could not update preview:', error);
    }
};
</script>

<template>

    <Head :title="`Download ${file_name}`" />

    <div class="min-h-screen bg-gray-100 py-8">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="bg-white rounded-lg shadow-lg overflow-hidden">
                <!-- Header -->
                <div class="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
                    <div class="flex items-center">
                        <div class="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center mr-4">
                            <FileTypeIcon :fileName="file_name" :mimeType="mime_type" size="w-6 h-6" className="text-white" />
                        </div>
                        <div>
                            <h1 class="text-2xl font-bold text-white">{{ file_name }}</h1>
                            <p class="text-blue-100">{{ formatFileSize(file_size) }} • Someone shared this file with you</p>
                        </div>
                    </div>
                </div>

                <!-- Preview Section -->
                <div v-if="showPreview" class="border-b border-gray-200">
                    <!-- Image Preview -->
                    <div v-if="previewType === 'image'" class="p-6">
                        <div class="flex justify-center">
                            <img :src="previewUrl" :alt="file_name"
                                class="max-w-full max-h-96 object-contain rounded-lg shadow-md">
                        </div>
                    </div>

                    <!-- Video Preview -->
                    <div v-else-if="previewType === 'video'" class="p-6">
                        <div class="flex justify-center">
                            <video :src="previewUrl" controls controlslist="nodownload" class="max-w-full max-h-96 rounded-lg shadow-md">
                                Your browser does not support the video tag.
                            </video>
                        </div>
                    </div>

                    <!-- Audio Preview -->
                    <div v-else-if="previewType === 'audio'" class="p-6">
                        <div class="flex justify-center">
                            <audio :src="previewUrl" controls class="w-full max-w-md">
                                Your browser does not support the audio element.
                            </audio>
                        </div>
                    </div>

                    <!-- PDF Preview -->
                    <div v-else-if="previewType === 'pdf'" class="p-6">
                        <div class="flex justify-center">
                            <iframe :src="previewUrl" class="w-full h-96 border rounded-lg shadow-md"></iframe>
                        </div>
                    </div>

                    <!-- Text Preview -->
                    <div v-else-if="previewType === 'text'" class="p-6">
                        <div class="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                            <pre class="text-sm text-gray-800 whitespace-pre-wrap">{{ previewContent }}</pre>
                        </div>
                        <p v-if="previewContent.length >= 5000" class="text-sm text-gray-500 mt-2">
                            Preview truncated. Download the full file to see all content.
                        </p>
                    </div>
                </div>

                <!-- Download Section -->
                <div class="p-6">
                    <!-- Status Messages -->
                    <div v-if="errorMessage" class="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                        <div class="flex items-center">
                            <svg class="w-5 h-5 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd"
                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                    clip-rule="evenodd"></path>
                            </svg>
                            <p class="text-sm text-red-800">{{ errorMessage }}</p>
                        </div>
                    </div>

                    <div v-if="successMessage" class="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                        <div class="flex items-center">
                            <svg class="w-5 h-5 text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd"
                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                    clip-rule="evenodd"></path>
                            </svg>
                            <p class="text-sm text-green-800">{{ successMessage }}</p>
                        </div>
                    </div>

                    <!-- Download Progress -->
                    <div v-if="downloading" class="mb-6">
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                :style="{ width: downloadProgress + '%' }"></div>
                        </div>
                        <p class="text-sm text-gray-600 mt-2 text-center">Downloading and decrypting...</p>
                    </div>

                    <!-- Encryption Key Section -->
                    <div class="mb-6">
                        <label for="encryptionKey" class="block text-sm font-medium text-gray-700 mb-2">
                            <div class="flex items-center">
                                <svg class="w-4 h-4 text-gray-400 mr-2" fill="none" stroke="currentColor"
                                    viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z">
                                    </path>
                                </svg>
                                Decryption Key
                            </div>
                        </label>
                        <input id="encryptionKey" v-model="encryptionKey" type="password" autocomplete="one-time-code"
                            data-1p-ignore data-lpignore="true"
                            class="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Enter decryption key..." @keyup.enter="decryptAndPreview" />
                        <p class="text-xs text-gray-500 mt-1">
                            This file is encrypted. Enter the decryption key that was shared with you.
                        </p>
                    </div>

                    <!-- Action Buttons -->
                    <div class="flex flex-col sm:flex-row gap-3">
                        <!-- Decrypt and Preview Button (for previewable files) -->
                        <button v-if="isPreviewable && !showPreview" @click="decryptAndPreview"
                            :disabled="downloading || !encryptionKey.trim()"
                            class="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors">
                            <span v-if="downloading" class="flex items-center justify-center">
                                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                    </path>
                                </svg>
                                Decrypting...
                            </span>
                            <span v-else>
                                <svg class="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor"
                                    viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z">
                                    </path>
                                </svg>
                                Decrypt & Preview
                            </span>
                        </button>

                        <!-- Decrypt and Download Button (for non-previewable files) -->
                        <button v-if="!isPreviewable" @click="decryptAndPreview"
                            :disabled="downloading || !encryptionKey.trim()"
                            class="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors">
                            <span v-if="downloading" class="flex items-center justify-center">
                                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                    </path>
                                </svg>
                                Decrypting & Downloading...
                            </span>
                            <span v-else>
                                <svg class="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor"
                                    viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z">
                                    </path>
                                </svg>
                                Decrypt & Download
                            </span>
                        </button>

                        <!-- Download Button (shown when preview is available for previewable files) -->
                        <button v-if="isPreviewable && showPreview" @click="downloadDecryptedFile" :disabled="downloading"
                            class="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors">
                            <span v-if="downloading" class="flex items-center justify-center">
                                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                        stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                    </path>
                                </svg>
                                Downloading...
                            </span>
                            <span v-else>
                                <svg class="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor"
                                    viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z">
                                    </path>
                                </svg>
                                Download File
                            </span>
                        </button>
                    </div>

                    <!-- Help Text -->
                    <div class="mt-4 text-center">
                        <p class="text-sm text-gray-500">
                            <span v-if="!isPreviewable && !encryptionKey.trim()">
                                Enter the decryption key to decrypt and download the file.
                            </span>
                            <span v-else-if="!isPreviewable && encryptionKey.trim()">
                                Click "Decrypt & Download" to download the file to your device.
                            </span>
                            <span v-else-if="isPreviewable && !showPreview && !encryptionKey.trim()">
                                Enter the decryption key to decrypt and preview the file.
                            </span>
                            <span v-else-if="isPreviewable && !showPreview && encryptionKey.trim()">
                                Click "Decrypt & Preview" to see the file content.
                            </span>
                            <span v-else-if="isPreviewable && showPreview">
                                File successfully decrypted! You can view it above or download it to your device.
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<template>
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click="handleBackdropClick">
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 w-96 max-w-md mx-4 border border-gray-200 dark:border-gray-700" @click.stop>
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center">
                    <svg class="w-6 h-6 text-blue-500 dark:text-blue-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Upload Configuration</h3>
                </div>
                <button @click="handleCancel" class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            
            <div class="mb-4">
                <p class="text-sm text-gray-700 dark:text-gray-300 mb-4">
                    Configure encryption and expiry settings for your files.
                </p>
                
                <!-- Encryption Section -->
                <div class="mb-6">
                    <label class="flex items-center">
                        <input
                            type="checkbox"
                            v-model="useEncryption"
                            class="rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                        />
                        <span class="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                            Encrypt files
                        </span>
                    </label>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Files will be encrypted before upload. Leave unchecked to upload without encryption.
                    </p>
                </div>

                <!-- Encryption Key Input -->
                <div v-if="useEncryption" class="mb-6">
                    <label for="encryptionKey" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Encryption Key
                    </label>
                    <input
                        id="encryptionKey"
                        ref="keyInput"
                        type="password"
                        v-model="localEncryptionKey"
                        @input="$emit('update:encryptionKey', localEncryptionKey)"
                        placeholder="Enter encryption key"
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p class="text-xs text-gray-500 mt-1">
                        This key will be used to encrypt your files. Keep it safe - you'll need it to decrypt later.
                    </p>
                </div>

                <!-- Expiry Section -->
                <div class="mb-6">
                    <label class="flex items-center">
                        <input
                            type="checkbox"
                            v-model="useExpiry"
                            class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span class="ml-2 text-sm font-medium text-gray-700">
                            Set expiry time
                        </span>
                    </label>
                    <p class="text-xs text-gray-500 mt-1">
                        Files will be automatically deleted after the specified time.
                    </p>
                </div>

                <!-- Expiry Time Selection -->
                <div v-if="useExpiry" class="mb-6">
                    <label for="expiryTime" class="block text-sm font-medium text-gray-700 mb-2">
                        Expiry Time
                    </label>
                    <select
                        id="expiryTime"
                        v-model="expiryOption"
                        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="1h">1 Hour</option>
                        <option value="6h">6 Hours</option>
                        <option value="24h">24 Hours</option>
                        <option value="7d">7 Days</option>
                        <option value="30d">30 Days</option>
                        <option value="custom">Custom</option>
                    </select>
                    
                    <!-- Custom expiry date/time input -->
                    <div v-if="expiryOption === 'custom'" class="mt-2">
                        <label for="customExpiry" class="block text-sm font-medium text-gray-700 mb-2">
                            Custom Expiry Date & Time
                        </label>
                        <input
                            id="customExpiry"
                            type="datetime-local"
                            v-model="customExpiryDateTime"
                            :min="minDateTime"
                            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                </div>
            </div>
            
            <div class="flex justify-end space-x-3">
                <button
                    @click="handleCancel"
                    :disabled="isSubmitting"
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Cancel
                </button>
                <button
                    @click="handleSubmit"
                    :disabled="isSubmitting"
                    class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    <svg v-if="isSubmitting" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {{ isSubmitting ? 'Uploading...' : 'Upload Files' }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';

interface UploadConfig {
    useEncryption: boolean;
    encryptionKey: string;
    useExpiry: boolean;
    expiryTime: Date | null;
}

const props = defineProps<{
    show: boolean;
    encryptionKey: string;
}>();

const emit = defineEmits<{
    (e: 'submit', config: UploadConfig): void;
    (e: 'cancel'): void;
    (e: 'update:encryptionKey', key: string): void;
}>();

const useEncryption = ref(false);
const localEncryptionKey = ref(props.encryptionKey);
const useExpiry = ref(false);
const expiryOption = ref('24h');
const customExpiryDateTime = ref('');
const keyInput = ref<HTMLInputElement>();
const isSubmitting = ref(false);

// Computed property for minimum datetime (current time)
const minDateTime = computed(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
});

// Watch for external changes to encryptionKey
watch(() => props.encryptionKey, (newKey) => {
    localEncryptionKey.value = newKey;
});

// Watch for show prop changes to reset the modal when it opens
watch(() => props.show, (show) => {
    if (show) {
        useEncryption.value = false;
        localEncryptionKey.value = '';
        useExpiry.value = false;
        expiryOption.value = '24h';
        customExpiryDateTime.value = '';
        isSubmitting.value = false;
        
        nextTick(() => {
            if (useEncryption.value) {
                keyInput.value?.focus();
            }
        });
    }
});

// Watch for encryption checkbox changes
watch(useEncryption, (enabled) => {
    if (enabled) {
        nextTick(() => {
            keyInput.value?.focus();
        });
    } else {
        localEncryptionKey.value = '';
        emit('update:encryptionKey', '');
    }
});

const calculateExpiryTime = (): Date | null => {
    if (!useExpiry.value) return null;
    
    const now = new Date();
    
    if (expiryOption.value === 'custom') {
        return customExpiryDateTime.value ? new Date(customExpiryDateTime.value) : null;
    }
    
    switch (expiryOption.value) {
        case '1h':
            return new Date(now.getTime() + 60 * 60 * 1000);
        case '6h':
            return new Date(now.getTime() + 6 * 60 * 60 * 1000);
        case '24h':
            return new Date(now.getTime() + 24 * 60 * 60 * 1000);
        case '7d':
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        case '30d':
            return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        default:
            return null;
    }
};

const handleSubmit = () => {
    if (isSubmitting.value) return; // Prevent spam clicking
    
    if (useEncryption.value && !localEncryptionKey.value.trim()) {
        keyInput.value?.focus();
        return;
    }
    
    isSubmitting.value = true;
    
    const config: UploadConfig = {
        useEncryption: useEncryption.value,
        encryptionKey: useEncryption.value ? localEncryptionKey.value : '',
        useExpiry: useExpiry.value,
        expiryTime: calculateExpiryTime()
    };
    
    emit('submit', config);
};

const handleCancel = () => {
    if (isSubmitting.value) return; // Prevent cancel during submission
    
    useEncryption.value = false;
    localEncryptionKey.value = '';
    useExpiry.value = false;
    expiryOption.value = '24h';
    customExpiryDateTime.value = '';
    isSubmitting.value = false;
    emit('cancel');
};

const handleBackdropClick = () => {
    handleCancel();
};
</script>

<template>
    <div v-if="show" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" @click="handleBackdropClick">
        <div class="bg-white rounded-lg p-6 w-96 max-w-md mx-4" @click.stop>
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center">
                    <div class="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
                        <svg class="w-4 h-4 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-lg font-semibold text-gray-900">Encrypted File Detected</h3>
                        <p class="text-sm text-gray-600">This file requires a decryption key</p>
                    </div>
                </div>
                <button @click="handleCancel" class="text-gray-400 hover:text-gray-600">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            
            <div class="mb-4">
                <p class="text-sm text-gray-700 mb-3">
                    The file 
                    <span class="inline-flex items-center font-medium">
                        <FileTypeIcon v-if="fileName" :fileName="fileName" size="w-4 h-4" className="mr-1" />
                        "{{ fileName }}"
                    </span> 
                    is encrypted. Please enter the decryption key to download it.
                </p>
                
                <label for="encryptionKey" class="block text-sm font-medium text-gray-700 mb-2">
                    Decryption Key
                </label>
                <input
                    ref="keyInput"
                    id="encryptionKey"
                    v-model="localKey"
                    type="password"
                    autocomplete="one-time-code"
                    data-1p-ignore
                    data-lpignore="true"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter decryption key..."
                    @keyup.enter="handleSubmit"
                    @keyup.escape="handleCancel"
                    @input="$emit('update:encryptionKey', localKey)"
                />
                
                <p class="text-xs text-gray-500 mt-2">
                    💡 For testing, try "password" if you uploaded with the default key
                </p>
            </div>
            
            <div class="flex justify-end space-x-3">
                <button
                    @click="handleCancel"
                    class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                    Cancel
                </button>
                <button
                    @click="handleSubmit"
                    :disabled="!localKey.trim()"
                    class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                    Download
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import FileTypeIcon from './FileTypeIcon.vue';

const props = defineProps<{
    show: boolean;
    fileName?: string;
    encryptionKey: string;
}>();

const emit = defineEmits<{
    (e: 'submit', key: string): void;
    (e: 'cancel'): void;
    (e: 'update:encryptionKey', key: string): void;
}>();

const localKey = ref(props.encryptionKey);
const keyInput = ref<HTMLInputElement>();

// Watch for external changes to encryptionKey
watch(() => props.encryptionKey, (newKey) => {
    localKey.value = newKey;
});

// Watch for show prop changes to reset the key when modal opens
watch(() => props.show, (show) => {
    if (show) {
        localKey.value = '';
        nextTick(() => {
            keyInput.value?.focus();
            keyInput.value?.select();
        });
    }
});

const handleSubmit = () => {
    if (localKey.value.trim()) {
        emit('submit', localKey.value);
    }
};

const handleCancel = () => {
    localKey.value = '';
    emit('cancel');
};

const handleBackdropClick = () => {
    handleCancel();
};
</script>
<script setup lang="ts">
import { computed } from 'vue';
import { HomeIcon, ChevronRightIcon } from '@heroicons/vue/24/outline';

const props = defineProps<{
    currentPath: string;
}>();

const emit = defineEmits<{
    (e: 'path-change', path: string): void;
}>();

const pathSegments = computed(() => {
    const segments = props.currentPath.split('/').filter(Boolean);
    return ['', ...segments];
});

const getPathUpTo = (index: number): string => {
    return '/' + pathSegments.value.slice(1, index + 1).join('/');
};
</script>

<template>
    <div class="bg-white border-b border-gray-200 px-6 py-3">
        <nav class="flex items-center space-x-2 text-sm">
            <button
                @click="emit('path-change', '/')"
                class="flex items-center text-gray-600 hover:text-gray-900"
            >
                <HomeIcon class="w-4 h-4" />
            </button>

            <template v-for="(segment, index) in pathSegments" :key="index">
                <ChevronRightIcon
                    v-if="index > 0"
                    class="w-4 h-4 text-gray-400"
                />
                <button
                    v-if="segment"
                    @click="emit('path-change', getPathUpTo(index))"
                    class="text-gray-600 hover:text-gray-900"
                >
                    {{ segment }}
                </button>
            </template>
        </nav>
    </div>
</template>

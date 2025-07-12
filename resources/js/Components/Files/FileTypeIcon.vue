<template>
    <component 
        :is="fileTypeIcon.icon" 
        :class="[
            fileTypeIcon.color,
            size,
            className
        ]"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { getFileTypeIcon } from '@/util/FileTypeIcons';

interface Props {
    fileName: string;
    mimeType?: string;
    size?: string;
    className?: string;
}

const props = withDefaults(defineProps<Props>(), {
    size: 'w-5 h-5',
    className: ''
});

const fileTypeIcon = computed(() => getFileTypeIcon(props.fileName, props.mimeType));
</script>

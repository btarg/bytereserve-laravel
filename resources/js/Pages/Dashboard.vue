<!-- Dashboard.vue -->
<script setup>
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout.vue';
import { Head } from '@inertiajs/vue3';
import FileExplorer from "@/Components/Files/FileExplorer.vue";
</script>

<template>
    <Head title="Dashboard" />

    <AuthenticatedLayout>
        <FileExplorer />
    </AuthenticatedLayout>
</template>

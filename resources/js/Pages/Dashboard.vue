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
        <div class="py-12">
            <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">


                <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg mt-6">
                    <div class="p-6 text-gray-900">
                        User ID: {{ $page.props.auth.user }}
                    </div>
                </div>
            </div>
        </div>
    </AuthenticatedLayout>
</template>

<script setup>
import { Link } from '@inertiajs/vue3';

const props = defineProps({
    token: {
        type: String,
        required: true,
    },
    email: String,
    originalProvider: String,
    newProviderName: String,
});
</script>

<template>
    <div class="min-h-screen flex flex-col items-center justify-center">
        <div class="bg-white p-8 rounded-lg shadow-md">
            <p class="mb-4">
                The email {{ email }} is already associated with a {{ originalProvider }} account.
                Please login with {{ originalProvider }} first.
            </p>
            <div class="flex gap-4">
                <a :href="route('provider.conflict.solve', {token: token})" 
                   class="bg-blue-500 text-white px-4 py-2 rounded">
                   Login with {{ originalProvider }}
                </a>
                <Link :href="route('provider.conflict.cancel')" class="text-gray-600">
                Cancel
                </Link>
            </div>
        </div>
    </div>
</template>
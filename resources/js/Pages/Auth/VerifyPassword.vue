<script setup>
import { Link, useForm } from '@inertiajs/vue3';
import InputError from '@/Components/InputError.vue';
import TextInput from '@/Components/TextInput.vue';
import InputLabel from '@/Components/InputLabel.vue';

const props = defineProps({
    token: {
        type: String,
        required: true,
    },
    email: String,
    originalProvider: String,
    newProviderName: String,
});

const form = useForm({
    password: '',
    token: props.token
});

const submit = () => {
    form.post(route('provider.conflict.verify'));
};
</script>

<template>
    <div class="min-h-screen flex flex-col items-center justify-center">
        <div class="bg-white p-8 rounded-lg shadow-md">
            <p class="mb-4">
                The email {{ email }} is already associated with a password-protected account.
                Please verify your password to link with {{ newProviderName }}.
            </p>

            <form v-if="originalProvider === 'email'" @submit.prevent="submit">
                <div>
                    <InputLabel for="password" value="Password" />
                    <TextInput id="password" type="password" class="mt-1 block w-full" v-model="form.password"
                        required />
                    <InputError class="mt-2" :message="form.errors.password" />
                </div>

                <div class="flex gap-4 mt-4">
                    <button type="submit" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                        Verify & Link Account
                    </button>
                    <Link :href="route('provider.conflict.cancel')" class="text-gray-600">
                    Cancel
                    </Link>
                </div>
            </form>

            <div v-else class="flex gap-4">
                <Link :href="route('provider.conflict.solve', { token: token })"
                    class="bg-blue-500 text-white px-4 py-2 rounded">
                Login with {{ originalProvider }}
                </Link>
                <Link :href="route('provider.conflict.cancel')" class="text-gray-600">
                Cancel
                </Link>
            </div>
        </div>
    </div>
</template>
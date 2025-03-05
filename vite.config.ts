import { defineConfig, build } from 'vite';
import laravel from 'laravel-vite-plugin';
import vue from '@vitejs/plugin-vue';
import { sync } from 'glob';
import path from 'path';

// Find all worker files
function getWorkerFiles() {
    return sync("resources/js/**/*.worker.ts").reduce((entries, file) => {
        entries[path.basename(file, '.worker.ts')] = file;
        return entries;
    }, {});
}

// Simplified plugin for handling worker files in dev mode
function workerDevPlugin() {
    return {
        name: 'vite-plugin-worker-dev',
        apply: 'serve',
        async handleHotUpdate({ file, server }) {
            if (file.endsWith('.worker.ts')) {
                const workerName = path.basename(file, '.worker.ts');
                console.log(`🔄 Building worker: ${workerName}`);

                try {
                    await build({
                        configFile: false,
                        root: server.config.root,
                        base: server.config.base,
                        plugins: [vue()],
                        build: {
                            write: true,
                            manifest: false,
                            outDir: 'public/build',
                            rollupOptions: {
                                input: { [workerName]: file },
                                output: {
                                    entryFileNames: 'js/workers/[name].js',
                                },
                            },
                        },
                    });
                    console.log(`✅ Worker built: ${workerName}`);
                    server.ws.send({ type: 'full-reload' });
                } catch (error) {
                    console.error(`❌ Worker build failed:`, error);
                }
            }
        },
    };
}

const codespacesDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
const codespaceName = process.env.CODESPACE_NAME;

export default defineConfig({
    server: {
        // Allow connections from any IP
        host: codespaceName ? '0.0.0.0' : 'localhost',
        // Correctly handle HMR in Codespaces
        hmr: codespacesDomain ? {
            host: `${codespaceName}-5173.${codespacesDomain}`,
            protocol: 'wss',
            clientPort: 443
        } : true,
    },
    plugins: [
        laravel({
            input: ['resources/js/app.ts'],
            refresh: true,
        }),
        vue({
            template: {
                transformAssetUrls: {
                    base: null,
                    includeAbsolute: false,
                },
            },
        }),
        // @ts-expect-error
        workerDevPlugin(),
    ],
    build: {
        manifest: true,
        outDir: 'public/build',
        rollupOptions: {
            input: {
                app: 'resources/js/app.ts',
                ...getWorkerFiles(),
            },
            output: {
                entryFileNames: (chunkInfo) =>
                    chunkInfo.facadeModuleId?.toString().endsWith('.worker.ts')
                        ? 'js/workers/[name].js'
                        : 'js/[name].js',
                chunkFileNames: 'js/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
    },
    resolve: {
        alias: {
            '@': '/resources/js',
            'ziggy-js': '/vendor/tightenco/ziggy/dist',
        },
    },
});

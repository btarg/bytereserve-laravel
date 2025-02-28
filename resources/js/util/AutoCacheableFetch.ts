import { CacheableFetch } from './CacheableFetch';

class AutoCacheableFetch extends CacheableFetch {
    private getCsrfToken(): string | null {
        // Try to get the token from the meta tag (Laravel's default location)
        const metaToken = document.querySelector('meta[name="csrf-token"]');
        if (metaToken) {
            return metaToken.getAttribute('content');
        }

        // Try to get from the X-CSRF-TOKEN header if available
        const csrfInput = document.querySelector('input[name="_token"]');
        if (csrfInput instanceof HTMLInputElement) {
            return csrfInput.value;
        }

        // Check for XSRF-TOKEN cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'XSRF-TOKEN') {
                // Important: Laravel expects the decoding of this cookie value
                return decodeURIComponent(value);
            }
        }

        return null;
    }

    /**
     * Derives a cache name from a URL
     * @param url The URL to derive a cache name from
     * @returns A cache name based on the URL
     */
    private deriveCacheNameFromUrl(url: string): string {
        try {
            // Parse the URL
            const parsedUrl = new URL(url, window.location.origin);

            // Get the pathname without leading/trailing slashes
            const path = parsedUrl.pathname.replace(/^\/|\/$/g, '');

            // Replace remaining slashes with dashes
            const cacheName = path.replace(/\//g, '-') || 'root';

            // Limit the length to avoid excessively long cache names
            return cacheName.length > 50 ? cacheName.substring(0, 50) : cacheName;
        } catch (e) {
            // If URL parsing fails, use a fallback approach
            // Remove protocol and domain if present
            const simplifiedUrl = url.replace(/^(https?:\/\/)?([^\/]+)/, '');

            // Clean up the URL to make it suitable as a cache name
            const cacheName = simplifiedUrl
                .replace(/^\/|\/$/g, '') // Remove leading/trailing slashes
                .replace(/\//g, '-')     // Replace remaining slashes with dashes
                .replace(/[?&=]/g, '-')  // Replace query string characters
                .replace(/-+/g, '-')     // Replace multiple dashes with a single dash
                || 'root';

            return cacheName.length > 50 ? cacheName.substring(0, 50) : cacheName;
        }
    }

    /**
     * Override fetch to automatically use URL-based cache names
     */
    async fetch(
        input: RequestInfo | URL,
        init?: RequestInit,
        cacheOptions: Parameters<CacheableFetch["fetch"]>[2] = {}
    ): Promise<Response> {
        const newInit: RequestInit = { ...init };

        // Initialize headers if not already set
        if (!newInit.headers) {
            newInit.headers = {};
        }

        const headers = newInit.headers as Record<string, string>;

        // Add X-Requested-With header for all requests
        headers['X-Requested-With'] = 'XMLHttpRequest';

        // Get the request method (defaulting to GET if not specified)
        const method = newInit.method || 'GET';

        // For non-GET requests, add the CSRF token
        if (method !== 'GET') {
            const token = this.getCsrfToken();
            if (token) {
                // This is what Laravel expects - the token in X-XSRF-TOKEN header
                headers['X-XSRF-TOKEN'] = token;
            } else {
                console.warn('CSRF token not found. Request may fail due to CSRF protection.');
            }
        }

        // If cache name not explicitly set, derive it from the URL
        if (!cacheOptions.cacheName) {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            cacheOptions.cacheName = this.deriveCacheNameFromUrl(url);
        }

        return super.fetch(input, newInit, cacheOptions);
    }

    /**
     * Override post method to ensure CSRF tokens are included
     */
    async post(
        url: string,
        body?: any,
        init?: RequestInit
    ): Promise<Response> {
        const postInit: RequestInit = {
            ...init,
            method: 'POST'
        };

        // Handle different body types
        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === 'string') {
                postInit.body = body;
            } else {
                postInit.body = JSON.stringify(body);

                // Set content type if not already set
                if (!postInit.headers) postInit.headers = {};
                if (!(postInit.headers as Record<string, string>)['Content-Type']) {
                    (postInit.headers as Record<string, string>)['Content-Type'] = 'application/json';
                }
            }
        }

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, postInit);
    }

    /**
     * Override put method to ensure CSRF tokens are included
     */
    async put(
        url: string,
        body?: any,
        init?: RequestInit
    ): Promise<Response> {
        const putInit: RequestInit = {
            ...init,
            method: 'PUT'
        };

        // Handle different body types
        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === 'string') {
                putInit.body = body;
            } else {
                putInit.body = JSON.stringify(body);

                // Set content type if not already set
                if (!putInit.headers) putInit.headers = {};
                if (!(putInit.headers as Record<string, string>)['Content-Type']) {
                    (putInit.headers as Record<string, string>)['Content-Type'] = 'application/json';
                }
            }
        }

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, putInit);
    }

    /**
     * Override delete method to ensure CSRF tokens are included
     */
    async delete(
        url: string,
        init?: RequestInit
    ): Promise<Response> {
        const deleteInit: RequestInit = {
            ...init,
            method: 'DELETE'
        };

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, deleteInit);
    }

    /**
     * Override patch method to ensure CSRF tokens are included
     */
    async patch(
        url: string,
        body?: any,
        init?: RequestInit
    ): Promise<Response> {
        const patchInit: RequestInit = {
            ...init,
            method: 'PATCH'
        };

        // Handle different body types
        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === 'string') {
                patchInit.body = body;
            } else {
                patchInit.body = JSON.stringify(body);

                // Set content type if not already set
                if (!patchInit.headers) patchInit.headers = {};
                if (!(patchInit.headers as Record<string, string>)['Content-Type']) {
                    (patchInit.headers as Record<string, string>)['Content-Type'] = 'application/json';
                }
            }
        }

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, patchInit);
    }

}

// Create and export an instance
const cacheFetchInstance = new AutoCacheableFetch();
export default cacheFetchInstance;
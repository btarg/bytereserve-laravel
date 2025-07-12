/**
 * AutoCacheableFetch - A wrapper around the Fetch API that integrates with the Cache API
 * and provides automatic CSRF token handling for Laravel applications
 */
export class AutoCacheableFetch {
    private cacheNames: Record<string, string>;
    private defaultCacheName: string;

    /**
     * Creates a new AutoCacheableFetch instance
     * @param cacheVersion Version number for cache management
     * @param cacheNames Object mapping cache types to cache names
     * @param defaultCacheName The default cache to use if not specified
     */
    constructor(
        cacheVersion: number = 1,
        cacheNames: Record<string, string> = {},
        defaultCacheName: string = "default"
    ) {

        // Set up default cache names with versioning
        this.cacheNames = {
            default: `default-cache-v${cacheVersion}`,
            ...Object.fromEntries(
                Object.entries(cacheNames).map(([key, value]) => [
                    key,
                    `${value}-v${cacheVersion}`,
                ])
            ),
        };

        this.defaultCacheName = defaultCacheName;

        // Initialize cache cleanup
        this.cleanupCaches();
    }

    /**
     * Cleans up old caches that don't match current version
     */
    private async cleanupCaches(): Promise<void> {
        const expectedCacheNamesSet = new Set(Object.values(this.cacheNames));

        try {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map((cacheName) => {
                    if (!expectedCacheNamesSet.has(cacheName)) {
                        console.log("Deleting out of date cache:", cacheName);
                        return caches.delete(cacheName);
                    }
                    return Promise.resolve();
                })
            );
        } catch (error) {
            console.error("Error cleaning up caches:", error);
        }
    }

    /**
     * Gets the CSRF token from various possible locations in a Laravel application
     */
    private getCsrfToken(): string | null {
        // Try to get the token from the meta tag (Laravel's default location)
        const metaToken = document.querySelector('meta[name="csrf-token"]');
        if (metaToken) {
            return metaToken.getAttribute("content");
        }

        // Try to get from the X-CSRF-TOKEN header if available
        const csrfInput = document.querySelector('input[name="_token"]');
        if (csrfInput instanceof HTMLInputElement) {
            return csrfInput.value;
        }

        // Check for XSRF-TOKEN cookie
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split("=");
            if (name === "XSRF-TOKEN") {
                // Important: Laravel expects the decoding of this cookie value
                return decodeURIComponent(value);
            }
        }

        return null;
    }

    /**
     * Derives a cache name from a URL
     * @param url The URL string
     * @returns A simplified cache name based on the URL
     */
    private deriveCacheNameFromUrl(url: string): string {
        try {
            // Parse URL and get pathname
            const pathname = new URL(url, window.location.origin).pathname;

            // Use URL encoding for safe cache name
            let cacheName = encodeURIComponent(pathname.replace(/^\/|\/$/g, "") || "root");

            // Limit length
            return cacheName.length > 50 ? cacheName.substring(0, 50) : cacheName;
        } catch (e) {
            // Fallback if URL parsing fails
            const strippedUrl = url.replace(/^(https?:\/\/)?([^\/]+)/, "");
            let cacheName = encodeURIComponent(strippedUrl.replace(/^\/|\/$/g, "") || "root");

            return cacheName.length > 50 ? cacheName.substring(0, 50) : cacheName;
        }
    }

    /**
     * Checks if a cached response has expired
     * @param response The cached response
     * @param maxAge Maximum age in milliseconds
     * @returns boolean indicating if response is expired
     */
    private isResponseExpired(response: Response, maxAge: number): boolean {
        const dateHeader = response.headers.get("date");
        if (!dateHeader) return false;

        const cachedDate = new Date(dateHeader).getTime();
        return Date.now() - cachedDate > maxAge;
    }

    /**
     * Fetches a resource from the network and updates the cache
     * @param cache The Cache object to use
     * @param request The request to fetch
     * @param shouldCache Function to determine if response should be cached
     * @returns Promise resolving to Response
     */
    private async fetchFromNetwork(
        cache: Cache,
        request: Request,
        shouldCache: (response: Response) => boolean
    ): Promise<Response> {
        const response = await fetch(request.clone());

        if (shouldCache(response)) {
            // Add custom header to track when the response was cached
            const responseToCache = response.clone();
            const headers = new Headers(responseToCache.headers);
            if (!headers.has("date")) {
                headers.set("date", new Date().toUTCString());
            }

            const modifiedResponse = new Response(await responseToCache.blob(), {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: headers,
            });

            // Put in cache
            cache.put(request, modifiedResponse);
        }

        return response;
    }

    /**
     * Fetch implementation with caching support and CSRF token handling
     * @param input Request URL or Request object
     * @param init Fetch options
     * @param cacheOptions Caching configuration
     * @returns Promise resolving to Response
     */
    async fetch(
        input: RequestInfo | URL | string,
        init?: RequestInit,
        cacheOptions: {
            cacheName?: string;
            shouldCache?: (response: Response) => boolean;
            cacheStrategy?: "cache-first" | "network-first" | "network-only" | "cache-only";
            maxAge?: number; // Cache expiration in milliseconds
        } = {}
    ): Promise<Response> {
        const newInit: RequestInit = { ...init };

        // Initialize headers if not already set
        if (!newInit.headers) {
            newInit.headers = {};
        }

        const headers = newInit.headers as Record<string, string>;

        // Add X-Requested-With header for all requests
        headers["X-Requested-With"] = "XMLHttpRequest";

        // Get the request method (defaulting to GET if not specified)
        const method = newInit.method || "GET";

        // For non-GET requests, add the CSRF token
        if (method !== "GET") {
            const token = this.getCsrfToken();
            if (token) {
                // This is what Laravel expects - the token in X-XSRF-TOKEN header
                headers["X-XSRF-TOKEN"] = token;
            } else {
                console.warn("CSRF token not found. Request may fail due to CSRF protection.");
            }
        }

        // If cache name not explicitly set, derive it from the URL
        if (!cacheOptions.cacheName) {
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                        ? input.toString()
                        : input instanceof Request
                            ? input.url
                            : "";
            cacheOptions.cacheName = this.deriveCacheNameFromUrl(url);
        }

        const {
            cacheName = this.defaultCacheName,
            shouldCache = (response) => response.status >= 200 && response.status < 400,
            cacheStrategy = "cache-first",
            maxAge,
        } = cacheOptions;

        const actualCacheName = this.cacheNames[cacheName] || this.cacheNames.default;
        const request = new Request(input, newInit);

        // For non-GET requests, bypass cache
        if (request.method !== "GET" && cacheStrategy !== "cache-only") {
            return fetch(request);
        }

        const cache = await caches.open(actualCacheName);

        switch (cacheStrategy) {

            case "cache-only":
                const cachedResponse = await cache.match(request);
                if (cachedResponse) {
                    if (maxAge && this.isResponseExpired(cachedResponse, maxAge)) {
                        throw new Error("Cached response expired and network fetch not allowed");
                    }
                    return cachedResponse;
                }
                throw new Error("No cached response available and network fetch not allowed");

            case "network-first":
                try {
                    return await this.fetchFromNetwork(cache, request, shouldCache);
                } catch (error) {
                    console.log("Network request failed, falling back to cache", error);
                    const cachedResponse = await cache.match(request);
                    if (cachedResponse) {
                        if (maxAge && this.isResponseExpired(cachedResponse, maxAge)) {
                            throw new Error("Network request failed and cached response expired");
                        }
                        return cachedResponse;
                    }
                    throw error;
                }

            case "cache-first":
                const cachedFirstResponse = await cache.match(request);
                if (cachedFirstResponse) {
                    console.log("Returning cached response for", request.url);
                    if (maxAge && this.isResponseExpired(cachedFirstResponse, maxAge)) {
                        return this.fetchFromNetwork(cache, request, shouldCache);
                    }
                    return cachedFirstResponse;
                }
                return this.fetchFromNetwork(cache, request, shouldCache);
           
                case "network-only":
            default:
                // Clear existing cache name from the cache
                await cache.delete(request);
                return this.fetchFromNetwork(cache, request, shouldCache);

        }
    }

    /**
     * Wrapper for HTTP GET requests
     */
    async get(
        url: string,
        init?: RequestInit,
        cacheOptions?: Parameters<AutoCacheableFetch["fetch"]>[2]
    ): Promise<Response> {
        return this.fetch(url, { ...init, method: "GET" }, cacheOptions);
    }

    /**
     * Wrapper for HTTP POST requests with CSRF token handling
     */
    async post(url: string, body?: any, init?: RequestInit): Promise<Response> {
        const postInit: RequestInit = {
            ...init,
            method: "POST",
        };

        // Handle different body types
        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
                postInit.body = body;
            } else {
                postInit.body = JSON.stringify(body);

                // Set content type if not already set
                if (!postInit.headers) postInit.headers = {};
                if (!(postInit.headers as Record<string, string>)["Content-Type"]) {
                    (postInit.headers as Record<string, string>)["Content-Type"] =
                        "application/json";
                }
            }
        }

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, postInit);
    }

    /**
     * Wrapper for HTTP PUT requests with CSRF token handling
     */
    async put(url: string, body?: any, init?: RequestInit): Promise<Response> {
        const putInit: RequestInit = {
            ...init,
            method: "PUT",
        };

        // Handle different body types
        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
                putInit.body = body;
            } else {
                putInit.body = JSON.stringify(body);

                // Set content type if not already set
                if (!putInit.headers) putInit.headers = {};
                if (!(putInit.headers as Record<string, string>)["Content-Type"]) {
                    (putInit.headers as Record<string, string>)["Content-Type"] = "application/json";
                }
            }
        }

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, putInit);
    }

    /**
     * Wrapper for HTTP DELETE requests with CSRF token handling
     */
    async delete(url: string, init?: RequestInit): Promise<Response> {
        const deleteInit: RequestInit = {
            ...init,
            method: "DELETE",
        };

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, deleteInit);
    }

    /**
     * Wrapper for HTTP PATCH requests with CSRF token handling
     */
    async patch(url: string, body?: any, init?: RequestInit): Promise<Response> {
        const patchInit: RequestInit = {
            ...init,
            method: "PATCH",
        };

        // Handle different body types
        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
                patchInit.body = body;
            } else {
                patchInit.body = JSON.stringify(body);

                // Set content type if not already set
                if (!patchInit.headers) patchInit.headers = {};
                if (!(patchInit.headers as Record<string, string>)["Content-Type"]) {
                    (patchInit.headers as Record<string, string>)["Content-Type"] =
                        "application/json";
                }
            }
        }

        // Use our enhanced fetch that adds CSRF protection
        return this.fetch(url, patchInit);
    }

    /**
     * Clears all caches managed by this instance
     */
    async clearCaches(): Promise<void> {
        try {
            await Promise.all(
                Object.values(this.cacheNames).map((cacheName) => caches.delete(cacheName))
            );
            console.log("All caches cleared");
        } catch (error) {
            console.error("Error clearing caches:", error);
            throw error;
        }
    }

    /**
     * Clears a specific cache
     * @param cacheName Name of the cache to clear
     */
    async clearCache(cacheName: string = this.defaultCacheName): Promise<void> {
        const actualCacheName = this.cacheNames[cacheName] || this.cacheNames.default;
        try {
            await caches.delete(actualCacheName);
            console.log(`Cache ${actualCacheName} cleared`);
        } catch (error) {
            console.error(`Error clearing cache ${actualCacheName}:`, error);
            throw error;
        }
    }
}

// Create and export an instance
const cacheFetchInstance = new AutoCacheableFetch();
export default cacheFetchInstance;

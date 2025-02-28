import { route } from "../../../vendor/tightenco/ziggy/src/js";

/**
 * CacheableFetch - A wrapper around the Fetch API that integrates with the Cache API
 */
export class CacheableFetch {
    private cacheNames: Record<string, string>;
    private cacheVersion: number;
    private defaultCacheName: string;

    /**
     * Creates a new CacheableFetch instance
     * @param cacheVersion Version number for cache management
     * @param cacheNames Object mapping cache types to cache names
     * @param defaultCacheName The default cache to use if not specified
     */
    constructor(
        cacheVersion: number = 1,
        cacheNames: Record<string, string> = {},
        defaultCacheName: string = "default"
    ) {
        this.cacheVersion = cacheVersion;

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
     * Fetch implementation with caching support
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
        const {
            cacheName = this.defaultCacheName,
            shouldCache = (response) => response.status >= 200 && response.status < 400,
            cacheStrategy = "cache-first",
            maxAge,
        } = cacheOptions;

        const actualCacheName = this.cacheNames[cacheName] || this.cacheNames.default;
        
        const request = new Request(input, init);

        // For non-GET requests, bypass cache
        if (request.method !== "GET" && cacheStrategy !== "cache-only") {
            return fetch(request);
        }

        const cache = await caches.open(actualCacheName);

        switch (cacheStrategy) {
            case "network-only":
                // Clear existing cache name from the cache
                await cache.delete(request);

                return this.fetchFromNetwork(cache, request, shouldCache);

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
            default:
                const cachedFirstResponse = await cache.match(request);
                if (cachedFirstResponse) {
                    if (maxAge && this.isResponseExpired(cachedFirstResponse, maxAge)) {
                        return this.fetchFromNetwork(cache, request, shouldCache);
                    }
                    return cachedFirstResponse;
                }
                return this.fetchFromNetwork(cache, request, shouldCache);
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
     * Wrapper for HTTP GET requests
     */
    async get(
        url: string,
        init?: RequestInit,
        cacheOptions?: Parameters<CacheableFetch["fetch"]>[2]
    ): Promise<Response> {
        return this.fetch(url, { ...init, method: "GET" }, cacheOptions);
    }

    /**
     * Wrapper for HTTP POST requests
     */
    async post(
        url: string,
        body?: any,
        init?: RequestInit
    ): Promise<Response> {
        return fetch(
            url,
            {
                ...init,
                method: "POST",
                body: body instanceof FormData || body instanceof Blob || typeof body === "string"
                    ? body
                    : JSON.stringify(body),
                headers: {
                    ...init?.headers,
                    "Content-Type":
                        body instanceof FormData
                            ? undefined // Let browser set the correct boundary
                            : body instanceof Blob
                                ? body.type || "application/octet-stream"
                                : "application/json",
                },
            },
        );
    }

    /**
     * Wrapper for HTTP PUT requests
     */
    async put(
        url: string,
        body?: any,
        init?: RequestInit,
    ): Promise<Response> {
        return fetch(
            url,
            {
                ...init,
                method: "PUT",
                body: body instanceof FormData || body instanceof Blob || typeof body === "string"
                    ? body
                    : JSON.stringify(body),
                headers: {
                    ...init?.headers,
                    "Content-Type":
                        body instanceof FormData
                            ? undefined
                            : body instanceof Blob
                                ? body.type || "application/octet-stream"
                                : "application/json",
                },
            },
        );
    }

    /**
     * Wrapper for HTTP DELETE requests
     */
    async delete(
        url: string,
        init?: RequestInit,
    ): Promise<Response> {
        return fetch(url, { ...init, method: "DELETE" });
    }

    /**
     * Wrapper for HTTP PATCH requests
     */
    async patch(
        url: string,
        body?: any,
        init?: RequestInit,
    ): Promise<Response> {
        return fetch(
            url,
            {
                ...init,
                method: "PATCH",
                body: body instanceof FormData || body instanceof Blob || typeof body === "string"
                    ? body
                    : JSON.stringify(body),
                headers: {
                    ...init?.headers,
                    "Content-Type":
                        body instanceof FormData
                            ? undefined
                            : body instanceof Blob
                                ? body.type || "application/octet-stream"
                                : "application/json",
                },
            },
        );
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

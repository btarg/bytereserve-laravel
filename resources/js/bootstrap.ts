import cacheFetchInstance, { AutoCacheableFetch } from "./util/AutoCacheableFetch";

declare global {
    interface Window {
        cacheFetch: AutoCacheableFetch;
    }
}

window.cacheFetch = cacheFetchInstance;
import cacheFetchInstance from "./util/AutoCacheableFetch";
import { CacheableFetch } from "./util/CacheableFetch";

declare global {
    interface Window {
        cacheFetch: CacheableFetch;
    }
}

window.cacheFetch = cacheFetchInstance;
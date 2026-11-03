// The artifact builder replaces this ID with a hash of the public assets.
const BUILD_ID = "source-v3";
const ASSET_HASHES = null;
const CACHE_PREFIX = "vocab-app:" + self.registration.scope + ":";
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const APP_SHELL = [
    "./", "./index.html", "./style.css", "./script.js", "./history-config.js",
    "./history-classification.js", "./history-regions.json",
    "./history_questions.js", "./pwa.js", "./manifest.json",
    "./icons/icon-192.png", "./icons/icon-512.png"
];
const ASSET_URLS = new Set(APP_SHELL.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        if (!ASSET_HASHES) throw new Error("Use the verified web artifact, not the source directory");
        const verified = await Promise.all(APP_SHELL.map(async asset => {
            const request = new Request(new URL(asset, self.registration.scope), { cache: "reload" });
            const response = await fetch(request);
            if (!response.ok) throw new Error("Release asset unavailable");
            const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
            const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
            if (hash !== ASSET_HASHES[asset]) throw new Error("Release asset version mismatch");
            return [request, response];
        }));
        const cache = await caches.open(CACHE_NAME);
        try {
            await Promise.all(verified.map(([request, response]) => cache.put(request, response)));
        } catch (error) {
            await caches.delete(CACHE_NAME);
            throw error;
        }
    })());
    // Keep the old worker active until its tabs close; avoid mixed-version screens.
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map(key => caches.delete(key))
    )));
    // Legacy/global caches are left alone, and are never read by this worker.
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    url.search = "";
    url.hash = "";
    if (event.request.method !== "GET" || !ASSET_URLS.has(url.href)) return;
    event.respondWith(caches.open(CACHE_NAME).then(async cache =>
        (await cache.match(url.href)) || new Response(
            "アプリの保存データが不足しています。学習を止め、すべてのアプリタブを閉じて開き直してください。改善しない場合は管理者に連絡してください。",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }
        )
    ));
});

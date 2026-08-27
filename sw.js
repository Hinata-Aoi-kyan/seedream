/* Seedream Web Service Worker: 允许安装为桌面应用 */
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", () => { /* 透传, 不做离线缓存, 避免缓存导致更新不生效 */ });

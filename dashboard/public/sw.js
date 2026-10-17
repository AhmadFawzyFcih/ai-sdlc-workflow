// Brings the right dashboard tab to the front — only a service worker can focus another tab reliably
// from a notification click (a page can only reach tabs it is related to — see focusOrOpen in app.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Tell the tab that has project `key` open to open session `sid`, and focus it; with no such tab, open `url`.
async function goTo({ key, sid, url }) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const tab = tabs.find((c) => { try { return new URL(c.url).searchParams.get('p') === key; } catch { return false; } });
  if (tab) {
    if (sid) tab.postMessage({ open: sid });
    await tab.focus().catch(() => {});
    return;
  }
  if (url) await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(goTo(e.notification.data || {}));
});

/**
 * QuantEdge Service Worker
 *
 * Handles incoming push events and displays native OS notifications.
 * Click handler deep-links into the relevant page.
 */

const APP_NAME = "QuantEdge";
const APP_URL  = self.location.origin;

// Receive push notification
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: APP_NAME, body: event.data.text() };
  }

  const options = {
    body:    data.body || "",
    icon:    "/icon-192.png",
    badge:   "/badge-72.png",
    tag:     data.tag || "quantedge-notification",
    data:    data.data || {},
    vibrate: [200, 100, 200],
    actions: [
      { action: "view", title: "View" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || APP_NAME, options)
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url
    ? APP_URL + event.notification.data.url
    : APP_URL + "/dashboard";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.startsWith(APP_URL) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Service worker install + activate
self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

/**
 * Web Push subscription helper
 *
 * Registers the service worker, fetches the VAPID public key,
 * subscribes the browser, and sends the subscription to the API.
 */

import client from "../api/client";

export async function registerPush(workspaceId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("[push] Push not supported in this browser");
    return false;
  }

  try {
    // Register service worker
    const reg = await navigator.serviceWorker.register("/service-worker.js");
    await navigator.serviceWorker.ready;

    // Get VAPID public key from API
    const keyRes = await client.get("/push/vapid-public-key");
    const { publicKey } = keyRes.data.data;

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("[push] Permission denied");
      return false;
    }

    // Subscribe
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const { endpoint, keys } = subscription.toJSON();

    // Send to API
    await client.post("/push/subscribe", {
      endpoint,
      p256dh:    keys.p256dh,
      auth:      keys.auth,
      userAgent: navigator.userAgent,
    }, {
      headers: { "x-workspace-id": workspaceId },
    });

    console.log("[push] Subscribed successfully");
    return true;

  } catch (err) {
    console.error("[push] Registration failed:", err.message);
    return false;
  }
}

export async function unregisterPush(workspaceId) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/service-worker.js");
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await client.delete("/push/subscribe", {
      data:    { endpoint: sub.endpoint },
      headers: { "x-workspace-id": workspaceId },
    });
    await sub.unsubscribe();
    console.log("[push] Unsubscribed");
  } catch (err) {
    console.error("[push] Unsubscribe failed:", err.message);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding  = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64   = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw      = window.atob(base64);
  const output   = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

#!/usr/bin/env node
/**
 * VAPID Key Generator
 *
 * Run once during setup:
 *   node scripts/generate-vapid.js
 *
 * Copy the output into your .env file.
 * Never regenerate in production — changing keys invalidates all push subscriptions.
 */

const webpush = require("web-push");
const keys    = webpush.generateVAPIDKeys();

console.log("\n=== VAPID Keys Generated ===\n");
console.log("Add these to your .env file:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@quantedge.io`);
console.log("\nNever regenerate these in production.");
console.log("Changing keys will invalidate all existing push subscriptions.\n");

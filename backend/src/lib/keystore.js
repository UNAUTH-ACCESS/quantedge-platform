/**
 * keystore.js
 * Minimal encrypted-at-rest keystore for private keys.
 * AES-256-GCM with scrypt key derivation. No external dependencies.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ALGO = "aes-256-gcm";
const SCRYPT_KEYLEN = 32;

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, SCRYPT_KEYLEN);
}

function encryptValue(plaintext, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

function decryptValue(entry, passphrase) {
  const salt = Buffer.from(entry.salt, "hex");
  const iv = Buffer.from(entry.iv, "hex");
  const authTag = Buffer.from(entry.authTag, "hex");
  const ciphertext = Buffer.from(entry.ciphertext, "hex");
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

function loadKeystore(keystorePath) {
  return JSON.parse(fs.readFileSync(keystorePath, "utf8"));
}

function saveKeystore(keystorePath, data) {
  fs.writeFileSync(keystorePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getPassphrase() {
  if (process.env.KEYSTORE_PASSPHRASE) return process.env.KEYSTORE_PASSPHRASE;
  const passphrasePath = process.env.KEYSTORE_PASSPHRASE_FILE ||
    path.join(os.homedir(), ".quantedge-keystore-passphrase");
  if (fs.existsSync(passphrasePath)) {
    return fs.readFileSync(passphrasePath, "utf8").trim();
  }
  throw new Error("No KEYSTORE_PASSPHRASE env var or passphrase file found at " + passphrasePath);
}

function getKey(keystorePath, keyName) {
  const store = loadKeystore(keystorePath);
  const entry = store[keyName];
  if (!entry) throw new Error(`Keystore has no entry for "${keyName}"`);
  return decryptValue(entry, getPassphrase());
}

module.exports = { encryptValue, decryptValue, loadKeystore, saveKeystore, getKey, getPassphrase };

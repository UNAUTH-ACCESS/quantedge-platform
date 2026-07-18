/**
 * kycCrypto.js
 * Encrypt-at-rest for KYC submission fields and uploaded documents.
 *
 * Reuses the exact same primitives as quantedge-delegate/server/lib/keystore.js
 * (encryptValue/decryptValue — AES-256-GCM, scrypt key derivation).
 * DO NOT reimplement crypto here. If keystore.js changes, update the import path
 * below to match.
 *
 * SETUP REQUIRED:
 * 1. Copy quantedge-delegate/server/lib/keystore.js into this app at the path
 *    imported below (verbatim, no changes).
 * 2. Set KYC_KEYSTORE_PASSPHRASE in ~/quantedge/.env (a NEW passphrase, distinct
 *    from KEYSTORE_PASSPHRASE used for deploy/delegate keys — do not reuse it).
 * 3. Ensure the docs directory below exists and is NOT web-served:
 *      mkdir -p ~/quantedge/storage/kyc-docs && chmod 700 ~/quantedge/storage/kyc-docs
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { encryptValue, decryptValue } = require("./keystore"); // <-- adjust path if placed elsewhere

const DOCS_DIR = process.env.KYC_DOCS_DIR || path.join(__dirname, "..", "..", "storage", "kyc-docs");

function getKycPassphrase() {
  const p = process.env.KYC_KEYSTORE_PASSPHRASE;
  if (!p) throw new Error("KYC_KEYSTORE_PASSPHRASE env var is not set");
  return p;
}

/**
 * Encrypt an arbitrary string field (e.g. idNumber) for storage directly in a DB column.
 * Returns a JSON string — store it as-is in a Postgres `text` column.
 */
function encryptField(plaintext) {
  return JSON.stringify(encryptValue(plaintext, getKycPassphrase()));
}

function decryptField(storedJson) {
  const entry = JSON.parse(storedJson);
  return decryptValue(entry, getKycPassphrase());
}

/**
 * Encrypt an uploaded file buffer (image/PDF) and write it to disk as an
 * encrypted blob. Returns the relative path to store in the DB
 * (e.g. KycSubmission.idDocFrontPath).
 */
function encryptFileToDisk(buffer, userId, label) {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true, mode: 0o700 });
  }
  const base64Content = buffer.toString("base64");
  const entry = encryptValue(base64Content, getKycPassphrase());
  const filename = `${userId}_${label}_${crypto.randomBytes(6).toString("hex")}.enc.json`;
  const fullPath = path.join(DOCS_DIR, filename);
  fs.writeFileSync(fullPath, JSON.stringify(entry), { mode: 0o600 });
  // Store only the relative filename in the DB, never the absolute path
  return filename;
}

/**
 * Decrypt a file previously written by encryptFileToDisk.
 * Returns a Buffer of the original file content.
 */
function decryptFileFromDisk(storedFilename) {
  const fullPath = path.join(DOCS_DIR, storedFilename);
  const entry = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const base64Content = decryptValue(entry, getKycPassphrase());
  return Buffer.from(base64Content, "base64");
}

module.exports = {
  encryptField,
  decryptField,
  encryptFileToDisk,
  decryptFileFromDisk,
  DOCS_DIR,
};

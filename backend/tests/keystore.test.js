const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  encryptValue,
  decryptValue,
  loadKeystore,
  saveKeystore,
  getKey,
  getPassphrase,
} = require("../src/lib/keystore");

describe("keystore.js — encryptValue / decryptValue", () => {
  const passphrase = "test-passphrase-do-not-use-in-prod";

  test("round-trips a plaintext string correctly", () => {
    const plaintext = "super-secret-private-key-material";
    const entry = encryptValue(plaintext, passphrase);
    const decrypted = decryptValue(entry, passphrase);
    expect(decrypted).toBe(plaintext);
  });

  test("round-trips an empty string", () => {
    const entry = encryptValue("", passphrase);
    expect(decryptValue(entry, passphrase)).toBe("");
  });

  test("round-trips a long base64 payload (simulating an encrypted file)", () => {
    const longPayload = Buffer.alloc(50000, "a").toString("base64");
    const entry = encryptValue(longPayload, passphrase);
    expect(decryptValue(entry, passphrase)).toBe(longPayload);
  });

  test("produces different ciphertext for the same plaintext each call (random salt/IV)", () => {
    const plaintext = "same-value-twice";
    const entryA = encryptValue(plaintext, passphrase);
    const entryB = encryptValue(plaintext, passphrase);
    expect(entryA.ciphertext).not.toBe(entryB.ciphertext);
    expect(entryA.salt).not.toBe(entryB.salt);
    expect(entryA.iv).not.toBe(entryB.iv);
    // but both still decrypt to the same original value
    expect(decryptValue(entryA, passphrase)).toBe(plaintext);
    expect(decryptValue(entryB, passphrase)).toBe(plaintext);
  });

  test("throws when decrypting with the wrong passphrase", () => {
    const entry = encryptValue("secret", passphrase);
    expect(() => decryptValue(entry, "wrong-passphrase")).toThrow();
  });

  test("throws when the ciphertext has been tampered with (GCM auth tag catches it)", () => {
    const entry = encryptValue("secret", passphrase);
    const tampered = { ...entry, ciphertext: entry.ciphertext.slice(0, -2) + "ff" };
    expect(() => decryptValue(tampered, passphrase)).toThrow();
  });

  test("throws when the auth tag has been tampered with", () => {
    const entry = encryptValue("secret", passphrase);
    const tampered = { ...entry, authTag: entry.authTag.slice(0, -2) + "ff" };
    expect(() => decryptValue(tampered, passphrase)).toThrow();
  });
});

describe("keystore.js — loadKeystore / saveKeystore / getKey", () => {
  const passphrase = "test-passphrase-do-not-use-in-prod";
  let tmpDir, keystorePath;
  let originalPassphraseEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keystore-test-"));
    keystorePath = path.join(tmpDir, "keystore.json");
    // getKey() calls getPassphrase() internally, which reads from
    // process.env.KEYSTORE_PASSPHRASE (or the real passphrase file on this
    // machine) - NOT the local "passphrase" const above. Without pinning
    // this explicitly, getKey() would try to decrypt test data using
    // whatever the REAL production keystore passphrase happens to be,
    // which correctly fails the GCM auth tag check rather than silently
    // matching. Pin it so the test actually exercises what it claims to.
    originalPassphraseEnv = process.env.KEYSTORE_PASSPHRASE;
    process.env.KEYSTORE_PASSPHRASE = passphrase;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalPassphraseEnv === undefined) delete process.env.KEYSTORE_PASSPHRASE;
    else process.env.KEYSTORE_PASSPHRASE = originalPassphraseEnv;
  });

  test("saves and loads a keystore file round-trip", () => {
    const data = { solanaDeploy: encryptValue("solana-key-material", passphrase) };
    saveKeystore(keystorePath, data);
    const loaded = loadKeystore(keystorePath);
    expect(loaded.solanaDeploy).toEqual(data.solanaDeploy);
  });

  test("saved keystore file is not world-readable (mode 0600)", () => {
    saveKeystore(keystorePath, { key: encryptValue("x", passphrase) });
    const stats = fs.statSync(keystorePath);
    // 0o600 = owner read/write only
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test("getKey decrypts a named entry from a keystore file", () => {
    const data = { deployerKey: encryptValue("deployer-secret", passphrase) };
    saveKeystore(keystorePath, data);
    const result = getKey(keystorePath, "deployerKey");
    expect(result).toBe("deployer-secret");
  });

  test("getKey throws a clear error when the named entry does not exist", () => {
    saveKeystore(keystorePath, { onlyThisKey: encryptValue("x", passphrase) });
    expect(() => getKey(keystorePath, "missingKey")).toThrow(/no entry for "missingKey"/);
  });
});

describe("keystore.js — getPassphrase", () => {
  const originalEnv = process.env.KEYSTORE_PASSPHRASE;
  const originalFileEnv = process.env.KEYSTORE_PASSPHRASE_FILE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.KEYSTORE_PASSPHRASE;
    else process.env.KEYSTORE_PASSPHRASE = originalEnv;
    if (originalFileEnv === undefined) delete process.env.KEYSTORE_PASSPHRASE_FILE;
    else process.env.KEYSTORE_PASSPHRASE_FILE = originalFileEnv;
  });

  test("reads from KEYSTORE_PASSPHRASE env var when set", () => {
    process.env.KEYSTORE_PASSPHRASE = "env-var-passphrase";
    expect(getPassphrase()).toBe("env-var-passphrase");
  });

  test("throws when neither env var nor passphrase file is present", () => {
    delete process.env.KEYSTORE_PASSPHRASE;
    process.env.KEYSTORE_PASSPHRASE_FILE = "/nonexistent/path/that/should/not/exist";
    expect(() => getPassphrase()).toThrow(/No KEYSTORE_PASSPHRASE/);
  });
});

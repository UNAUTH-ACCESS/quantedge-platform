const fs = require("fs");
const os = require("os");
const path = require("path");

// kycCrypto.js reads KYC_DOCS_DIR at module load time (top-level const), so
// this MUST be set before the require() below, not in beforeAll.
const tmpDocsDir = fs.mkdtempSync(path.join(os.tmpdir(), "kyc-docs-test-"));
process.env.KYC_DOCS_DIR = tmpDocsDir;
process.env.KYC_KEYSTORE_PASSPHRASE = "test-kyc-passphrase-do-not-use-in-prod";

const {
  encryptField,
  decryptField,
  encryptFileToDisk,
  decryptFileFromDisk,
} = require("../src/lib/kycCrypto");

afterAll(() => {
  fs.rmSync(tmpDocsDir, { recursive: true, force: true });
});

describe("kycCrypto.js — encryptField / decryptField", () => {
  test("round-trips a plaintext field value (e.g. an ID number)", () => {
    const stored = encryptField("A1234567");
    expect(decryptField(stored)).toBe("A1234567");
  });

  test("stored value is a JSON string, not the plaintext", () => {
    const stored = encryptField("sensitive-id-number");
    expect(stored).not.toContain("sensitive-id-number");
    expect(() => JSON.parse(stored)).not.toThrow();
  });

  test("throws if KYC_KEYSTORE_PASSPHRASE is unset at call time", () => {
    const original = process.env.KYC_KEYSTORE_PASSPHRASE;
    delete process.env.KYC_KEYSTORE_PASSPHRASE;
    expect(() => encryptField("x")).toThrow(/KYC_KEYSTORE_PASSPHRASE/);
    process.env.KYC_KEYSTORE_PASSPHRASE = original;
  });
});

describe("kycCrypto.js — encryptFileToDisk / decryptFileFromDisk", () => {
  test("round-trips a binary file buffer (simulated ID photo)", () => {
    const originalBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]); // fake JPEG header + bytes
    const storedFilename = encryptFileToDisk(originalBuffer, "user-123", "id-front");
    const recovered = decryptFileFromDisk(storedFilename);
    expect(recovered.equals(originalBuffer)).toBe(true);
  });

  test("the file written to disk is encrypted, not the raw bytes", () => {
    const originalBuffer = Buffer.from("this is definitely not encrypted if visible in the raw file");
    const storedFilename = encryptFileToDisk(originalBuffer, "user-456", "selfie");
    const rawDiskContent = fs.readFileSync(path.join(tmpDocsDir, storedFilename), "utf8");
    expect(rawDiskContent).not.toContain("this is definitely not encrypted");
    // should be the JSON envelope {salt, iv, authTag, ciphertext}
    const parsed = JSON.parse(rawDiskContent);
    expect(parsed).toHaveProperty("salt");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("authTag");
    expect(parsed).toHaveProperty("ciphertext");
  });

  test("stores only a relative filename, never an absolute path", () => {
    const storedFilename = encryptFileToDisk(Buffer.from("x"), "user-789", "id-back");
    expect(storedFilename).not.toContain("/");
    expect(storedFilename).not.toContain(tmpDocsDir);
  });

  test("creates the docs directory if it does not already exist", () => {
    const freshDir = path.join(tmpDocsDir, "not-yet-created");
    const original = process.env.KYC_DOCS_DIR;
    // kycCrypto reads DOCS_DIR once at module load, so we can't swap the env
    // var and expect a re-require in the same process to pick it up without
    // resetting the module registry.
    jest.resetModules();
    process.env.KYC_DOCS_DIR = freshDir;
    const fresh = require("../src/lib/kycCrypto");
    expect(fs.existsSync(freshDir)).toBe(false);
    fresh.encryptFileToDisk(Buffer.from("x"), "user-999", "selfie");
    expect(fs.existsSync(freshDir)).toBe(true);
    process.env.KYC_DOCS_DIR = original;
  });

  test("throws when decrypting with a different passphrase than was used to encrypt", () => {
    const storedFilename = encryptFileToDisk(Buffer.from("secret-doc"), "user-111", "id-front");
    const original = process.env.KYC_KEYSTORE_PASSPHRASE;
    process.env.KYC_KEYSTORE_PASSPHRASE = "a-completely-different-passphrase";
    expect(() => decryptFileFromDisk(storedFilename)).toThrow();
    process.env.KYC_KEYSTORE_PASSPHRASE = original;
  });
});

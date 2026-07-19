jest.mock("../src/lib/prisma", () => ({
  user: { findUnique: jest.fn() },
  platformAdmin: { findUnique: jest.fn() },
}));

const jwt = require("jsonwebtoken");
const prisma = require("../src/lib/prisma");
const { authenticate, requireKycApproved, requirePlatformAdmin } = require("../src/middleware/auth");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("authenticate middleware", () => {
  const JWT_SECRET = "test-jwt-secret";
  beforeAll(() => { process.env.JWT_SECRET = JWT_SECRET; });

  test("rejects a request with no Authorization header", async () => {
    const req = { headers: {} };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, code: "UNAUTHORIZED" }));
  });

  test("rejects a malformed Authorization header (no Bearer prefix)", async () => {
    const req = { headers: { authorization: "sometoken" } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test("rejects an invalid/garbage token", async () => {
    const req = { headers: { authorization: "Bearer garbage.token.here" } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, code: "UNAUTHORIZED" }));
  });

  test("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign({ sub: "user-1" }, "wrong-secret");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test("rejects a valid token if the user no longer exists", async () => {
    const token = jwt.sign({ sub: "user-1" }, JWT_SECRET);
    prisma.user.findUnique.mockResolvedValue(null);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test("rejects a valid token if the user is suspended", async () => {
    const token = jwt.sign({ sub: "user-1" }, JWT_SECRET);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", status: "SUSPENDED" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test("accepts a valid token for an active user and attaches req.user", async () => {
    const token = jwt.sign({ sub: "user-1" }, JWT_SECRET);
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "a@b.com", name: "A", status: "ACTIVE" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();
    await authenticate(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(); // called with no error argument
    expect(req.user).toEqual({ id: "user-1", email: "a@b.com", name: "A", status: "ACTIVE" });
  });
});

describe("requireKycApproved middleware — the actual C1 fund-path gate", () => {
  test("blocks a user whose kycStatus is PENDING_REVIEW", async () => {
    prisma.user.findUnique.mockResolvedValue({ kycStatus: "PENDING_REVIEW" });
    const req = { user: { id: "user-1" } };
    const next = jest.fn();
    await requireKycApproved(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: "KYC_NOT_APPROVED" }));
  });

  test("blocks a user with NOT_SUBMITTED status", async () => {
    prisma.user.findUnique.mockResolvedValue({ kycStatus: "NOT_SUBMITTED" });
    const req = { user: { id: "user-1" } };
    const next = jest.fn();
    await requireKycApproved(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: "KYC_NOT_APPROVED" }));
  });

  test("blocks an explicitly REJECTED user", async () => {
    prisma.user.findUnique.mockResolvedValue({ kycStatus: "REJECTED" });
    const req = { user: { id: "user-1" } };
    const next = jest.fn();
    await requireKycApproved(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: "KYC_NOT_APPROVED" }));
  });

  test("allows a user whose kycStatus is APPROVED", async () => {
    prisma.user.findUnique.mockResolvedValue({ kycStatus: "APPROVED" });
    const req = { user: { id: "user-1" } };
    const next = jest.fn();
    await requireKycApproved(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("requirePlatformAdmin middleware", () => {
  test("blocks a user with no PlatformAdmin record", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    const req = { user: { id: "user-1" } };
    const next = jest.fn();
    await requirePlatformAdmin(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: "FORBIDDEN" }));
  });

  test("allows a user with a PlatformAdmin record and attaches req.platformAdmin", async () => {
    const adminRecord = { id: "admin-1", userId: "user-1", permissions: ["view_all"] };
    prisma.platformAdmin.findUnique.mockResolvedValue(adminRecord);
    const req = { user: { id: "user-1" } };
    const next = jest.fn();
    await requirePlatformAdmin(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.platformAdmin).toEqual(adminRecord);
  });
});

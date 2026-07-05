const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { AppError } = require("./error");

// Verify JWT and attach user to request
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("Missing authorization token", 401, "UNAUTHORIZED");
    }

    const token = header.split(" ")[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, status: true },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new AppError("User not found or suspended", 401, "UNAUTHORIZED");
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return next(new AppError("Invalid or expired token", 401, "UNAUTHORIZED"));
    }
    next(err);
  }
}

// Resolve workspace from :workspaceId param and verify membership
async function requireWorkspace(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId || req.headers["x-workspace-id"];
    if (!workspaceId) throw new AppError("Workspace ID required", 400, "BAD_REQUEST");

    const membership = await prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
      include: { workspace: true, role: true },
    });

    if (!membership || membership.status !== "ACTIVE") {
      throw new AppError("Not a member of this workspace", 403, "FORBIDDEN");
    }

    if (membership.workspace.status !== "ACTIVE") {
      throw new AppError("Workspace is suspended", 403, "FORBIDDEN");
    }

    req.workspace = membership.workspace;
    req.membership = membership;
    req.role = membership.role;
    next();
  } catch (err) {
    next(err);
  }
}

// Check specific permission — resolves workspace from header if not already done
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      // If role already resolved by requireWorkspace, use it directly
      if (req.role) {
        if (!req.role.permissions?.includes(permission)) {
          return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
        }
        return next();
      }

      // Resolve workspace from x-workspace-id header
      const workspaceId = req.headers["x-workspace-id"];
      if (!workspaceId) {
        return next(new AppError("Workspace context required", 400, "BAD_REQUEST"));
      }

      const membership = await prisma.membership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: req.user.id } },
        include: { role: true },
      });

      if (!membership || membership.status !== "ACTIVE") {
        return next(new AppError("Not a member of this workspace", 403, "FORBIDDEN"));
      }

      req.role = membership.role;

      if (!req.role.permissions?.includes(permission)) {
        return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

// Platform admin only
async function requirePlatformAdmin(req, res, next) {
  try {
    const admin = await prisma.platformAdmin.findUnique({
      where: { userId: req.user.id },
    });
    if (!admin) throw new AppError("Platform admin access required", 403, "FORBIDDEN");
    req.platformAdmin = admin;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, requireWorkspace, requirePermission, requirePlatformAdmin };

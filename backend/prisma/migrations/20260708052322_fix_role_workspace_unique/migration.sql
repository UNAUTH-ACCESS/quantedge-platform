-- Fixes a critical bug: role names (ACCOUNT_ADMIN, TRADER, VIEWER) had a
-- GLOBAL unique constraint, meaning only the FIRST workspace ever created
-- could successfully register — every subsequent registration attempt
-- failed with a unique constraint violation on roles.name. Roles are meant
-- to be unique per-workspace (workspaceId=null reserved for future
-- platform-level roles, not currently used).
DROP INDEX IF EXISTS "roles_name_key";
CREATE UNIQUE INDEX "roles_workspaceId_name_key" ON "roles"("workspaceId", "name");

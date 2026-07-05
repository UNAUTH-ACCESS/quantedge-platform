/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `roles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "roles_workspaceId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

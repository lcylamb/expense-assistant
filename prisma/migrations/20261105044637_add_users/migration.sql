/*
  加账号表，并把报销单的归属从「姓名」改成「账号 id」。

  ⚠️ 这个迁移不能只是 `ADD COLUMN "applicantId" TEXT NOT NULL` ——
  库里已经有 10 行 seed 数据时，Postgres 没法给它们填一个非空值，迁移会直接失败。
  这里走的是标准三步：先加可空列 → 回填 → 再收紧成 NOT NULL。

  回填的对象是「库里已经出现过的申请人」。它们的账号密码存的是 `'!'` ——
  一个永远校验不过的值（见 src/modules/auth/password.ts，格式不是
  `scrypt$盐$哈希` 就返回 false）。意思是：这些是**历史数据的占位账号**，
  能挂住外键，但登录不了。真正的演示账号由 `prisma/seed.ts` 重建
  （`npm run db:seed`），那里会给它们一个能用的密码。
*/

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('APPLICANT', 'APPROVER', 'AUDITOR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "department" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AlterTable：先可空，才能给已有行留出回填的时间
ALTER TABLE "expenses" ADD COLUMN "applicantId" TEXT;

-- 回填：每个出现过的申请人补一个占位账号（同名归同一个账号，和新的归属模型一致）
INSERT INTO "users" ("id", "username", "name", "role", "department", "passwordHash")
SELECT
    'legacy-' || md5(e."applicant" || clock_timestamp()::text),
    'legacy_' || md5(e."applicant"),
    e."applicant",
    'APPLICANT',
    min(e."department"),
    '!'
FROM "expenses" e
GROUP BY e."applicant";

UPDATE "expenses" e
SET "applicantId" = u."id"
FROM "users" u
WHERE u."name" = e."applicant";

-- 收紧：现在每一行都有归属了
ALTER TABLE "expenses" ALTER COLUMN "applicantId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "expenses_applicantId_idx" ON "expenses"("applicantId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

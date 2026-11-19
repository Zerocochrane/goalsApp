-- Cadastro pela própria pessoa (#30): status da conta, origem e confirmação do telefone.
-- Usuários existentes ficam ativos e, se já têm telefone, com ele considerado confirmado.
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ativo';
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "createdBy" TEXT NOT NULL DEFAULT 'master';
UPDATE "User" SET "phoneVerifiedAt" = CURRENT_TIMESTAMP WHERE "phone" IS NOT NULL;

-- CreateTable
CREATE TABLE "PhoneVerification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhoneVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneVerification_userId_key" ON "PhoneVerification"("userId");

-- Log de envios do WhatsApp (sucesso ou falha)
CREATE TABLE "MessageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "phone" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "MessageLog_createdAt_idx" ON "MessageLog"("createdAt");

-- Último dia (AAAA-MM-DD, fuso de São Paulo) em que o usuário viu o confete de "tudo concluído"
ALTER TABLE "User" ADD COLUMN "lastDayCelebrated" TEXT;

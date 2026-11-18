-- Versão da sessão: trocar a senha invalida os logins (cookies) emitidos antes
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

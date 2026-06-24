-- AlterTable
ALTER TABLE "associates" ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "password" TEXT;

-- CreateIndex
CREATE INDEX "associates_cpf_idx" ON "associates"("cpf");

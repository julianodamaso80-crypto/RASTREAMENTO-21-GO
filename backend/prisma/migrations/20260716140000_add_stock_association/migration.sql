-- AlterTable: local de instalação do rastreador
ALTER TABLE "devices" ADD COLUMN "install_location" TEXT;

-- AlterTable: associação do item de estoque (vira Device e sai do estoque disponível)
ALTER TABLE "stock_items" ADD COLUMN "associated_at" TIMESTAMP(3);
ALTER TABLE "stock_items" ADD COLUMN "device_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_device_id_key" ON "stock_items"("device_id");

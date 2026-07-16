-- CreateTable
CREATE TABLE "stock_items" (
    "id" UUID NOT NULL,
    "imei" TEXT NOT NULL,
    "iccid" TEXT,
    "line" TEXT,
    "operator" TEXT,
    "status" TEXT,
    "server" TEXT,
    "registered_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "notes" TEXT,
    "tenant_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_items_tenant_id_status_idx" ON "stock_items"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_tenant_id_imei_key" ON "stock_items"("tenant_id", "imei");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

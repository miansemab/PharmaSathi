
/// <reference types="vite/client" />

interface MedicineBatch {
  batch_id: number;
  medicine_id: number;
  name: string;
  generic_name: string;
  manufacturer: string;
  category: string;
  barcode: string;
  minimum_stock: number;
  batch_number: string;
  purchase_price: number;
  sale_price: number;
  quantity: number;
  expiry_date: string;
  created_at: string;
}

interface AddMedicineInput {
  name: string;
  genericName: string;
  manufacturer: string;
  category: string;
  barcode: string;
  batchNumber: string;
  purchasePrice: number | string;
  salePrice: number | string;
  quantity: number | string;
  expiryDate: string;
  minimumStock?: number | string;
}

interface UpdateMedicineBatchInput extends AddMedicineInput {}

interface DatabaseStatusResult {
  success: boolean;
  message: string;
}

interface ListMedicinesResult {
  success: boolean;
  data: MedicineBatch[];
  message?: string;
}

interface AddMedicineResult {
  success: boolean;
  medicineId?: number;
  batchId?: number;
  message?: string;
}

interface UpdateMedicineBatchResult {
  success: boolean;
  batchId?: number;
  medicineId?: number;
  message?: string;
}

interface DeleteMedicineBatchResult {
  success: boolean;
  batchId?: number;
  message?: string;
}

interface StockAlert {
  medicine_id: number;
  name: string;
  generic_name: string;
  manufacturer: string;
  minimum_stock: number;
  available_quantity: number;
}

interface ExpiryAlert {
  batch_id: number;
  medicine_id: number;
  name: string;
  generic_name: string;
  batch_number: string;
  quantity: number;
  expiry_date: string;
  expiry_status: "expired" | "expiring_soon";
  days_until_expiry: number;
}

interface StockAlertsResult {
  success: boolean;
  data: StockAlert[];
  message?: string;
}

interface ExpiryAlertsResult {
  success: boolean;
  data: ExpiryAlert[];
  message?: string;
}

interface Window {
  pharmaSathi: {
    getDatabaseStatus: () => Promise<DatabaseStatusResult>;
    listMedicines: (search?: string) => Promise<ListMedicinesResult>;
    addMedicine: (input: AddMedicineInput) => Promise<AddMedicineResult>;
    updateMedicineBatch: (
      batchId: number,
      input: UpdateMedicineBatchInput
    ) => Promise<UpdateMedicineBatchResult>;
    deleteMedicineBatch: (
      batchId: number
    ) => Promise<DeleteMedicineBatchResult>;
    getStockAlerts: () => Promise<StockAlertsResult>;
    getExpiryAlerts: () => Promise<ExpiryAlertsResult>;
  };
}

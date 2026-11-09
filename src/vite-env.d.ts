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

interface DeviceIdentityResult {
  success: boolean;
  data?: {
    deviceCode: string;
    deviceName: string;
  };
  message?: string;
}

interface PharmacyDatabaseActivationResult {
  success: boolean;
  message?: string;
}

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

interface InventorySummary {
  total_medicines: number;
  total_batches: number;
  available_units: number;
  expired_units: number;
}

interface InventorySummaryResult {
  success: boolean;
  data: InventorySummary | null;
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

interface CreateSaleInput {
  items: Array<{
    batchId: number;
    quantity: number;
  }>;
  paymentMethod: "cash" | "card" | "bank_transfer";
  amountPaid: number;
}

interface CreateSaleResult {
  success: boolean;
  message?: string;
  saleId?: number;
  invoiceNumber?: string;
  subtotal?: number;
  total?: number;
  paymentMethod?: "cash" | "card" | "bank_transfer";
  amountPaid?: number;
  changeDue?: number;
}

interface CreatePurchaseInput {
  supplierName: string;
  supplierInvoice?: string;
  notes?: string;
  items: Array<{
    medicineId: number;
    batchNumber: string;
    quantity: number;
    purchasePrice: number;
    salePrice: number;
    expiryDate: string;
  }>;
}

interface CreatePurchaseResult {
  success: boolean;
  message?: string;
  purchaseId?: number;
  invoiceNumber?: string;
  total?: number;
  itemCount?: number;
}

interface PurchaseHistoryItem {
  id: number;
  invoice_number: string;
  supplier_name: string;
  supplier_invoice: string;
  total: number;
  notes: string;
  created_at: string;
  item_count: number;
  total_units: number;
}

interface ListPurchasesResult {
  success: boolean;
  data: PurchaseHistoryItem[];
  message?: string;
}

interface ReportDateRange {
  startDate: string;
  endDate: string;
}

interface ReportsData {
  startDate: string;
  endDate: string;
  sales: {
    invoice_count: number;
    total_revenue: number;
    amount_received: number;
    change_returned: number;
  };
  profit: {
    units_sold: number;
    item_revenue: number;
    cost_of_goods: number;
    gross_profit: number;
  };
  purchases: {
    purchase_count: number;
    total_purchases: number;
  };
  topMedicines: Array<{
    medicine_id: number;
    medicine_name: string;
    units_sold: number;
    revenue: number;
    gross_profit: number;
  }>;
  dailySales: Array<{
    report_date: string;
    invoice_count: number;
    revenue: number;
  }>;
  stockAlerts: StockAlert[];
  expiryAlerts: ExpiryAlert[];
  inventory: InventorySummary;
}

interface ReportsResult {
  success: boolean;
  data: ReportsData | null;
  message?: string;
}

interface SyncOutboxEvent {
  event_id: string;
  event_type: string;
  entity_type: string;
  payload: unknown;
}

interface PendingSyncEventsResult {
  success: boolean;
  data?: SyncOutboxEvent[];
  message?: string;
}

interface Window {
  pharmaSathi: {
    saveOfflineAccount: (input: {
      email: string;
      password: string;
      user: {
        id: string;
        name: string;
        email: string;
        memberships: Array<{
          role: string;
          pharmacy: { id: string; name: string; slug: string };
        }>;
      };
    }) => Promise<{ success: boolean; message?: string }>;

    authenticateOffline: (input: {
      email: string;
      password: string;
    }) => Promise<{
      success: boolean;
      message?: string;
      user?: {
        id: string;
        name: string;
        email: string;
        memberships: Array<{
          role: string;
          pharmacy: { id: string; name: string; slug: string };
        }>;
      };
      registeredPharmacies?: string[];
    }>;

    getOfflineSession: (email: string) => Promise<{
      success: boolean;
      message?: string;
      user?: {
        id: string;
        name: string;
        email: string;
        memberships: Array<{
          role: string;
          pharmacy: { id: string; name: string; slug: string };
        }>;
      };
      registeredPharmacies?: string[];
    }>;

    markPharmacyRegisteredOffline: (
      email: string,
      pharmacyId: string
    ) => Promise<{ success: boolean; message?: string }>;
    enqueueInitialSyncSnapshot: () => Promise<{
      success: boolean;
      alreadyQueued?: boolean;
      totalEvents?: number;
      queued?: {
        medicines: number;
        batches: number;
        sales: number;
        purchases: number;
      };
      message?: string;
    }>;
    getPendingSyncEvents: (limit?: number) => Promise<PendingSyncEventsResult>;
    acknowledgeSyncEvents: (eventIds: string[]) => Promise<{ success: boolean; updated?: number; message?: string }>;
    markSyncEventFailed: (eventId: string, errorMessage: string) => Promise<{ success: boolean; message?: string }>;
    getDeviceIdentity: (pharmacyId: string) => Promise<DeviceIdentityResult>;
    restoreCloudData: (data: {
      medicines: unknown[];
      batches: unknown[];
      sales: unknown[];
      purchases: unknown[];
    }) => Promise<{ success: boolean; message?: string }>;


    activatePharmacyDatabase: (
      pharmacyId: string
    ) => Promise<PharmacyDatabaseActivationResult>;

    deactivatePharmacyDatabase: () => Promise<{
      success: boolean;
      message?: string;
    }>;

    getDatabaseStatus: () => Promise<DatabaseStatusResult>;
    getInventorySummary: () => Promise<InventorySummaryResult>;
    createSale: (input: CreateSaleInput) => Promise<CreateSaleResult>;
    createPurchase: (input: CreatePurchaseInput) => Promise<CreatePurchaseResult>;
    listPurchases: () => Promise<ListPurchasesResult>;
    getReports: (input: ReportDateRange) => Promise<ReportsResult>;
    listMedicines: (search?: string) => Promise<ListMedicinesResult>;

    createMedicineProfile: (input: {
      name: string;
      genericName?: string;
      manufacturer?: string;
      category: string;
      barcode?: string;
      minimumStock?: number;
    }) => Promise<{
      success: boolean;
      medicineId?: number;
      alreadyExists?: boolean;
      message?: string;
    }>;

    addMedicine: (input: AddMedicineInput) => Promise<AddMedicineResult>;

    updateMedicineBatch: (
      batchId: number,
      input: UpdateMedicineBatchInput
    ) => Promise<UpdateMedicineBatchResult>;

    deleteMedicineBatch: (
      batchId: number
    ) => Promise<DeleteMedicineBatchResult>;

    deleteMedicineProfile: (medicineId: number) => Promise<{
      success: boolean;
      medicineId?: number;
      message?: string;
    }>;

    getStockAlerts: () => Promise<StockAlertsResult>;
    getExpiryAlerts: () => Promise<ExpiryAlertsResult>;
  };
}
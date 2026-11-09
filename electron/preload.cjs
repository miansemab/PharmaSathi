const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pharmaSathi", {
  saveOfflineAccount: (input) => ipcRenderer.invoke("auth:offline-save", input),
  authenticateOffline: (input) => ipcRenderer.invoke("auth:offline-login", input),
  getOfflineSession: (email) => ipcRenderer.invoke("auth:offline-session", email),
  markPharmacyRegisteredOffline: (email, pharmacyId) => ipcRenderer.invoke("auth:offline-mark-registered", email, pharmacyId),
  getDeviceIdentity: (pharmacyId) =>
    ipcRenderer.invoke("device:get-identity", pharmacyId),

  activatePharmacyDatabase: (pharmacyId) =>
    ipcRenderer.invoke("pharmacy:activate-database", pharmacyId),

  deactivatePharmacyDatabase: () =>
    ipcRenderer.invoke("pharmacy:deactivate-database"),

  getDatabaseStatus: () =>
    ipcRenderer.invoke("database:status"),

  listMedicines: (search = "") =>
    ipcRenderer.invoke("medicines:list", search),

  addMedicine: (input) =>
    ipcRenderer.invoke("medicines:add", input),

  createMedicineProfile: (input) =>
    ipcRenderer.invoke("medicines:create-profile", input),

  updateMedicineBatch: (batchId, input) =>
    ipcRenderer.invoke("medicines:update-batch", batchId, input),

  deleteMedicineBatch: (batchId) =>
    ipcRenderer.invoke("medicines:delete-batch", batchId),

  deleteMedicineProfile: (medicineId) =>
    ipcRenderer.invoke("medicines:delete-profile", medicineId),

  getStockAlerts: () =>
    ipcRenderer.invoke("medicines:stock-alerts"),

  getExpiryAlerts: () =>
    ipcRenderer.invoke("medicines:expiry-alerts"),

  getInventorySummary: () =>
    ipcRenderer.invoke("inventory:summary"),

  createSale: (input) =>
    ipcRenderer.invoke("sales:create", input),

  createPurchase: (input) =>
    ipcRenderer.invoke("purchases:create", input),

  listPurchases: () =>
    ipcRenderer.invoke("purchases:list"),

  getReports: (input) =>
    ipcRenderer.invoke("reports:get", input),

  enqueueInitialSyncSnapshot: () =>
    ipcRenderer.invoke("sync:initial-snapshot"),

  restoreCloudData: (data) =>
    ipcRenderer.invoke("sync:restore-cloud", data),

  getPendingSyncEvents: (limit = 100) =>
    ipcRenderer.invoke("sync:pending-events", limit),

  acknowledgeSyncEvents: (eventIds) =>
    ipcRenderer.invoke("sync:acknowledge-events", eventIds),

  markSyncEventFailed: (eventId, errorMessage) =>
    ipcRenderer.invoke("sync:mark-failed", eventId, errorMessage),
});

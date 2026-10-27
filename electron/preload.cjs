
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pharmaSathi", {
  getDatabaseStatus: () =>
    ipcRenderer.invoke("database:status"),

  listMedicines: (search = "") =>
    ipcRenderer.invoke("medicines:list", search),

  addMedicine: (input) =>
    ipcRenderer.invoke("medicines:add", input),

  updateMedicineBatch: (batchId, input) =>
    ipcRenderer.invoke("medicines:update-batch", batchId, input),

  deleteMedicineBatch: (batchId) =>
    ipcRenderer.invoke("medicines:delete-batch", batchId),

  getStockAlerts: () =>
    ipcRenderer.invoke("medicines:stock-alerts"),

  getExpiryAlerts: () =>
    ipcRenderer.invoke("medicines:expiry-alerts"),
});

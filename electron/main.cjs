const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const { createOfflineAuth } = require("./offline-auth.cjs");
const {
  activatePharmacyDatabase,
  getDatabase,
  listBatches,
  addMedicine,
  createMedicineProfile,
  updateBatch,
  deleteBatch,
  deleteMedicineProfile,
  getStockAlerts,
  getExpiryAlerts,
  getInventorySummary,
  createSale,
  createPurchase,
  listPurchases,
  getReports,
  enqueueInitialSyncSnapshot,
  restoreCloudData,
  getPendingSyncEvents,
  markSyncEventsSynced,
  markSyncEventFailed,
  deactivatePharmacyDatabase,
} = require("./database.cjs");
const path = require("node:path");
const { getDeviceIdentity } = require("./device-identity.cjs");

if (process.env.PHARMASATHI_TEST_MODE === "1") {
  const testUserData = path.join(app.getPath("appData"), "pharmasathi-test");
  app.setPath("userData", testUserData);
  console.log("PHARMASATHI TEST MODE ENABLED:", testUserData);
}

const isDevelopment = !app.isPackaged;
const offlineAuth = createOfflineAuth({ app, safeStorage });

function registerOfflineAuthHandlers() {
  ipcMain.handle("auth:offline-save", (_event, input) => {
    try { return offlineAuth.saveAccount(input); }
    catch (error) { return { success: false, message: error.message || "Could not save offline account." }; }
  });

  ipcMain.handle("auth:offline-login", (_event, input) => {
    try { return offlineAuth.authenticate(input); }
    catch (error) { return { success: false, message: error.message || "Offline login failed." }; }
  });

  ipcMain.handle("auth:offline-session", (_event, email) => {
    try { return offlineAuth.getSession(email); }
    catch (error) { return { success: false, message: error.message || "Could not restore offline session." }; }
  });

  ipcMain.handle("auth:offline-mark-registered", (_event, email, pharmacyId) => {
    try { return offlineAuth.markPharmacyRegistered(email, pharmacyId); }
    catch (error) { return { success: false, message: error.message || "Could not save device registration." }; }
  });
}

function registerDatabaseHandlers() {
  // Called by the renderer only after the server confirms device registration
  // for the selected pharmacy.
  ipcMain.handle("pharmacy:activate-database", (_event, pharmacyId) => {
    try {
      activatePharmacyDatabase(pharmacyId);

      return {
        success: true,
        message: "Pharmacy database activated successfully.",
      };
    } catch (error) {
      console.error("Activate pharmacy database error:", error);

      return {
        success: false,
        message: error.message || "Could not activate the pharmacy database.",
      };
    }
  });

  ipcMain.handle("pharmacy:deactivate-database", () => {
    try {
      deactivatePharmacyDatabase();
      return { success: true, message: "Pharmacy database deactivated successfully." };
    } catch (error) {
      console.error("Deactivate pharmacy database error:", error);
      return {
        success: false,
        message: error.message || "Could not deactivate the pharmacy database.",
      };
    }
  });

  ipcMain.handle("database:status", () => {
    try {
      const db = getDatabase();
      const result = db.prepare("SELECT 1 AS test").get();

      return {
        success: result.test === 1,
        message: "SQLite database connected successfully",
      };
    } catch (error) {
      console.error("Database status error:", error);

      return {
        success: false,
        message: error.message || "Database connection failed",
      };
    }
  });

  ipcMain.handle("medicines:list", (_event, search = "") => {
    try {
      return {
        success: true,
        data: listBatches(search),
      };
    } catch (error) {
      console.error("List medicines error:", error);

      return {
        success: false,
        message: error.message || "Could not load medicines.",
        data: [],
      };
    }
  });

  ipcMain.handle("medicines:add", (_event, input) => {
    try {
      const result = addMedicine(input);

      return {
        success: true,
        ...result,
        message: "Medicine batch saved successfully.",
      };
    } catch (error) {
      console.error("Add medicine error:", error);

      return {
        success: false,
        message: error.message || "Could not save the medicine batch.",
      };
    }
  });

  ipcMain.handle("medicines:create-profile", (_event, input) => {
    try {
      const result = createMedicineProfile(input);

      return {
        success: true,
        ...result,
        message: result.alreadyExists
          ? "This medicine is already in your inventory."
          : "Medicine added to your inventory. Stock is currently zero.",
      };
    } catch (error) {
      console.error("Create medicine profile error:", error);

      return {
        success: false,
        message: error.message || "Could not add medicine to inventory.",
      };
    }
  });

  ipcMain.handle("medicines:update-batch", (_event, batchId, input) => {
    try {
      const result = updateBatch(batchId, input);

      return {
        success: true,
        ...result,
        message: "Medicine batch updated successfully.",
      };
    } catch (error) {
      console.error("Update medicine batch error:", error);

      return {
        success: false,
        message: error.message || "Could not update the medicine batch.",
      };
    }
  });

  ipcMain.handle("medicines:delete-batch", (_event, batchId) => {
    try {
      const result = deleteBatch(batchId);

      return {
        success: true,
        ...result,
        message: "Medicine batch deleted successfully.",
      };
    } catch (error) {
      console.error("Delete medicine batch error:", error);

      return {
        success: false,
        message: error.message || "Could not delete the medicine batch.",
      };
    }
  });

  ipcMain.handle("medicines:delete-profile", (_event, medicineId) => {
    try {
      const result = deleteMedicineProfile(medicineId);
      return {
        success: true,
        ...result,
        message: "Medicine profile removed from this pharmacy inventory.",
      };
    } catch (error) {
      console.error("Delete medicine profile error:", error);
      return {
        success: false,
        message: error.message || "Could not delete medicine profile.",
      };
    }
  });

  ipcMain.handle("medicines:stock-alerts", () => {
    try {
      return {
        success: true,
        data: getStockAlerts(),
      };
    } catch (error) {
      console.error("Stock alerts error:", error);

      return {
        success: false,
        message: error.message || "Could not load stock alerts.",
        data: [],
      };
    }
  });

  ipcMain.handle("medicines:expiry-alerts", () => {
    try {
      return {
        success: true,
        data: getExpiryAlerts(),
      };
    } catch (error) {
      console.error("Expiry alerts error:", error);

      return {
        success: false,
        message: error.message || "Could not load expiry alerts.",
        data: [],
      };
    }
  });

  ipcMain.handle("inventory:summary", () => {
    try {
      return {
        success: true,
        data: getInventorySummary(),
      };
    } catch (error) {
      console.error("Inventory summary error:", error);

      return {
        success: false,
        message: error.message || "Could not load inventory summary.",
        data: null,
      };
    }
  });

  ipcMain.handle("purchases:create", (_event, input) => {
    try {
      return createPurchase(input);
    } catch (error) {
      console.error("Create purchase error:", error);
      return {
        success: false,
        message: error.message || "Could not save the purchase.",
      };
    }
  });

  ipcMain.handle("purchases:list", () => {
    try {
      return {
        success: true,
        data: listPurchases(),
      };
    } catch (error) {
      console.error("List purchases error:", error);
      return {
        success: false,
        message: error.message || "Could not load purchase history.",
        data: [],
      };
    }
  });

  ipcMain.handle("reports:get", (_event, input) => {
    try {
      return {
        success: true,
        data: getReports(input),
      };
    } catch (error) {
      console.error("Get reports error:", error);
      return {
        success: false,
        message: error.message || "Could not load reports.",
        data: null,
      };
    }
  });

  ipcMain.handle("sync:restore-cloud", (_event, data) => {
    try {
      return restoreCloudData(data);
    } catch (error) {
      console.error("Cloud restore import error:", error);
      return {
        success: false,
        message: error.message || "Could not restore cloud data.",
      };
    }
  });

  ipcMain.handle("sync:initial-snapshot", () => {
    try {
      return enqueueInitialSyncSnapshot();
    } catch (error) {
      console.error("Initial sync snapshot error:", error);
      return {
        success: false,
        message: error.message || "Could not prepare initial cloud backup.",
      };
    }
  });

  ipcMain.handle("sync:pending-events", (_event, limit = 100) => {
    try {
      return { success: true, data: getPendingSyncEvents(limit) };
    } catch (error) {
      console.error("Read sync events error:", error);
      return { success: false, message: error.message || "Could not read sync events." };
    }
  });

  ipcMain.handle("sync:acknowledge-events", (_event, eventIds) => {
    try {
      return markSyncEventsSynced(eventIds);
    } catch (error) {
      console.error("Acknowledge sync events error:", error);
      return { success: false, message: error.message || "Could not acknowledge sync events." };
    }
  });

  ipcMain.handle("sync:mark-failed", (_event, eventId, errorMessage) => {
    try {
      return markSyncEventFailed(eventId, errorMessage);
    } catch (error) {
      console.error("Mark sync event failed error:", error);
      return { success: false, message: error.message || "Could not update sync event." };
    }
  });

  ipcMain.handle("sales:create", (_event, input) => {
    try {
      return createSale(input);
    } catch (error) {
      console.error("Create sale error:", error);
      return {
        success: false,
        message: error.message || "Could not complete the sale.",
      };
    }
  });
}

function registerDeviceIdentityHandler() {
  ipcMain.handle("device:get-identity", (_event, pharmacyId) => {
    try {
      return {
        success: true,
        data: getDeviceIdentity(app.getPath("userData"), pharmacyId),
      };
    } catch (error) {
      console.error("Device identity error:", error);

      return {
        success: false,
        message: error.message || "Could not load device identity.",
      };
    }
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    title: "PharmaSathi",
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDevelopment) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  try {
    // Do not open a pharmacy database at startup. The renderer activates
    // the correct pharmacy database after successful server registration.
    registerDatabaseHandlers();
    registerDeviceIdentityHandler();
    registerOfflineAuthHandlers();
    createWindow();
  } catch (error) {
    console.error("PharmaSathi startup error:", error);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  deactivatePharmacyDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

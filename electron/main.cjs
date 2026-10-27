
const { app, BrowserWindow, ipcMain } = require("electron");
const {
  getDatabase,
  listBatches,
  addMedicine,
  updateBatch,
  deleteBatch,
  getStockAlerts,
  getExpiryAlerts,
  closeDatabase,
} = require("./database.cjs");
const path = require("node:path");

const isDevelopment = !app.isPackaged;

function registerDatabaseHandlers() {
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
        message: "Database connection failed",
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
    getDatabase();
    registerDatabaseHandlers();
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
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

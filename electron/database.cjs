

const { app } = require("electron");

const { DatabaseSync } = require("node:sqlite");

const path = require("node:path");

const fs = require("node:fs");
const { randomUUID } = require("node:crypto");



let database;
let activePharmacyId = null;

function activatePharmacyDatabase(pharmacyId) {
  if (
    typeof pharmacyId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(pharmacyId)
  ) {
    throw new Error("A valid pharmacy ID is required.");
  }

  if (activePharmacyId !== pharmacyId) {
    closeDatabase();
    activePharmacyId = pharmacyId;
  }

  return getDatabase();
}

function getDatabase() {
  if (!activePharmacyId) {
    throw new Error("Select and register a pharmacy before using the database.");
  }

  if (database) return database;

  const dataDirectory = path.join(
    app.getPath("userData"),
    "data",
    "pharmacies",
    activePharmacyId
  );
  fs.mkdirSync(dataDirectory, { recursive: true });

  const databasePath = path.join(dataDirectory, "pharmasathi.db");
  database = new DatabaseSync(databasePath);

  try {

    database.exec(`

      PRAGMA foreign_keys = ON;

      PRAGMA journal_mode = WAL;



      CREATE TABLE IF NOT EXISTS medicines (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL,

        generic_name TEXT NOT NULL DEFAULT '',

        manufacturer TEXT NOT NULL DEFAULT '',

        category TEXT NOT NULL DEFAULT '',

        barcode TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

      );



      CREATE TABLE IF NOT EXISTS medicine_batches (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        medicine_id INTEGER NOT NULL,

        batch_number TEXT NOT NULL,

        purchase_price REAL NOT NULL DEFAULT 0,

        sale_price REAL NOT NULL DEFAULT 0,

        quantity INTEGER NOT NULL DEFAULT 0,

        expiry_date TEXT NOT NULL,

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (medicine_id) REFERENCES medicines(id)

          ON DELETE RESTRICT,

        UNIQUE (medicine_id, batch_number),

        CHECK (purchase_price >= 0),

        CHECK (sale_price >= 0),

        CHECK (quantity >= 0)

      );



      CREATE INDEX IF NOT EXISTS idx_medicines_name

        ON medicines(name);



      CREATE INDEX IF NOT EXISTS idx_medicines_generic_name

        ON medicines(generic_name);



      CREATE INDEX IF NOT EXISTS idx_batches_expiry

        ON medicine_batches(expiry_date);



      CREATE TABLE IF NOT EXISTS sales (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        invoice_number TEXT NOT NULL UNIQUE,

        subtotal REAL NOT NULL CHECK (subtotal >= 0),

        total REAL NOT NULL CHECK (total >= 0),

        payment_method TEXT NOT NULL,

        amount_paid REAL NOT NULL CHECK (amount_paid >= 0),

        change_due REAL NOT NULL DEFAULT 0 CHECK (change_due >= 0),

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

      );



      CREATE TABLE IF NOT EXISTS sale_items (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        sale_id INTEGER NOT NULL,

        medicine_id INTEGER NOT NULL,

        batch_id INTEGER NOT NULL,

        medicine_name TEXT NOT NULL,

        batch_number TEXT NOT NULL,

        quantity INTEGER NOT NULL CHECK (quantity > 0),

        unit_price REAL NOT NULL CHECK (unit_price >= 0),

        unit_cost REAL NOT NULL CHECK (unit_cost >= 0),

        line_total REAL NOT NULL CHECK (line_total >= 0),

        FOREIGN KEY (sale_id) REFERENCES sales(id)

          ON DELETE RESTRICT,

        FOREIGN KEY (medicine_id) REFERENCES medicines(id)

          ON DELETE RESTRICT

      );



      CREATE TABLE IF NOT EXISTS purchases (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        invoice_number TEXT NOT NULL UNIQUE,

        supplier_name TEXT NOT NULL,

        supplier_invoice TEXT NOT NULL DEFAULT '',

        total REAL NOT NULL CHECK (total >= 0),

        notes TEXT NOT NULL DEFAULT '',

        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

      );



      CREATE TABLE IF NOT EXISTS purchase_items (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        purchase_id INTEGER NOT NULL,

        medicine_id INTEGER NOT NULL,

        batch_id INTEGER NOT NULL,

        medicine_name TEXT NOT NULL,

        batch_number TEXT NOT NULL,

        quantity INTEGER NOT NULL CHECK (quantity > 0),

        unit_cost REAL NOT NULL CHECK (unit_cost >= 0),

        unit_sale_price REAL NOT NULL CHECK (unit_sale_price >= 0),

        line_total REAL NOT NULL CHECK (line_total >= 0),

        FOREIGN KEY (purchase_id) REFERENCES purchases(id)

          ON DELETE RESTRICT,

        FOREIGN KEY (medicine_id) REFERENCES medicines(id)

          ON DELETE RESTRICT,

        FOREIGN KEY (batch_id) REFERENCES medicine_batches(id)

          ON DELETE RESTRICT

      );



      CREATE INDEX IF NOT EXISTS idx_purchases_created_at

        ON purchases(created_at);



      CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id

        ON purchase_items(purchase_id);



      CREATE INDEX IF NOT EXISTS idx_sales_created_at

        ON sales(created_at);



      CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id

        ON sale_items(sale_id);

    `);



    // Safe migration for existing databases.

    const columns = database.prepare(

      "PRAGMA table_info(medicines)"

    ).all();



    const hasMinimumStock = columns.some(

      (column) => column.name === "minimum_stock"

    );



    if (!hasMinimumStock) {

      database.exec(`

        ALTER TABLE medicines

        ADD COLUMN minimum_stock INTEGER NOT NULL DEFAULT 10

        CHECK (minimum_stock >= 0);

      `);

    }
        // Stable UUIDs for cross-device synchronization.
    const syncTables = [
      "medicines",
      "medicine_batches",
      "sales",
      "sale_items",
      "purchases",
      "purchase_items",
    ];

    for (const table of syncTables) {
      const tableColumns = database.prepare(
        `PRAGMA table_info(${table})`
      ).all();

      const hasSyncId = tableColumns.some(
        (column) => column.name === "sync_id"
      );

      if (!hasSyncId) {
        database.exec(
          `ALTER TABLE ${table} ADD COLUMN sync_id TEXT`
        );
      }

      const missingIds = database.prepare(
        `SELECT id FROM ${table} WHERE sync_id IS NULL OR sync_id = ''`
      ).all();

      const updateId = database.prepare(
        `UPDATE ${table} SET sync_id = ? WHERE id = ?`
      );

      for (const row of missingIds) {
        updateId.run(randomUUID(), row.id);
      }

      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS
        idx_${table}_sync_id
        ON ${table}(sync_id)
      `);
    }

    // Durable offline-first synchronization queue.
    database.exec(`
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_sync_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'SYNCED', 'FAILED')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        synced_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sync_outbox_status
        ON sync_outbox(status, id);

      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);



    console.log("PharmaSathi database initialized:", databasePath);

    return database;

  } catch (error) {

    database.close();

    database = undefined;

    throw error;

  }

}



function enqueueSyncEvent(db, eventType, entityType, entitySyncId, payload) {
  if (!db || !eventType || !entityType || !entitySyncId) {
    throw new Error("Invalid synchronization event.");
  }

  const eventId = randomUUID();

  db.prepare(`
    INSERT INTO sync_outbox (
      event_id,
      event_type,
      entity_type,
      entity_sync_id,
      payload
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(
    eventId,
    eventType,
    entityType,
    entitySyncId,
    JSON.stringify(payload)
  );

  return eventId;
}




// Return pending and failed events for safe retry.
// Events remain in the outbox until explicitly acknowledged.
function getPendingSyncEvents(limit = 100) {
  const batchSize = Number(limit);

  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Sync event limit must be between 1 and 500.");
  }

  const db = getDatabase();

  return db.prepare(`
    SELECT
      id,
      event_id,
      event_type,
      entity_type,
      entity_sync_id,
      payload,
      status,
      attempts,
      last_error,
      created_at
    FROM sync_outbox
    WHERE status IN ('PENDING', 'FAILED')
    ORDER BY id ASC
    LIMIT ?
  `).all(batchSize).map((event) => ({
    ...event,
    payload: JSON.parse(event.payload),
  }));
}


// Acknowledge only event IDs confirmed by the sync server.
function markSyncEventsSynced(eventIds) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    throw new Error("Provide at least one sync event ID.");
  }

  if (
    eventIds.length > 500 ||
    eventIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(eventIds).size !== eventIds.length
  ) {
    throw new Error("Invalid or duplicate sync event IDs.");
  }

  const db = getDatabase();

  db.exec("BEGIN IMMEDIATE");

  try {
    const update = db.prepare(`
      UPDATE sync_outbox
      SET status = 'SYNCED',
          synced_at = CURRENT_TIMESTAMP,
          last_error = ''
      WHERE event_id = ?
        AND status IN ('PENDING', 'FAILED')
    `);

    let updated = 0;

    for (const eventId of eventIds) {
      updated += Number(update.run(eventId).changes);
    }

    db.exec("COMMIT");

    return { success: true, updated };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}

    throw error;
  }
}


// Keep failed events for retry and preserve the latest error.
function markSyncEventFailed(eventId, error) {
  if (typeof eventId !== "string" || !eventId.trim()) {
    throw new Error("Invalid sync event ID.");
  }

  const message = error instanceof Error
    ? error.message
    : String(error ?? "Unknown synchronization error.");

  const db = getDatabase();

  const result = db.prepare(`
    UPDATE sync_outbox
    SET status = 'FAILED',
        attempts = attempts + 1,
        last_error = ?,
        synced_at = NULL
    WHERE event_id = ?
      AND status IN ('PENDING', 'FAILED')
  `).run(message.slice(0, 2000), eventId);

  if (Number(result.changes) !== 1) {
    throw new Error("Sync event not found or already acknowledged.");
  }

  return { success: true };
}

function validateText(value, field, maxLength = 150) {

  if (typeof value !== "string" || !value.trim()) {

    throw new Error(`${field} is required.`);

  }



  const cleaned = value.trim();



  if (cleaned.length > maxLength) {

    throw new Error(`${field} must be ${maxLength} characters or fewer.`);

  }



  return cleaned;

}



function optionalText(value, field, maxLength = 150) {

  if (value === undefined || value === null || value === "") {

    return "";

  }



  if (typeof value !== "string") {

    throw new Error(`${field} must be text.`);

  }



  const cleaned = value.trim();



  if (cleaned.length > maxLength) {

    throw new Error(`${field} must be ${maxLength} characters or fewer.`);

  }



  return cleaned;

}



function validatePrice(value, field) {

  if (value === "" || value === null || value === undefined) {

    throw new Error(`${field} is required.`);

  }



  const number = Number(value);



  if (!Number.isFinite(number) || number < 0 || number > 100000000) {

    throw new Error(`${field} must be a valid non-negative price.`);

  }



  return number;

}



function validateQuantity(value) {

  if (value === "" || value === null || value === undefined) {

    throw new Error("Quantity is required.");

  }



  const number = Number(value);



  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000000) {

    throw new Error("Quantity must be a valid non-negative whole number.");

  }



  return number;

}



function validateMinimumStock(value) {

  if (value === "" || value === null || value === undefined) {

    throw new Error("Minimum stock level is required.");

  }



  const number = Number(value);



  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000000) {

    throw new Error("Minimum stock must be a non-negative whole number.");

  }



  return number;

}



function validateExpiryDate(value) {

  const date = validateText(value, "Expiry date", 10);



  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {

    throw new Error("Expiry date must use YYYY-MM-DD format.");

  }



  const parsed = new Date(`${date}T00:00:00Z`);



  if (

    Number.isNaN(parsed.getTime()) ||

    parsed.toISOString().slice(0, 10) !== date

  ) {

    throw new Error("Please enter a valid expiry date.");

  }



  return date;

}



function validateMedicineInput(input) {

  if (!input || typeof input !== "object" || Array.isArray(input)) {

    throw new Error("Invalid medicine details.");

  }



  return {

    name: validateText(input.name, "Medicine name"),

    genericName: optionalText(input.genericName, "Generic name"),

    manufacturer: optionalText(input.manufacturer, "Manufacturer"),

    category: optionalText(input.category, "Category"),

    barcode: optionalText(input.barcode, "Barcode", 100),

    batchNumber: validateText(input.batchNumber, "Batch number", 100),

    purchasePrice: validatePrice(input.purchasePrice, "Purchase price"),

    salePrice: validatePrice(input.salePrice, "Sale price"),

    quantity: validateQuantity(input.quantity),

    expiryDate: validateExpiryDate(input.expiryDate),

    minimumStock: validateMinimumStock(

      input.minimumStock === undefined ? 10 : input.minimumStock

    ),

  };

}



function listBatches(search = "") {

  const db = getDatabase();



  if (typeof search !== "string") {

    throw new Error("Search must be text.");

  }



  const term = search.trim().slice(0, 100);

  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;



  return db.prepare(`

    SELECT

      b.id AS batch_id,

      m.id AS medicine_id,

      m.name,

      m.generic_name,

      m.manufacturer,

      m.category,

      m.barcode,

      m.minimum_stock,

      COALESCE(b.batch_number, '') AS batch_number,

      COALESCE(b.purchase_price, 0) AS purchase_price,

      COALESCE(b.sale_price, 0) AS sale_price,

      COALESCE(b.quantity, 0) AS quantity,

      COALESCE(b.expiry_date, '') AS expiry_date,

      b.created_at

    FROM medicines m

    LEFT JOIN medicine_batches b ON b.medicine_id = m.id

    WHERE

      @empty = 1

      OR m.name LIKE @pattern ESCAPE '\\\\'

      OR m.generic_name LIKE @pattern ESCAPE '\\\\'

      OR m.manufacturer LIKE @pattern ESCAPE '\\\\'

      OR m.barcode LIKE @pattern ESCAPE '\\\\'

      OR b.batch_number LIKE @pattern ESCAPE '\\\\'

    ORDER BY m.name COLLATE NOCASE, b.expiry_date ASC

    LIMIT 500

  `).all({

    empty: term ? 0 : 1,

    pattern,

  });

}

function createMedicineProfile(input) {
  const name = String(input.name || "").trim();
  const genericName = String(input.genericName || "").trim();
  const manufacturer = String(input.manufacturer || "").trim();
  const category = String(input.category || "").trim();
  const barcode = String(input.barcode || "").trim();
  const minimumStock = Number(input.minimumStock ?? 10);

  if (!name) throw new Error("Medicine name is required.");
  if (!category) throw new Error("Medicine category is required.");
  if (!Number.isInteger(minimumStock) || minimumStock < 0) {
    throw new Error("Minimum stock must be a valid non-negative number.");
  }

  const db = getDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    const existing = db.prepare(`
      SELECT id, sync_id
      FROM medicines
      WHERE name = ? COLLATE NOCASE
        AND generic_name = ? COLLATE NOCASE
        AND manufacturer = ? COLLATE NOCASE
      LIMIT 1
    `).get(name, genericName, manufacturer);

    if (existing) {
      db.exec("COMMIT");
      return {
        success: true,
        medicineId: existing.id,
        alreadyExists: true,
      };
    }

    const syncId = randomUUID();

    const result = db.prepare(`
      INSERT INTO medicines (
        name, generic_name, manufacturer, category,
        barcode, minimum_stock, sync_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, genericName, manufacturer,
      category, barcode, minimumStock, syncId
    );

    const medicineId = Number(result.lastInsertRowid);

    enqueueSyncEvent(db, "UPSERT", "MEDICINE", syncId, {
      localId: medicineId,
      syncId,
      name,
      genericName,
      manufacturer,
      category,
      barcode,
      minimumStock,
    });

    db.exec("COMMIT");

    return {
      success: true,
      medicineId,
      alreadyExists: false,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}
function addMedicine(input) {
  const medicineData = validateMedicineInput(input);
  const db = getDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    let medicine = db.prepare(`
      SELECT id, sync_id
      FROM medicines
      WHERE name = ? COLLATE NOCASE
        AND generic_name = ? COLLATE NOCASE
        AND manufacturer = ? COLLATE NOCASE
      LIMIT 1
    `).get(
      medicineData.name,
      medicineData.genericName,
      medicineData.manufacturer
    );

    let medicineId;
    let medicineSyncId;

    if (medicine) {
      medicineId = medicine.id;
      medicineSyncId = medicine.sync_id;

      db.prepare(`
        UPDATE medicines
        SET category = ?,
            barcode = ?,
            minimum_stock = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        medicineData.category,
        medicineData.barcode,
        medicineData.minimumStock,
        medicineId
      );
    } else {
      medicineSyncId = randomUUID();

      const result = db.prepare(`
        INSERT INTO medicines (
          name, generic_name, manufacturer, category,
          barcode, minimum_stock, sync_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        medicineData.name,
        medicineData.genericName,
        medicineData.manufacturer,
        medicineData.category,
        medicineData.barcode,
        medicineData.minimumStock,
        medicineSyncId
      );

      medicineId = Number(result.lastInsertRowid);
    }

    enqueueSyncEvent(db, "UPSERT", "MEDICINE", medicineSyncId, {
      localId: medicineId,
      syncId: medicineSyncId,
      name: medicineData.name,
      genericName: medicineData.genericName,
      manufacturer: medicineData.manufacturer,
      category: medicineData.category,
      barcode: medicineData.barcode,
      minimumStock: medicineData.minimumStock,
    });

    const batchSyncId = randomUUID();

    const batchResult = db.prepare(`
      INSERT INTO medicine_batches (
        medicine_id, batch_number, purchase_price,
        sale_price, quantity, expiry_date, sync_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      medicineId,
      medicineData.batchNumber,
      medicineData.purchasePrice,
      medicineData.salePrice,
      medicineData.quantity,
      medicineData.expiryDate,
      batchSyncId
    );

    const batchId = Number(batchResult.lastInsertRowid);

    enqueueSyncEvent(db, "UPSERT", "MEDICINE_BATCH", batchSyncId, {
      localId: batchId,
      syncId: batchSyncId,
      medicineSyncId,
      medicineId,
      batchNumber: medicineData.batchNumber,
      purchasePrice: medicineData.purchasePrice,
      salePrice: medicineData.salePrice,
      quantity: medicineData.quantity,
      expiryDate: medicineData.expiryDate,
    });

    db.exec("COMMIT");

    return {
      success: true,
      medicineId,
      batchId,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}

    if (String(error.message).includes("UNIQUE constraint failed")) {
      throw new Error(
        "This batch number already exists for this medicine. Check the batch number."
      );
    }

    throw error;
  }
}

function updateBatch(batchId, input) {
  const id = Number(batchId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid batch ID.");
  }

  const medicineData = validateMedicineInput(input);
  const db = getDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    const existingBatch = db.prepare(`
      SELECT id, medicine_id, sync_id
      FROM medicine_batches
      WHERE id = ?
    `).get(id);

    if (!existingBatch) {
      throw new Error(
        "This batch was not found. Refresh the inventory and try again."
      );
    }

    const existingMedicine = db.prepare(`
      SELECT id
      FROM medicines
      WHERE name = ? COLLATE NOCASE
        AND generic_name = ? COLLATE NOCASE
        AND manufacturer = ? COLLATE NOCASE
        AND id != ?
      LIMIT 1
    `).get(
      medicineData.name,
      medicineData.genericName,
      medicineData.manufacturer,
      existingBatch.medicine_id
    );

    let targetMedicineId = existingBatch.medicine_id;

    if (existingMedicine) {
      targetMedicineId = existingMedicine.id;

      db.prepare(`
        UPDATE medicines
        SET category = ?,
            barcode = ?,
            minimum_stock = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        medicineData.category,
        medicineData.barcode,
        medicineData.minimumStock,
        targetMedicineId
      );
    } else {
      db.prepare(`
        UPDATE medicines
        SET name = ?,
            generic_name = ?,
            manufacturer = ?,
            category = ?,
            barcode = ?,
            minimum_stock = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        medicineData.name,
        medicineData.genericName,
        medicineData.manufacturer,
        medicineData.category,
        medicineData.barcode,
        medicineData.minimumStock,
        targetMedicineId
      );
    }

    db.prepare(`
      UPDATE medicine_batches
      SET medicine_id = ?,
          batch_number = ?,
          purchase_price = ?,
          sale_price = ?,
          quantity = ?,
          expiry_date = ?
      WHERE id = ?
    `).run(
      targetMedicineId,
      medicineData.batchNumber,
      medicineData.purchasePrice,
      medicineData.salePrice,
      medicineData.quantity,
      medicineData.expiryDate,
      id
    );

    const targetMedicine = db.prepare(`
      SELECT id, name, generic_name, manufacturer, category,
             barcode, minimum_stock, sync_id
      FROM medicines
      WHERE id = ?
    `).get(targetMedicineId);

    const updatedBatch = db.prepare(`
      SELECT id, medicine_id, batch_number, purchase_price,
             sale_price, quantity, expiry_date, sync_id
      FROM medicine_batches
      WHERE id = ?
    `).get(id);

    enqueueSyncEvent(db, "UPSERT", "MEDICINE", targetMedicine.sync_id, {
      localId: targetMedicine.id,
      syncId: targetMedicine.sync_id,
      name: targetMedicine.name,
      genericName: targetMedicine.generic_name,
      manufacturer: targetMedicine.manufacturer,
      category: targetMedicine.category,
      barcode: targetMedicine.barcode,
      minimumStock: targetMedicine.minimum_stock,
    });

    enqueueSyncEvent(db, "UPSERT", "MEDICINE_BATCH", updatedBatch.sync_id, {
      localId: updatedBatch.id,
      syncId: updatedBatch.sync_id,
      medicineSyncId: targetMedicine.sync_id,
      medicineId: targetMedicine.id,
      batchNumber: updatedBatch.batch_number,
      purchasePrice: updatedBatch.purchase_price,
      salePrice: updatedBatch.sale_price,
      quantity: updatedBatch.quantity,
      expiryDate: updatedBatch.expiry_date,
    });

    db.exec("COMMIT");

    return {
      success: true,
      batchId: id,
      medicineId: targetMedicineId,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Transaction may already have been rolled back.
    }

    if (String(error.message).includes("UNIQUE constraint failed")) {
      throw new Error(
        "This batch number already exists for that medicine. Check the batch number."
      );
    }

    throw error;
  }
}

function deleteMedicineProfile(medicineId) {
  const id = Number(medicineId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid medicine ID.");
  }

  const db = getDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    const medicine = db.prepare(
      "SELECT id, name, sync_id FROM medicines WHERE id = ?"
    ).get(id);

    if (!medicine) throw new Error("Medicine profile not found.");

    const batches = db.prepare(
      "SELECT COUNT(*) AS total FROM medicine_batches WHERE medicine_id = ?"
    ).get(id).total;

    const purchases = db.prepare(
      "SELECT COUNT(*) AS total FROM purchase_items WHERE medicine_id = ?"
    ).get(id).total;

    const sales = db.prepare(
      "SELECT COUNT(*) AS total FROM sale_items WHERE medicine_id = ?"
    ).get(id).total;

    if (batches || purchases || sales) {
      throw new Error(
        "This medicine has batches or transaction history. It cannot be deleted."
      );
    }

    enqueueSyncEvent(db, "DELETE", "MEDICINE", medicine.sync_id, {
      syncId: medicine.sync_id,
      localId: id,
      name: medicine.name,
      deleted: true,
    });

    db.prepare("DELETE FROM medicines WHERE id = ?").run(id);

    db.exec("COMMIT");
    return { success: true, medicineId: id };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function deleteBatch(batchId) {
  const id = Number(batchId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid batch ID.");
  }

  const db = getDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    const batch = db.prepare(`
      SELECT b.id, b.medicine_id, b.batch_number, b.sync_id,
             m.sync_id AS medicine_sync_id
      FROM medicine_batches b
      JOIN medicines m ON m.id = b.medicine_id
      WHERE b.id = ?
    `).get(id);

    if (!batch) {
      throw new Error(
        "This batch was not found. Refresh the inventory and try again."
      );
    }

    enqueueSyncEvent(db, "DELETE", "MEDICINE_BATCH", batch.sync_id, {
      syncId: batch.sync_id,
      localId: id,
      medicineSyncId: batch.medicine_sync_id,
      medicineId: batch.medicine_id,
      batchNumber: batch.batch_number,
      deleted: true,
    });

    db.prepare(`
      DELETE FROM medicine_batches
      WHERE id = ?
    `).run(id);

    db.exec("COMMIT");

    return {
      success: true,
      batchId: id,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}
function getStockAlerts() {

  const db = getDatabase();



  return db.prepare(`

    SELECT

      m.id AS medicine_id,

      m.name,

      m.generic_name,

      m.manufacturer,

      m.minimum_stock,

      COALESCE(SUM(

        CASE

          WHEN b.expiry_date >= date('now', 'localtime')

          THEN b.quantity

          ELSE 0

        END

      ), 0) AS available_quantity

    FROM medicines m

    INNER JOIN medicine_batches b

      ON b.medicine_id = m.id

    GROUP BY m.id

    HAVING available_quantity <= m.minimum_stock

    ORDER BY available_quantity ASC, m.name COLLATE NOCASE

    LIMIT 500

  `).all();

}



function getExpiryAlerts() {

  const db = getDatabase();



  return db.prepare(`

    SELECT

      b.id AS batch_id,

      m.id AS medicine_id,

      m.name,

      m.generic_name,

      b.batch_number,

      b.quantity,

      b.expiry_date,

      CASE

        WHEN b.expiry_date < date('now', 'localtime')

          THEN 'expired'

        ELSE 'expiring_soon'

      END AS expiry_status,

      CAST(

        julianday(b.expiry_date) - julianday(date('now', 'localtime'))

        AS INTEGER

      ) AS days_until_expiry

    FROM medicine_batches b

    JOIN medicines m ON m.id = b.medicine_id

    WHERE b.expiry_date <= date('now', 'localtime', '+30 days')

    ORDER BY b.expiry_date ASC, m.name COLLATE NOCASE

    LIMIT 500

  `).all();

}



function getInventorySummary() {

  const db = getDatabase();



  const summary = db.prepare(`

    SELECT

      (SELECT COUNT(*) FROM medicines) AS total_medicines,



      (SELECT COUNT(*) FROM medicine_batches) AS total_batches,



      (SELECT COALESCE(SUM(quantity), 0)

       FROM medicine_batches

       WHERE expiry_date >= date('now', 'localtime'))

       AS available_units,



      (SELECT COALESCE(SUM(quantity), 0)

       FROM medicine_batches

       WHERE expiry_date < date('now', 'localtime'))

       AS expired_units,



      (SELECT COUNT(*)

       FROM medicine_batches

       WHERE expiry_date < date('now', 'localtime'))

       AS expired_batches

  `).get();



  return summary;

}





function getReports(input = {}) {

  const db = getDatabase();



  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  const startDate = input.startDate;

  const endDate = input.endDate;



  if (!datePattern.test(startDate || "") ||

      !datePattern.test(endDate || "")) {

    throw new Error("Select a valid report date range.");

  }



  if (startDate > endDate) {

    throw new Error("Start date cannot be after end date.");

  }



  const sales = db.prepare(`

    SELECT COUNT(*) AS invoice_count,

      COALESCE(SUM(total), 0) AS total_revenue,

      COALESCE(SUM(amount_paid), 0) AS amount_received,

      COALESCE(SUM(change_due), 0) AS change_returned

    FROM sales

    WHERE date(created_at, 'localtime') BETWEEN ? AND ?

  `).get(startDate, endDate);



  const profit = db.prepare(`

    SELECT COALESCE(SUM(si.quantity), 0) AS units_sold,

      COALESCE(SUM(si.line_total), 0) AS item_revenue,

      COALESCE(SUM(si.quantity * si.unit_cost), 0) AS cost_of_goods,

      COALESCE(SUM(si.line_total - si.quantity * si.unit_cost), 0)

        AS gross_profit

    FROM sale_items si

    JOIN sales s ON s.id = si.sale_id

    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ?

  `).get(startDate, endDate);



  const purchases = db.prepare(`

    SELECT COUNT(*) AS purchase_count,

      COALESCE(SUM(total), 0) AS total_purchases

    FROM purchases

    WHERE date(created_at, 'localtime') BETWEEN ? AND ?

  `).get(startDate, endDate);



  const topMedicines = db.prepare(`

    SELECT si.medicine_id, si.medicine_name,

      SUM(si.quantity) AS units_sold,

      SUM(si.line_total) AS revenue,

      SUM(si.line_total - si.quantity * si.unit_cost) AS gross_profit

    FROM sale_items si

    JOIN sales s ON s.id = si.sale_id

    WHERE date(s.created_at, 'localtime') BETWEEN ? AND ?

    GROUP BY si.medicine_id, si.medicine_name

    ORDER BY units_sold DESC, revenue DESC

    LIMIT 10

  `).all(startDate, endDate);



  const dailySales = db.prepare(`

    SELECT date(created_at, 'localtime') AS report_date,

      COUNT(*) AS invoice_count,

      COALESCE(SUM(total), 0) AS revenue

    FROM sales

    WHERE date(created_at, 'localtime') BETWEEN ? AND ?

    GROUP BY date(created_at, 'localtime')

    ORDER BY report_date

  `).all(startDate, endDate);



  return {

    startDate,

    endDate,

    sales,

    profit,

    purchases,

    topMedicines,

    dailySales,

    stockAlerts: getStockAlerts(),

    expiryAlerts: getExpiryAlerts(),

    inventory: getInventorySummary(),

  };

}



function closeDatabase() {

  if (database) {

    database.close();

    database = undefined;

  }

}

function deactivatePharmacyDatabase() {
  closeDatabase();
  activePharmacyId = null;
}





function createSale(input) {

  if (!input || typeof input !== "object" || Array.isArray(input)) {

    throw new Error("Invalid sale details.");

  }



  if (!Array.isArray(input.items) || input.items.length === 0) {

    throw new Error("Add at least one medicine to the bill.");

  }



  if (input.items.length > 100) {

    throw new Error("A sale cannot contain more than 100 line items.");

  }



  const paymentMethod = input.paymentMethod;

  const allowedMethods = ["cash", "card", "bank_transfer"];



  if (!allowedMethods.includes(paymentMethod)) {

    throw new Error("Choose a valid payment method.");

  }



  const amountPaid = validatePrice(input.amountPaid, "Amount paid");

  const seenBatches = new Set();

  const items = input.items.map((item) => {

    if (!item || typeof item !== "object") {

      throw new Error("Invalid medicine in the bill.");

    }



    const batchId = Number(item.batchId);

    const quantity = Number(item.quantity);



    if (!Number.isSafeInteger(batchId) || batchId <= 0) {

      throw new Error("Invalid medicine batch.");

    }



    if (!Number.isSafeInteger(quantity) || quantity <= 0) {

      throw new Error("Each sale quantity must be a positive whole number.");

    }



    if (seenBatches.has(batchId)) {

      throw new Error("A medicine batch appears more than once in the bill.");

    }



    seenBatches.add(batchId);

    return { batchId, quantity };

  });



  const db = getDatabase();

  const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;



  db.exec("BEGIN IMMEDIATE");



  try {

    const findBatch = db.prepare(`

      SELECT

        b.id AS batch_id,

                b.sync_id AS batch_sync_id,
        m.sync_id AS medicine_sync_id,
b.medicine_id,

        b.batch_number,

        b.purchase_price,

        b.sale_price,

        b.quantity AS available_quantity,

        b.expiry_date,

        CASE

          WHEN b.expiry_date < date('now', 'localtime') THEN 1

          ELSE 0

        END AS is_expired,

        m.name AS medicine_name

      FROM medicine_batches b

      JOIN medicines m ON m.id = b.medicine_id

      WHERE b.id = ?

    `);



    const preparedItems = items.map((item) => {

      const batch = findBatch.get(item.batchId);



      if (!batch) {

        throw new Error("A selected medicine batch no longer exists.");

      }



      if (Number(batch.is_expired) === 1) {

        throw new Error(`${batch.medicine_name} has expired and cannot be sold.`);

      }



      if (batch.available_quantity < item.quantity) {

        throw new Error(

          `Insufficient stock for ${batch.medicine_name}. Available: ${batch.available_quantity}.`

        );

      }



      const unitPrice = money(batch.sale_price);

      const unitCost = money(batch.purchase_price);

      const lineTotal = money(unitPrice * item.quantity);



      return {

        ...item,

        batch,

        unitPrice,

        unitCost,

        lineTotal,

      };

    });



    const subtotal = money(

      preparedItems.reduce((sum, item) => sum + item.lineTotal, 0)

    );

    const total = subtotal;



    if (amountPaid < total) {

      throw new Error("Amount paid cannot be less than the bill total.");

    }



    if (paymentMethod !== "cash" && amountPaid !== total) {

      throw new Error("For card or bank transfer, amount paid must equal the bill total.");

    }



    const changeDue = paymentMethod === "cash"

      ? money(amountPaid - total)

      : 0;



    const invoiceNumber =

      `PS-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;



    const saleSyncId = randomUUID();
    const saleResult = db.prepare(`
      INSERT INTO sales (
        invoice_number, subtotal, total, payment_method, amount_paid, change_due, sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceNumber, subtotal, total, paymentMethod, amountPaid, changeDue, saleSyncId
    );



    const saleId = Number(saleResult.lastInsertRowid);



    const insertItem = db.prepare(`

      INSERT INTO sale_items (
        sale_id, medicine_id, batch_id, medicine_name, batch_number,
        quantity, unit_price, unit_cost, line_total, sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    `);



    const updateStock = db.prepare(`

      UPDATE medicine_batches

      SET quantity = quantity - ?

      WHERE id = ? AND quantity >= ? AND expiry_date >= date('now', 'localtime')

    `);



    const syncLines = [];

    for (const item of preparedItems) {

      const stockUpdate = updateStock.run(

        item.quantity,

        item.batchId,

        item.quantity

      );



      if (Number(stockUpdate.changes) !== 1) {

        throw new Error(

          `Stock changed while processing ${item.batch.medicine_name}. Please try again.`

        );

      }



      const itemSyncId = randomUUID();
      insertItem.run(

        saleId,

        item.batch.medicine_id,

        item.batchId,

        item.batch.medicine_name,

        item.batch.batch_number,

        item.quantity,

        item.unitPrice,

        item.unitCost,

        item.lineTotal,
        itemSyncId
      );
      syncLines.push({
        syncId: itemSyncId,
        medicineSyncId: item.batch.medicine_sync_id,
        batchSyncId: item.batch.batch_sync_id,
        medicineName: item.batch.medicine_name,
        batchNumber: item.batch.batch_number,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unitCost: item.unitCost,
        lineTotal: item.lineTotal,
        stockDelta: -item.quantity,
      });

    }



    enqueueSyncEvent(db, "UPSERT", "SALE", saleSyncId, {
      syncId: saleSyncId,
      invoiceNumber,
      subtotal,
      total,
      paymentMethod,
      amountPaid,
      changeDue,
      items: syncLines,
    });

    db.exec("COMMIT");



    return {

      success: true,

      saleId,

      invoiceNumber,

      subtotal,

      total,

      paymentMethod,

      amountPaid,

      changeDue,

    };

  } catch (error) {

    try {

      db.exec("ROLLBACK");

    } catch {

      // Preserve the original sale error.

    }



    throw error;

  }

}





function createPurchase(input) {

  if (!input || typeof input !== "object" || Array.isArray(input)) {

    throw new Error("Invalid purchase details.");

  }



  const supplierName = validateText(input.supplierName, "Supplier name");

  const supplierInvoice = optionalText(

    input.supplierInvoice,

    "Supplier invoice",

    100

  );

  const notes = optionalText(input.notes, "Purchase notes", 1000);



  if (!Array.isArray(input.items) || input.items.length === 0) {

    throw new Error("Add at least one medicine to the purchase.");

  }



  if (input.items.length > 100) {

    throw new Error("A purchase cannot contain more than 100 line items.");

  }



  const seenItems = new Set();

  const items = input.items.map((item) => {

    if (!item || typeof item !== "object" || Array.isArray(item)) {

      throw new Error("Invalid medicine in the purchase.");

    }



    const medicineId = Number(item.medicineId);

    if (!Number.isSafeInteger(medicineId) || medicineId <= 0) {

      throw new Error("Select a valid medicine.");

    }



    const batchNumber = validateText(item.batchNumber, "Batch number", 100);

    const quantity = validateQuantity(item.quantity);



    if (quantity <= 0) {

      throw new Error("Purchase quantity must be greater than zero.");

    }



    const purchasePrice = validatePrice(item.purchasePrice, "Purchase price");

    const salePrice = validatePrice(item.salePrice, "Sale price");

    const expiryDate = validateExpiryDate(item.expiryDate);

    const key = `${medicineId}:${batchNumber.toLocaleLowerCase()}`;



    if (seenItems.has(key)) {

      throw new Error("The same medicine and batch appear more than once.");

    }

    seenItems.add(key);



    return {

      medicineId,

      batchNumber,

      quantity,

      purchasePrice,

      salePrice,

      expiryDate,

    };

  });



  const money = (value) =>

    Math.round((value + Number.EPSILON) * 100) / 100;

  const db = getDatabase();



  db.exec("BEGIN IMMEDIATE");



  try {

    const preparedItems = items.map((item) => {

      const medicine = db.prepare(`

        SELECT id, name, sync_id FROM medicines

        WHERE id = ?

      `).get(item.medicineId);



      if (!medicine) {

        throw new Error("A selected medicine no longer exists. Refresh and try again.");

      }



      const existingBatch = db.prepare(`

        SELECT id, expiry_date, quantity, sync_id FROM medicine_batches

        WHERE medicine_id = ? AND batch_number = ?

      `).get(item.medicineId, item.batchNumber);



      if (

        existingBatch &&

        existingBatch.expiry_date !== item.expiryDate

      ) {

        throw new Error(

          `Batch ${item.batchNumber} already exists with a different expiry date. Check the batch details.`

        );

      }



      return {

        ...item,

        medicineName: medicine.name,
        medicineSyncId: medicine.sync_id,
        existingBatch: existingBatch || null,

        lineTotal: money(item.purchasePrice * item.quantity),

      };

    });



    const total = money(

      preparedItems.reduce((sum, item) => sum + item.lineTotal, 0)

    );



    const invoiceNumber =

      `PS-PUR-${Date.now()}-${Math.floor(Math.random() * 1000)

        .toString()

        .padStart(3, "0")}`;



    const purchaseSyncId = randomUUID();

    const purchaseResult = db.prepare(`
      INSERT INTO purchases (
        invoice_number, supplier_name, supplier_invoice, total, notes, sync_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      invoiceNumber,
      supplierName,
      supplierInvoice,
      total,
      notes,
      purchaseSyncId
    );



    const purchaseId = Number(purchaseResult.lastInsertRowid);



    const insertBatch = db.prepare(`
      INSERT INTO medicine_batches (
        medicine_id, batch_number, purchase_price, sale_price,
        quantity, expiry_date, sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);



    const updateBatch = db.prepare(`

      UPDATE medicine_batches

      SET quantity = quantity + ?,

          purchase_price = ?,

          sale_price = ?

      WHERE id = ?

    `);



    const insertItem = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id, medicine_id, batch_id, medicine_name,
        batch_number, quantity, unit_cost, unit_sale_price, line_total, sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);



    const syncLines = [];

    for (const item of preparedItems) {
      let batchId;
      let batchSyncId;



      if (item.existingBatch) {

        const updated = updateBatch.run(

          item.quantity,

          item.purchasePrice,

          item.salePrice,

          item.existingBatch.id

        );



        if (Number(updated.changes) !== 1) {

          throw new Error(

            `Could not update stock for ${item.medicineName}. Please try again.`

          );

        }



        batchId = item.existingBatch.id;
        batchSyncId = item.existingBatch.sync_id;

      } else {

        batchSyncId = randomUUID();

        const inserted = insertBatch.run(
          item.medicineId,
          item.batchNumber,
          item.purchasePrice,
          item.salePrice,
          item.quantity,
          item.expiryDate,
          batchSyncId
        );



        batchId = Number(inserted.lastInsertRowid);

      }



      const batchSnapshot = db.prepare(`
        SELECT
          id,
          medicine_id,
          batch_number,
          purchase_price,
          sale_price,
          quantity,
          expiry_date,
          sync_id
        FROM medicine_batches
        WHERE id = ?
      `).get(batchId);

      if (!batchSnapshot) {
        throw new Error(
          `Could not read the updated batch for ${item.medicineName}.`
        );
      }

      enqueueSyncEvent(db, "UPSERT", "MEDICINE_BATCH", batchSyncId, {
        syncId: batchSnapshot.sync_id,
        localId: Number(batchSnapshot.id),
        medicineSyncId: item.medicineSyncId,
        batchNumber: batchSnapshot.batch_number,
        purchasePrice: Number(batchSnapshot.purchase_price),
        salePrice: Number(batchSnapshot.sale_price),
        quantity: Number(batchSnapshot.quantity),
        expiryDate: batchSnapshot.expiry_date,
      });

      const itemSyncId = randomUUID();

      insertItem.run(
        purchaseId,
        item.medicineId,
        batchId,
        item.medicineName,
        item.batchNumber,
        item.quantity,
        item.purchasePrice,
        item.salePrice,
        item.lineTotal,
        itemSyncId
      );

      syncLines.push({
        syncId: itemSyncId,
        medicineSyncId: item.medicineSyncId,
        batchSyncId,
        medicineName: item.medicineName,
        batchNumber: item.batchNumber,
        quantity: item.quantity,
        unitCost: item.purchasePrice,
        unitSalePrice: item.salePrice,
        lineTotal: item.lineTotal,
        stockDelta: item.quantity,
      });

    }



    enqueueSyncEvent(db, "UPSERT", "PURCHASE", purchaseSyncId, {
      syncId: purchaseSyncId,
      invoiceNumber,
      supplierName,
      supplierInvoice,
      total,
      notes,
      items: syncLines,
    });

    db.exec("COMMIT");



    return {

      success: true,

      purchaseId,

      invoiceNumber,

      total,

      itemCount: preparedItems.length,

    };

  } catch (error) {

    try {

      db.exec("ROLLBACK");

    } catch {

      // Preserve the original purchase error.

    }



    throw error;

  }

}



function listPurchases() {

  const db = getDatabase();



  return db.prepare(`

    SELECT

      p.id,

      p.invoice_number,

      p.supplier_name,

      p.supplier_invoice,

      p.total,

      p.notes,

      p.created_at,

      COUNT(pi.id) AS item_count,

      COALESCE(SUM(pi.quantity), 0) AS total_units

    FROM purchases p

    LEFT JOIN purchase_items pi ON pi.purchase_id = p.id

    GROUP BY p.id

    ORDER BY p.id DESC

    LIMIT 500

  `).all();

}




function enqueueInitialSyncSnapshot() {
  const db = getDatabase();

  db.exec("BEGIN IMMEDIATE");

  try {
    const counts = {
      medicines: 0,
      batches: 0,
      sales: 0,
      purchases: 0,
    };

    const snapshotMarker = db.prepare(`
      SELECT value FROM sync_metadata WHERE key = ?
    `).get("initial_snapshot_queued");

    if (snapshotMarker?.value === "true") {
      db.exec("COMMIT");
      return {
        success: true,
        alreadyQueued: true,
        queued: { medicines: 0, batches: 0, sales: 0, purchases: 0 },
        totalEvents: 0,
      };
    }

    const medicines = db.prepare(`
      SELECT id, sync_id, name, generic_name, manufacturer,
             category, barcode, minimum_stock
      FROM medicines ORDER BY id
    `).all();

    const batches = db.prepare(`
      SELECT b.id, b.sync_id, b.medicine_id, m.sync_id AS medicine_sync_id,
             b.batch_number, b.purchase_price, b.sale_price,
             b.quantity, b.expiry_date
      FROM medicine_batches b
      JOIN medicines m ON m.id = b.medicine_id
      ORDER BY b.id
    `).all();

    const sales = db.prepare(`
      SELECT id, sync_id, invoice_number, subtotal, total,
             payment_method, amount_paid, change_due
      FROM sales ORDER BY id
    `).all();

    const saleItems = db.prepare(`
      SELECT si.id, si.sync_id, si.sale_id, si.medicine_id, si.batch_id,
             si.medicine_name, si.batch_number, si.quantity,
             si.unit_price, si.unit_cost, si.line_total,
             m.sync_id AS medicine_sync_id,
             b.sync_id AS batch_sync_id
      FROM sale_items si
      JOIN medicines m ON m.id = si.medicine_id
      JOIN medicine_batches b ON b.id = si.batch_id
      ORDER BY si.id
    `).all();

    const purchases = db.prepare(`
      SELECT id, sync_id, invoice_number, supplier_name,
             supplier_invoice, total, notes
      FROM purchases ORDER BY id
    `).all();

    const purchaseItems = db.prepare(`
      SELECT pi.id, pi.sync_id, pi.purchase_id, pi.medicine_id, pi.batch_id,
             pi.medicine_name, pi.batch_number, pi.quantity,
             pi.unit_cost, pi.unit_sale_price, pi.line_total,
             m.sync_id AS medicine_sync_id,
             b.sync_id AS batch_sync_id
      FROM purchase_items pi
      JOIN medicines m ON m.id = pi.medicine_id
      JOIN medicine_batches b ON b.id = pi.batch_id
      ORDER BY pi.id
    `).all();

    const saleItemsBySale = new Map();
    for (const item of saleItems) {
      if (!saleItemsBySale.has(item.sale_id)) {
        saleItemsBySale.set(item.sale_id, []);
      }
      saleItemsBySale.get(item.sale_id).push({
        syncId: item.sync_id,
        medicineSyncId: item.medicine_sync_id,
        batchSyncId: item.batch_sync_id,
        medicineName: item.medicine_name,
        batchNumber: item.batch_number,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        unitCost: Number(item.unit_cost),
        lineTotal: Number(item.line_total),
        stockDelta: -Number(item.quantity),
      });
    }

    const purchaseItemsByPurchase = new Map();
    for (const item of purchaseItems) {
      if (!purchaseItemsByPurchase.has(item.purchase_id)) {
        purchaseItemsByPurchase.set(item.purchase_id, []);
      }
      purchaseItemsByPurchase.get(item.purchase_id).push({
        syncId: item.sync_id,
        medicineSyncId: item.medicine_sync_id,
        batchSyncId: item.batch_sync_id,
        medicineName: item.medicine_name,
        batchNumber: item.batch_number,
        quantity: Number(item.quantity),
        unitCost: Number(item.unit_cost),
        unitSalePrice: Number(item.unit_sale_price),
        lineTotal: Number(item.line_total),
        stockDelta: Number(item.quantity),
      });
    }

    for (const medicine of medicines) {
      enqueueSyncEvent(db, "UPSERT", "MEDICINE", medicine.sync_id, {
        syncId: medicine.sync_id,
        localId: Number(medicine.id),
        name: medicine.name,
        genericName: medicine.generic_name,
        manufacturer: medicine.manufacturer,
        category: medicine.category,
        barcode: medicine.barcode,
        minimumStock: Number(medicine.minimum_stock),
      });
      counts.medicines++;
    }

    for (const batch of batches) {
      enqueueSyncEvent(db, "UPSERT", "MEDICINE_BATCH", batch.sync_id, {
        syncId: batch.sync_id,
        localId: Number(batch.id),
        medicineSyncId: batch.medicine_sync_id,
        batchNumber: batch.batch_number,
        purchasePrice: Number(batch.purchase_price),
        salePrice: Number(batch.sale_price),
        quantity: Number(batch.quantity),
        expiryDate: batch.expiry_date,
        snapshot: true,
      });
      counts.batches++;
    }

    for (const sale of sales) {
      enqueueSyncEvent(db, "UPSERT", "SALE", sale.sync_id, {
        syncId: sale.sync_id,
        invoiceNumber: sale.invoice_number,
        subtotal: Number(sale.subtotal),
        total: Number(sale.total),
        paymentMethod: sale.payment_method,
        amountPaid: Number(sale.amount_paid),
        changeDue: Number(sale.change_due),
        items: saleItemsBySale.get(sale.id) || [],
        snapshot: true,
      });
      counts.sales++;
    }

    for (const purchase of purchases) {
      enqueueSyncEvent(db, "UPSERT", "PURCHASE", purchase.sync_id, {
        syncId: purchase.sync_id,
        invoiceNumber: purchase.invoice_number,
        supplierName: purchase.supplier_name,
        supplierInvoice: purchase.supplier_invoice,
        total: Number(purchase.total),
        notes: purchase.notes,
        items: purchaseItemsByPurchase.get(purchase.id) || [],
        snapshot: true,
      });
      counts.purchases++;
    }

    db.prepare(`
      INSERT INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run("initial_snapshot_queued", "true");

    db.exec("COMMIT");

    return {
      success: true,
      alreadyQueued: false,
      queued: counts,
      totalEvents:
        counts.medicines + counts.batches + counts.sales + counts.purchases,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}


// --------------------------------------------------
// RESTORE CLOUD DATA INTO THE ACTIVE PHARMACY DATABASE
// --------------------------------------------------

function restoreCloudData(data) {
  const db = getDatabase();

  if (!data || typeof data !== "object") {
    throw new Error("Invalid cloud restore data.");
  }

  const medicines = Array.isArray(data.medicines) ? data.medicines : [];
  const batches = Array.isArray(data.batches) ? data.batches : [];
  const sales = Array.isArray(data.sales) ? data.sales : [];
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];

  const medicineIds = new Map();
  const batchIds = new Map();

  const dateValue = (value) => {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Cloud data contains an invalid date.");
    }
    return date.toISOString();
  };

  const requiredSyncId = (row, entity) => {
    const value = row.localId || row.syncId;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${entity} is missing its synchronization ID.`);
    }
    return value.trim();
  };

  let imported = {
    medicines: 0,
    batches: 0,
    sales: 0,
    purchases: 0,
  };

  db.exec("BEGIN IMMEDIATE");

  try {
    const findMedicine = db.prepare(
      "SELECT id FROM medicines WHERE sync_id = ?"
    );
    const insertMedicine = db.prepare(`
      INSERT OR IGNORE INTO medicines
      (name, generic_name, manufacturer, category, barcode,
       minimum_stock, created_at, updated_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of medicines) {
      const syncId = requiredSyncId(row, "Medicine");
      let local = findMedicine.get(syncId);

      if (!local) {
        insertMedicine.run(
          row.name,
          row.genericName || "",
          row.manufacturer || "",
          row.category || "",
          row.barcode || "",
          Number(row.minimumStock ?? 10),
          dateValue(row.createdAt),
          dateValue(row.updatedAt || row.createdAt),
          syncId
        );
        local = findMedicine.get(syncId);
        if (!local) {
          throw new Error(
            `Could not restore medicine "${row.name}". A conflicting record may exist.`
          );
        }
        imported.medicines++;
      }

      medicineIds.set(row.id, Number(local.id));
    }

    const findBatch = db.prepare(
      "SELECT id FROM medicine_batches WHERE sync_id = ?"
    );
    const insertBatch = db.prepare(`
      INSERT OR IGNORE INTO medicine_batches
      (medicine_id, batch_number, purchase_price, sale_price,
       quantity, expiry_date, created_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of batches) {
      const syncId = requiredSyncId(row, "Medicine batch");
      const medicineId = medicineIds.get(row.medicineId);

      if (!medicineId) {
        throw new Error(
          `Medicine reference missing for batch "${row.batchNumber}".`
        );
      }

      let local = findBatch.get(syncId);

      if (!local) {
        insertBatch.run(
          medicineId,
          row.batchNumber,
          Number(row.purchasePrice || 0),
          Number(row.salePrice || 0),
          Number(row.quantity || 0),
          dateValue(row.expiryDate),
          dateValue(row.createdAt),
          syncId
        );
        local = findBatch.get(syncId);
        if (!local) {
          throw new Error(
            `Could not restore batch "${row.batchNumber}". A conflicting record may exist.`
          );
        }
        imported.batches++;
      }

      batchIds.set(row.id, Number(local.id));
    }

    const findSale = db.prepare(
      "SELECT id FROM sales WHERE sync_id = ?"
    );
    const insertSale = db.prepare(`
      INSERT OR IGNORE INTO sales
      (invoice_number, subtotal, total, payment_method,
       amount_paid, change_due, created_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSaleItem = db.prepare(`
      INSERT INTO sale_items
      (sale_id, medicine_id, batch_id, medicine_name, batch_number,
       quantity, unit_price, unit_cost, line_total, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of sales) {
      const syncId = requiredSyncId(row, "Sale");
      let local = findSale.get(syncId);

      if (!local) {
        insertSale.run(
          row.invoiceNumber,
          Number(row.subtotal || 0),
          Number(row.total || 0),
          row.paymentMethod || "Cash",
          Number(row.amountPaid || 0),
          Number(row.changeDue || 0),
          dateValue(row.createdAt),
          syncId
        );
        local = findSale.get(syncId);

        if (!local) {
          throw new Error(
            `Could not restore sale "${row.invoiceNumber}". A conflicting invoice may exist.`
          );
        }

        for (const item of row.items || []) {
          const medicineId = medicineIds.get(item.medicineId);
          const batchId = batchIds.get(item.batchId);

          if (!medicineId || !batchId) {
            throw new Error(
              `Medicine or batch reference missing in sale "${row.invoiceNumber}".`
            );
          }

          insertSaleItem.run(
            local.id,
            medicineId,
            batchId,
            item.medicineName,
            item.batchNumber,
            Number(item.quantity),
            Number(item.unitPrice),
            Number(item.unitCost),
            Number(item.lineTotal),
            randomUUID()
          );
        }

        imported.sales++;
      }
    }

    const findPurchase = db.prepare(
      "SELECT id FROM purchases WHERE sync_id = ?"
    );
    const insertPurchase = db.prepare(`
      INSERT OR IGNORE INTO purchases
      (invoice_number, supplier_name, supplier_invoice,
       total, notes, created_at, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPurchaseItem = db.prepare(`
      INSERT INTO purchase_items
      (purchase_id, medicine_id, batch_id, medicine_name,
       batch_number, quantity, unit_cost, unit_sale_price,
       line_total, sync_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of purchases) {
      const syncId = requiredSyncId(row, "Purchase");
      let local = findPurchase.get(syncId);

      if (!local) {
        insertPurchase.run(
          row.invoiceNumber,
          row.supplierName || "",
          row.supplierInvoice || "",
          Number(row.total || 0),
          row.notes || "",
          dateValue(row.createdAt),
          syncId
        );
        local = findPurchase.get(syncId);

        if (!local) {
          throw new Error(
            `Could not restore purchase "${row.invoiceNumber}". A conflicting invoice may exist.`
          );
        }

        for (const item of row.items || []) {
          const medicineId = medicineIds.get(item.medicineId);
          const batchId = batchIds.get(item.batchId);

          if (!medicineId || !batchId) {
            throw new Error(
              `Medicine or batch reference missing in purchase "${row.invoiceNumber}".`
            );
          }

          insertPurchaseItem.run(
            local.id,
            medicineId,
            batchId,
            item.medicineName,
            item.batchNumber,
            Number(item.quantity),
            Number(item.unitCost),
            Number(item.unitSalePrice),
            Number(item.lineTotal),
            randomUUID()
          );
        }

        imported.purchases++;
      }
    }

    // Restored rows must not be queued as a fresh initial snapshot.
    db.prepare(`
      INSERT INTO sync_metadata (key, value, updated_at)
      VALUES ('initial_snapshot_queued', 'true', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = 'true',
        updated_at = CURRENT_TIMESTAMP
    `).run();

    db.exec("COMMIT");

    return {
      success: true,
      imported,
      totalRecords:
        imported.medicines +
        imported.batches +
        imported.sales +
        imported.purchases,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}


module.exports = {

  activatePharmacyDatabase,
  deactivatePharmacyDatabase,
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

  closeDatabase,

};



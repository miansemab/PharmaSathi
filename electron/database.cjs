
const { app } = require("electron");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

let database;

function getDatabase() {
  if (database) return database;

  const dataDirectory = path.join(app.getPath("userData"), "data");
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

    console.log("PharmaSathi database initialized:", databasePath);
    return database;
  } catch (error) {
    database.close();
    database = undefined;
    throw error;
  }
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
      b.batch_number,
      b.purchase_price,
      b.sale_price,
      b.quantity,
      b.expiry_date,
      b.created_at
    FROM medicine_batches b
    JOIN medicines m ON m.id = b.medicine_id
    WHERE
      @empty = 1
      OR m.name LIKE @pattern ESCAPE '\\'
      OR m.generic_name LIKE @pattern ESCAPE '\\'
      OR m.manufacturer LIKE @pattern ESCAPE '\\'
      OR m.barcode LIKE @pattern ESCAPE '\\'
      OR b.batch_number LIKE @pattern ESCAPE '\\'
    ORDER BY m.name COLLATE NOCASE, b.expiry_date ASC
    LIMIT 500
  `).all({
    empty: term ? 0 : 1,
    pattern,
  });
}

function addMedicine(input) {
  const medicineData = validateMedicineInput(input);
  const db = getDatabase();

  try {
    db.exec("BEGIN IMMEDIATE");

    let medicine = db.prepare(`
      SELECT id
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

    if (medicine) {
      medicineId = medicine.id;

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
      const result = db.prepare(`
        INSERT INTO medicines
          (name, generic_name, manufacturer, category, barcode, minimum_stock)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        medicineData.name,
        medicineData.genericName,
        medicineData.manufacturer,
        medicineData.category,
        medicineData.barcode,
        medicineData.minimumStock
      );

      medicineId = Number(result.lastInsertRowid);
    }

    const batchResult = db.prepare(`
      INSERT INTO medicine_batches
        (medicine_id, batch_number, purchase_price, sale_price, quantity, expiry_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      medicineId,
      medicineData.batchNumber,
      medicineData.purchasePrice,
      medicineData.salePrice,
      medicineData.quantity,
      medicineData.expiryDate
    );

    db.exec("COMMIT");

    return {
      success: true,
      medicineId,
      batchId: Number(batchResult.lastInsertRowid),
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Transaction may already have been rolled back.
    }

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
      SELECT id, medicine_id
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

function deleteBatch(batchId) {
  const id = Number(batchId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid batch ID.");
  }

  const db = getDatabase();

  const result = db.prepare(`
    DELETE FROM medicine_batches
    WHERE id = ?
  `).run(id);

  if (result.changes === 0) {
    throw new Error(
      "This batch was not found. Refresh the inventory and try again."
    );
  }

  return {
    success: true,
    batchId: id,
  };
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
    LEFT JOIN medicine_batches b ON b.medicine_id = m.id
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

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

module.exports = {
  getDatabase,
  listBatches,
  addMedicine,
  updateBatch,
  deleteBatch,
  getStockAlerts,
  getExpiryAlerts,
  closeDatabase,
};

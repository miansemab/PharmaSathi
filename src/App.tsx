
import { useEffect, useMemo, useState } from "react";
import "./App.css";

type NavigationItem =
  | "Dashboard"
  | "Medicines"
  | "Billing"
  | "Purchases"
  | "Reports";

type DatabaseStatus = {
  success: boolean;
  message: string;
};

const navigation: { label: NavigationItem; icon: string }[] = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Medicines", icon: "▤" },
  { label: "Billing", icon: "▧" },
  { label: "Purchases", icon: "⇩" },
  { label: "Reports", icon: "▥" },
];

const emptyMedicineForm = {
  name: "",
  genericName: "",
  manufacturer: "",
  category: "",
  barcode: "",
  batchNumber: "",
  purchasePrice: "",
  salePrice: "",
  quantity: "",
  expiryDate: "",
  minimumStock: "10",
};

type MedicineForm = typeof emptyMedicineForm;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  }).format(value);
}

function App() {
  const [activePage, setActivePage] =
    useState<NavigationItem>("Dashboard");

  const [databaseStatus, setDatabaseStatus] =
    useState<DatabaseStatus | null>(null);
  const [checkingDatabase, setCheckingDatabase] = useState(true);

  const [medicines, setMedicines] = useState<MedicineBatch[]>([]);
  const [search, setSearch] = useState("");
  const [loadingMedicines, setLoadingMedicines] = useState(false);
  const [showMedicineForm, setShowMedicineForm] = useState(false);
  const [editingBatchId, setEditingBatchId] = useState<number | null>(null);
  const [form, setForm] = useState<MedicineForm>(emptyMedicineForm);
  const [savingMedicine, setSavingMedicine] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<number | null>(null);
  const [medicineMessage, setMedicineMessage] = useState("");
  const [medicineError, setMedicineError] = useState(false);

  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertError, setAlertError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function checkDatabase() {
      try {
        const result = await window.pharmaSathi.getDatabaseStatus();
        if (isMounted) setDatabaseStatus(result);
      } catch (error) {
        console.error("Could not check database:", error);
        if (isMounted) {
          setDatabaseStatus({
            success: false,
            message: "Unable to connect to the local database.",
          });
        }
      } finally {
        if (isMounted) setCheckingDatabase(false);
      }
    }

    void checkDatabase();

    return () => {
      isMounted = false;
    };
  }, []);

  async function loadMedicines(searchTerm = search) {
    setLoadingMedicines(true);

    try {
      const result = await window.pharmaSathi.listMedicines(searchTerm);

      if (!result.success) {
        throw new Error(result.message || "Could not load medicines.");
      }

      setMedicines(result.data);
    } catch (error) {
      console.error("Could not load medicines:", error);
      setMedicineError(true);
      setMedicineMessage(
        error instanceof Error ? error.message : "Could not load medicines.",
      );
    } finally {
      setLoadingMedicines(false);
    }
  }

  async function loadAlerts() {
    setLoadingAlerts(true);
    setAlertError("");

    try {
      const [stockResult, expiryResult] = await Promise.all([
        window.pharmaSathi.getStockAlerts(),
        window.pharmaSathi.getExpiryAlerts(),
      ]);

      if (!stockResult.success) {
        throw new Error(stockResult.message || "Could not load stock alerts.");
      }

      if (!expiryResult.success) {
        throw new Error(expiryResult.message || "Could not load expiry alerts.");
      }

      setStockAlerts(stockResult.data);
      setExpiryAlerts(expiryResult.data);
    } catch (error) {
      console.error("Could not load inventory alerts:", error);
      setAlertError(
        error instanceof Error
          ? error.message
          : "Could not load inventory alerts.",
      );
    } finally {
      setLoadingAlerts(false);
    }
  }

  useEffect(() => {
    if (activePage === "Medicines") {
      void loadMedicines();
    }

    if (activePage === "Dashboard" || activePage === "Medicines") {
      void loadAlerts();
    }

    // Refresh data when the user opens either page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "Medicines") return;

    const timeoutId = window.setTimeout(() => {
      void loadMedicines(search);
    }, 250);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activePage]);

  const databaseConnected = databaseStatus?.success === true;

  const totalUnits = useMemo(
    () => medicines.reduce((total, medicine) => total + medicine.quantity, 0),
    [medicines],
  );

  const today = new Date().toISOString().slice(0, 10);

  const expiredBatchCount = useMemo(
    () => expiryAlerts.filter((item) => item.expiry_status === "expired").length,
    [expiryAlerts],
  );

  const expiringSoonCount = useMemo(
    () =>
      expiryAlerts.filter((item) => item.expiry_status === "expiring_soon")
        .length,
    [expiryAlerts],
  );

  function clearMedicineForm() {
    setForm(emptyMedicineForm);
    setEditingBatchId(null);
    setShowMedicineForm(false);
  }

  function startEditingMedicine(medicine: MedicineBatch) {
    setMedicineMessage("");
    setMedicineError(false);

    setForm({
      name: medicine.name,
      genericName: medicine.generic_name,
      manufacturer: medicine.manufacturer,
      category: medicine.category,
      barcode: medicine.barcode,
      batchNumber: medicine.batch_number,
      purchasePrice: String(medicine.purchase_price),
      salePrice: String(medicine.sale_price),
      quantity: String(medicine.quantity),
      expiryDate: medicine.expiry_date,
      minimumStock: String(medicine.minimum_stock ?? 10),
    });

    setEditingBatchId(medicine.batch_id);
    setShowMedicineForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSaveMedicine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSavingMedicine(true);
    setMedicineMessage("");
    setMedicineError(false);

    try {
      const result =
        editingBatchId === null
          ? await window.pharmaSathi.addMedicine(form)
          : await window.pharmaSathi.updateMedicineBatch(editingBatchId, form);

      if (!result.success) {
        throw new Error(
          result.message ||
            (editingBatchId === null
              ? "Could not save medicine."
              : "Could not update medicine."),
        );
      }

      const wasEditing = editingBatchId !== null;

      clearMedicineForm();
      setMedicineError(false);
      setMedicineMessage(
        wasEditing
          ? "Medicine batch updated successfully."
          : "Medicine batch saved successfully.",
      );

      await Promise.all([loadMedicines(search), loadAlerts()]);
    } catch (error) {
      console.error("Could not save medicine:", error);
      setMedicineError(true);
      setMedicineMessage(
        error instanceof Error ? error.message : "Could not save medicine.",
      );
    } finally {
      setSavingMedicine(false);
    }
  }

  async function handleDeleteMedicine(medicine: MedicineBatch) {
    const confirmed = window.confirm(
      `Delete batch "${medicine.batch_number}" of "${medicine.name}"?\n\nOnly this batch will be deleted. This action cannot be undone.`,
    );

    if (!confirmed) return;

    setDeletingBatchId(medicine.batch_id);
    setMedicineMessage("");
    setMedicineError(false);

    try {
      const result = await window.pharmaSathi.deleteMedicineBatch(
        medicine.batch_id,
      );

      if (!result.success) {
        throw new Error(result.message || "Could not delete this batch.");
      }

      if (editingBatchId === medicine.batch_id) {
        clearMedicineForm();
      }

      setMedicineMessage("Medicine batch deleted successfully.");
      await Promise.all([loadMedicines(search), loadAlerts()]);
    } catch (error) {
      console.error("Could not delete medicine batch:", error);
      setMedicineError(true);
      setMedicineMessage(
        error instanceof Error
          ? error.message
          : "Could not delete this batch.",
      );
    } finally {
      setDeletingBatchId(null);
    }
  }

  function updateForm(field: keyof MedicineForm, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function openNewMedicineForm() {
    setMedicineMessage("");
    setMedicineError(false);
    setForm(emptyMedicineForm);
    setEditingBatchId(null);
    setShowMedicineForm(true);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">P+</div>
          <div>
            <h1>PharmaSathi</h1>
            <p>PHARMACY MANAGEMENT</p>
          </div>
        </div>

        <div className="menu-label">WORKSPACE</div>

        <nav className="navigation">
          {navigation.map((item) => (
            <button
              key={item.label}
              className={`nav-item ${activePage === item.label ? "active" : ""}`}
              onClick={() => setActivePage(item.label)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.label === "Billing" && (
                <span className="nav-shortcut">POS</span>
              )}
              {item.label === "Medicines" && stockAlerts.length > 0 && (
                <span className="nav-shortcut">{stockAlerts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div
            className="connection-dot"
            style={{
              background: checkingDatabase
                ? "#d9a441"
                : databaseConnected
                  ? "#138567"
                  : "#dc5656",
            }}
          />
          <div>
            <strong>Desktop mode</strong>
            <p>
              {checkingDatabase
                ? "Checking database..."
                : databaseConnected
                  ? "Database connected"
                  : "Database disconnected"}
            </p>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            PharmaSathi <span>/</span> {activePage}
          </div>

          <div className="topbar-right">
            <span className="offline-badge">
              <span
                className="connection-dot"
                style={{
                  background: databaseConnected ? "#138567" : "#d9a441",
                }}
              />
              Local database{" "}
              {checkingDatabase
                ? "checking"
                : databaseConnected
                  ? "connected"
                  : "unavailable"}
            </span>
            <div className="avatar">PS</div>
          </div>
        </header>

        <section className="page-content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">PHARMACY WORKSPACE</p>
              <h2>
                {activePage === "Dashboard"
                  ? "Good day, Pharmacy Owner"
                  : activePage === "Medicines"
                    ? "Medicine inventory"
                    : activePage}
              </h2>
              <p className="subtitle">
                {activePage === "Dashboard"
                  ? "Your pharmacy operations, together in one place."
                  : activePage === "Medicines"
                    ? "Manage medicine details, batch stock, prices and expiry dates."
                    : `Your ${activePage.toLowerCase()} workspace is ready for development.`}
              </p>
            </div>

            <div className="date-chip">
              {new Date().toLocaleDateString("en-PK", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </div>
          </div>

          {activePage === "Dashboard" ? (
            <>
              <div className="notice">
                <span className="notice-icon">✦</span>
                <div>
                  <strong>
                    {databaseConnected
                      ? "Local database is connected"
                      : checkingDatabase
                        ? "Checking local database"
                        : "Database connection needs attention"}
                  </strong>
                  <p>
                    {databaseConnected
                      ? "The desktop app can communicate with its local SQLite database."
                      : checkingDatabase
                        ? "Please wait while PharmaSathi checks the database."
                        : databaseStatus?.message ??
                          "The database status is not available."}
                  </p>
                </div>
              </div>

              <div className="section-heading">
                <div>
                  <h3>Business overview</h3>
                  <p>Live stock and expiry alerts from your local database.</p>
                </div>
                <span className="demo-label">LOCAL DATABASE</span>
              </div>

              <div className="stats-grid">
                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon blue">▤</span>
                    <span className="stat-caption">INVENTORY</span>
                  </div>
                  <p className="stat-value">{medicines.length}</p>
                  <h4>Loaded batches</h4>
                  <p className="stat-foot">Open Medicines to view inventory</p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon green">₨</span>
                    <span className="stat-caption">SALES</span>
                  </div>
                  <p className="stat-value">₨ 0</p>
                  <h4>Today's sales</h4>
                  <p className="stat-foot">Billing feature not connected</p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon orange">◷</span>
                    <span className="stat-caption">EXPIRY</span>
                  </div>
                  <p className="stat-value">{expiringSoonCount}</p>
                  <h4>Expiring within 30 days</h4>
                  <p className="stat-foot">
                    {expiredBatchCount} already-expired batch(es)
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon purple">!</span>
                    <span className="stat-caption">LOW STOCK</span>
                  </div>
                  <p className="stat-value">{stockAlerts.length}</p>
                  <h4>Low-stock medicines</h4>
                  <p className="stat-foot">At or below minimum stock level</p>
                </article>
              </div>

              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Quick actions</h3>
                      <p>Frequently used pharmacy tasks</p>
                    </div>
                  </div>

                  <div className="quick-actions">
                    <button className="quick-action" onClick={() => setActivePage("Billing")}>
                      <span className="action-icon green">＋</span>
                      <span>
                        <strong>New sale</strong>
                        <small>Open billing workspace</small>
                      </span>
                      <span className="action-arrow">→</span>
                    </button>

                    <button className="quick-action" onClick={() => setActivePage("Medicines")}>
                      <span className="action-icon blue">▤</span>
                      <span>
                        <strong>Medicine stock</strong>
                        <small>Open inventory workspace</small>
                      </span>
                      <span className="action-arrow">→</span>
                    </button>

                    <button className="quick-action" onClick={() => setActivePage("Purchases")}>
                      <span className="action-icon orange">⇩</span>
                      <span>
                        <strong>Record purchase</strong>
                        <small>Open purchasing workspace</small>
                      </span>
                      <span className="action-arrow">→</span>
                    </button>
                  </div>
                </section>

                <section className="panel system-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>System status</h3>
                      <p>Local desktop environment</p>
                    </div>
                    <span
                      className="status-indicator"
                      style={{ color: databaseConnected ? "#138567" : "#d9a441" }}
                    >
                      ●
                    </span>
                  </div>

                  <div className="system-row">
                    <span>Desktop interface</span>
                    <strong>Running</strong>
                  </div>
                  <div className="system-row">
                    <span>SQLite database</span>
                    <strong className={databaseConnected ? "" : "muted-status"}>
                      {checkingDatabase ? "Checking..." : databaseConnected ? "Connected" : "Not connected"}
                    </strong>
                  </div>
                  <div className="system-row">
                    <span>Cloud synchronization</span>
                    <strong className="muted-status">Not configured</strong>
                  </div>

                  <div className="system-note">
                    <span>ⓘ</span>
                    <p>Medicine inventory is stored locally. Sales and cloud sync are not implemented yet.</p>
                  </div>
                </section>
              </div>

              <section className="panel alerts-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Inventory alerts</h3>
                    <p>Review low stock, expiring batches and expired medicines.</p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void loadAlerts()}
                    disabled={loadingAlerts}
                  >
                    {loadingAlerts ? "Refreshing..." : "↻ Refresh alerts"}
                  </button>
                </div>

                {alertError && (
                  <div className="medicine-message error">{alertError}</div>
                )}

                {loadingAlerts && stockAlerts.length === 0 && expiryAlerts.length === 0 ? (
                  <p className="alert-empty">Loading inventory alerts...</p>
                ) : stockAlerts.length === 0 && expiryAlerts.length === 0 ? (
                  <div className="alert-empty">
                    <span className="alert-empty-icon">✓</span>
                    <strong>No stock or expiry alerts</strong>
                    <p>No matching issues were returned by the local database.</p>
                  </div>
                ) : (
                  <div className="alerts-grid">
                    <div className="alert-group">
                      <div className="alert-group-heading">
                        <span className="alert-marker warning" />
                        <h4>Low stock</h4>
                        <span className="alert-count">{stockAlerts.length}</span>
                      </div>

                      {stockAlerts.length === 0 ? (
                        <p className="alert-empty compact">No low-stock medicines.</p>
                      ) : (
                        <div className="alert-list">
                          {stockAlerts.map((item) => (
                            <div className="alert-item" key={item.medicine_id}>
                              <div>
                                <strong>{item.name}</strong>
                                <small>
                                  Minimum: {item.minimum_stock} units
                                </small>
                              </div>
                              <span className="alert-value warning-text">
                                {item.available_quantity} left
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="alert-group">
                      <div className="alert-group-heading">
                        <span className="alert-marker danger" />
                        <h4>Expiry alerts</h4>
                        <span className="alert-count">
                          {expiryAlerts.length}
                        </span>
                      </div>

                      {expiryAlerts.length === 0 ? (
                        <p className="alert-empty compact">No expiry alerts.</p>
                      ) : (
                        <div className="alert-list">
                          {expiryAlerts.map((item) => (
                            <div className="alert-item" key={item.batch_id}>
                              <div>
                                <strong>{item.name}</strong>
                                <small>
                                  Batch {item.batch_number || "—"} · {item.expiry_date}
                                </small>
                              </div>
                              <span
                                className={`alert-status ${
                                  item.expiry_status === "expired"
                                    ? "expired"
                                    : "expiring"
                                }`}
                              >
                                {item.expiry_status === "expired"
                                  ? "Expired"
                                  : item.days_until_expiry === 0
                                    ? "Expires today"
                                    : `${item.days_until_expiry} day(s)`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : activePage === "Medicines" ? (
            <>
              <div className="inventory-summary">
                <div className="inventory-summary-card">
                  <span className="summary-icon blue">▤</span>
                  <div>
                    <p>Medicine batches</p>
                    <strong>{medicines.length}</strong>
                  </div>
                </div>
                <div className="inventory-summary-card">
                  <span className="summary-icon green">▦</span>
                  <div>
                    <p>Total units in loaded results</p>
                    <strong>{totalUnits.toLocaleString("en-PK")}</strong>
                  </div>
                </div>
                <div className="inventory-summary-card">
                  <span className="summary-icon orange">◷</span>
                  <div>
                    <p>Expiry alerts · 30 days</p>
                    <strong>{expiryAlerts.length}</strong>
                  </div>
                </div>
              </div>

              <section className="panel inventory-panel">
                <div className="inventory-toolbar">
                  <div>
                    <h3>Inventory</h3>
                    <p>Search and manage saved medicine batches.</p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => {
                      if (showMedicineForm) {
                        clearMedicineForm();
                      } else {
                        openNewMedicineForm();
                      }
                    }}
                  >
                    {showMedicineForm ? "Cancel" : "+ Add medicine"}
                  </button>
                </div>

                {medicineMessage && (
                  <div className={`medicine-message ${medicineError ? "error" : "success"}`}>
                    {medicineMessage}
                  </div>
                )}

                {showMedicineForm && (
                  <form className="medicine-form" onSubmit={handleSaveMedicine}>
                    <div className="form-heading">
                      <div>
                        <h4>
                          {editingBatchId === null
                            ? "Add medicine batch"
                            : "Edit medicine batch"}
                        </h4>
                        <p>
                          {editingBatchId === null
                            ? "Enter the product and batch details from the package."
                            : "Update the selected batch details, then save your changes."}
                        </p>
                      </div>
                    </div>

                    <div className="form-grid">
                      <label>
                        Medicine name *
                        <input
                          value={form.name}
                          onChange={(event) => updateForm("name", event.target.value)}
                          required
                          maxLength={150}
                          placeholder="e.g. Paracetamol"
                        />
                      </label>

                      <label>
                        Generic name
                        <input
                          value={form.genericName}
                          onChange={(event) => updateForm("genericName", event.target.value)}
                          maxLength={150}
                          placeholder="e.g. Paracetamol"
                        />
                      </label>

                      <label>
                        Manufacturer
                        <input
                          value={form.manufacturer}
                          onChange={(event) => updateForm("manufacturer", event.target.value)}
                          maxLength={150}
                          placeholder="Manufacturer name"
                        />
                      </label>

                      <label>
                        Category
                        <input
                          value={form.category}
                          onChange={(event) => updateForm("category", event.target.value)}
                          maxLength={150}
                          placeholder="e.g. Tablet, Syrup"
                        />
                      </label>

                      <label>
                        Barcode
                        <input
                          value={form.barcode}
                          onChange={(event) => updateForm("barcode", event.target.value)}
                          maxLength={100}
                          placeholder="Optional barcode"
                        />
                      </label>

                      <label>
                        Batch number *
                        <input
                          value={form.batchNumber}
                          onChange={(event) => updateForm("batchNumber", event.target.value)}
                          required
                          maxLength={100}
                          placeholder="Printed batch number"
                        />
                      </label>

                      <label>
                        Purchase price (PKR) *
                        <input
                          type="number"
                          min="0"
                          max="100000000"
                          step="0.01"
                          value={form.purchasePrice}
                          onChange={(event) => updateForm("purchasePrice", event.target.value)}
                          required
                          placeholder="0.00"
                        />
                      </label>

                      <label>
                        Sale price (PKR) *
                        <input
                          type="number"
                          min="0"
                          max="100000000"
                          step="0.01"
                          value={form.salePrice}
                          onChange={(event) => updateForm("salePrice", event.target.value)}
                          required
                          placeholder="0.00"
                        />
                      </label>

                      <label>
                        Quantity *
                        <input
                          type="number"
                          min="0"
                          max="1000000000"
                          step="1"
                          value={form.quantity}
                          onChange={(event) => updateForm("quantity", event.target.value)}
                          required
                          placeholder="Number of units"
                        />
                      </label>

                      <label>
                        Minimum stock level *
                        <input
                          type="number"
                          min="0"
                          max="1000000000"
                          step="1"
                          value={form.minimumStock}
                          onChange={(event) => updateForm("minimumStock", event.target.value)}
                          required
                          placeholder="e.g. 10"
                        />
                        <small className="field-help">
                          Alert when available stock reaches this quantity or lower.
                        </small>
                      </label>

                      <label>
                        Expiry date *
                        <input
                          type="date"
                          value={form.expiryDate}
                          onChange={(event) => updateForm("expiryDate", event.target.value)}
                          required
                        />
                      </label>
                    </div>

                    {editingBatchId !== null && (
                      <p className="inventory-footnote">
                        Medicine name, generic name, manufacturer and minimum stock are shared master details. Updating them may affect other batches linked to the same medicine.
                      </p>
                    )}

                    <div className="form-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={clearMedicineForm}
                        disabled={savingMedicine}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={savingMedicine}
                      >
                        {savingMedicine
                          ? "Saving..."
                          : editingBatchId === null
                            ? "Save medicine"
                            : "Save changes"}
                      </button>
                    </div>
                  </form>
                )}

                <div className="inventory-search">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, generic, manufacturer, barcode or batch..."
                    aria-label="Search medicine inventory"
                  />
                  {search && (
                    <button
                      className="clear-search"
                      onClick={() => setSearch("")}
                      type="button"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="table-caption">
                  <span>
                    {loadingMedicines
                      ? "Loading inventory..."
                      : `${medicines.length} batch(es) shown`}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => {
                      void loadMedicines(search);
                      void loadAlerts();
                    }}
                    disabled={loadingMedicines || loadingAlerts}
                  >
                    ↻ Refresh
                  </button>
                </div>

                {alertError && (
                  <div className="medicine-message error">{alertError}</div>
                )}

                <div className="table-scroll">
                  <table className="medicine-table">
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Batch no.</th>
                        <th>Quantity</th>
                        <th>Minimum stock</th>
                        <th>Purchase</th>
                        <th>Sale price</th>
                        <th>Expiry date</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medicines.map((medicine) => {
                        const isExpired = medicine.expiry_date < today;
                        const isNearExpiry =
                          !isExpired &&
                          medicine.expiry_date <=
                            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                              .toISOString()
                              .slice(0, 10);
                        const isLowStock =
                          medicine.quantity <= (medicine.minimum_stock ?? 10);

                        return (
                          <tr key={medicine.batch_id}>
                            <td>
                              <strong className="medicine-name">{medicine.name}</strong>
                              <small className="medicine-subtitle">
                                {medicine.generic_name || medicine.manufacturer || "No extra details"}
                              </small>
                            </td>
                            <td>{medicine.batch_number}</td>
                            <td>
                              <span
                                className={`quantity-pill ${
                                  medicine.quantity === 0
                                    ? "out-of-stock"
                                    : isLowStock
                                      ? "near-expiry"
                                      : ""
                                }`}
                              >
                                {medicine.quantity}
                              </span>
                            </td>
                            <td>{medicine.minimum_stock ?? 10}</td>
                            <td>{formatCurrency(medicine.purchase_price)}</td>
                            <td>{formatCurrency(medicine.sale_price)}</td>
                            <td>
                              <span
                                className={`expiry-pill ${
                                  isExpired
                                    ? "expired"
                                    : isNearExpiry
                                      ? "near-expiry"
                                      : ""
                                }`}
                              >
                                {isExpired
                                  ? `Expired · ${medicine.expiry_date}`
                                  : isNearExpiry
                                    ? `Soon · ${medicine.expiry_date}`
                                    : medicine.expiry_date}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => startEditingMedicine(medicine)}
                                  disabled={savingMedicine || deletingBatchId !== null}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="text-button"
                                  style={{ color: "#c24141" }}
                                  onClick={() => void handleDeleteMedicine(medicine)}
                                  disabled={savingMedicine || deletingBatchId !== null}
                                >
                                  {deletingBatchId === medicine.batch_id
                                    ? "Deleting..."
                                    : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {!loadingMedicines && medicines.length === 0 && (
                    <div className="empty-inventory">
                      <div className="empty-inventory-icon">▤</div>
                      <h4>{search ? "No matching medicines" : "Your inventory is empty"}</h4>
                      <p>
                        {search
                          ? "Try a different search term or clear the search."
                          : "Add your first medicine batch to begin tracking stock and expiry dates."}
                      </p>
                      {!search && (
                        <button
                          className="primary-button"
                          onClick={openNewMedicineForm}
                        >
                          + Add your first medicine
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <p className="inventory-footnote">
                  This view shows up to 500 matching batches. Inventory values are based on the currently loaded results. Stock alerts use the medicine's configured minimum level.
                </p>
              </section>
            </>
          ) : (
            <section className="panel placeholder-panel">
              <div className="placeholder-icon">✦</div>
              <h3>{activePage} workspace</h3>
              <p>
                This section is not connected to business data yet.
                We will build and test each feature step by step.
              </p>

              {activePage === "Billing" && (
                <button className="primary-button" onClick={() => setActivePage("Medicines")}>
                  Explore inventory next →
                </button>
              )}
            </section>
          )}

          <footer className="page-footer">
            <span>
              PharmaSathi <span className="footer-separator">•</span> Initial development build
            </span>
            <span>Designed for speed and simplicity</span>
          </footer>
        </section>
      </main>
    </div>
  );
}

export default App;


import AuthScreen from "./AuthScreen";
import CatalogueReview from "./CatalogueReview";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type NavigationItem =
  | "Dashboard"
  | "Medicines"
  | "Billing"
  | "Purchases"
  | "Reports"
  | "Catalogue Review";

type Theme = "light" | "dark";
type PharmacyMembership = {
  role: string;
  pharmacy: {
    id: string;
    name: string;
    slug: string;
  };
};

type AuthMeResponse = {
  
  success?: boolean;
  message?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    memberships?: PharmacyMembership[];
  };
};
type DeviceRegistrationStatus =
  | "idle"
  | "registering"
  | "registered"
  | "error";

type DeviceRegistrationResponse = {
  success?: boolean;
  message?: string;
};

type DatabaseStatus = {
  success: boolean;
  message: string;
};

type InventorySummary = {
  total_medicines: number;
  total_batches: number;
  available_units: number;
  expired_units: number;
};

type InventorySummaryResult = {
  success: boolean;
  message?: string;
  data: InventorySummary | null;
};

const navigation: { label: NavigationItem; icon: string }[] = [
  { label: "Dashboard", icon: "⌂" },
  { label: "Medicines", icon: "▤" },
  { label: "Billing", icon: "▧" },
  { label: "Purchases", icon: "⇩" },
  { label: "Reports", icon: "▥" },
  { label: "Catalogue Review", icon: "✓" },
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

type BillingCartItem = {
  batchId: number;
  quantity: number;
};

type PurchaseDraftLine = {
  medicineId: number;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  purchasePrice: number;
  salePrice: number;
  expiryDate: string;
};

type ReportsData = {
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
};

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  }).format(value);
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserName, setCurrentUserName] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [isOfflineSession, setIsOfflineSession] = useState(false);
  const [offlineRegisteredPharmacies, setOfflineRegisteredPharmacies] =
    useState<string[]>([]);
  const [checkingAuth, setCheckingAuth] = useState(true);
const [pharmacyMemberships, setPharmacyMemberships] =
  useState<PharmacyMembership[]>([]);

const [authRefreshKey, setAuthRefreshKey] = useState(0);
const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
const [restoringCloudData, setRestoringCloudData] = useState(false);
const [cloudRestoreMessage, setCloudRestoreMessage] = useState(() => {
  try {
    const message = sessionStorage.getItem("pharmasathi-cloud-restore-result") || "";
    sessionStorage.removeItem("pharmasathi-cloud-restore-result");
    return message;
  } catch {
    return "";
  }
});
const [cloudRestoreError, setCloudRestoreError] = useState(false);
const [cloudSyncStatus, setCloudSyncStatus] = useState<
  "waiting" | "connected" | "error"
>("waiting");


const [deviceRegistrationStatus, setDeviceRegistrationStatus] =
  useState<DeviceRegistrationStatus>("idle");

const [deviceRegistrationMessage, setDeviceRegistrationMessage] =
  useState("");

const [retryDeviceRegistration, setRetryDeviceRegistration] = useState(0);
  const registrationGenerationRef = useRef(0);

  async function deactivateActivePharmacyDatabase() {
    const deactivate = window.pharmaSathi?.deactivatePharmacyDatabase;

    if (typeof deactivate !== "function") {
      return;
    }

    const result = await deactivate();

    if (!result.success) {
      throw new Error(
        result.message || "Could not deactivate the pharmacy database.",
      );
    }
  }
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("pharmasathi-theme") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });

  const [activePage, setActivePage] =
    useState<NavigationItem>("Dashboard");

  const [hasCatalogueReviewerAccess, setHasCatalogueReviewerAccess] =
    useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkCatalogueReviewerAccess() {
      if (!isAuthenticated) {
        setHasCatalogueReviewerAccess(false);
        return;
      }

      try {
        const response = await fetch(
          "/api/catalogue/review/pending?page=1&limit=1",
          { credentials: "include" },
        );

        const result = await response.json();

        if (!isMounted) return;

        const allowed = response.ok && result.success === true;
        setHasCatalogueReviewerAccess(allowed);

        if (!allowed) {
          setActivePage((current) =>
            current === "Catalogue Review" ? "Dashboard" : current,
          );
        }
      } catch {
        if (!isMounted) return;

        setHasCatalogueReviewerAccess(false);
        setActivePage((current) =>
          current === "Catalogue Review" ? "Dashboard" : current,
        );
      }
    }

    void checkCatalogueReviewerAccess();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const [databaseStatus, setDatabaseStatus] =
    useState<DatabaseStatus | null>(null);

  const [checkingDatabase, setCheckingDatabase] = useState(true);

  const [inventorySummary, setInventorySummary] =
    useState<InventorySummary | null>(null);

  const [loadingInventorySummary, setLoadingInventorySummary] =
    useState(false);

  const [inventorySummaryError, setInventorySummaryError] =
    useState("");

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
  const [catalogueSearch, setCatalogueSearch] = useState("");
const [catalogueMedicines, setCatalogueMedicines] = useState<
  Array<{
    id: string;
    brandName: string;
    genericName: string;
    strength: string;
    dosageForm: string;
    manufacturer: string;
    category: string;
    barcode: string;
    registrationNumber: string;
    status: "PENDING" | "VERIFIED" | "REJECTED";
  }>
>([]);
const [loadingCatalogue, setLoadingCatalogue] = useState(false);
const [catalogueError, setCatalogueError] = useState("");
const [addingCatalogueMedicine, setAddingCatalogueMedicine] =
  useState<string | null>(null);

  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertError, setAlertError] = useState("");

  const [billingSearch, setBillingSearch] = useState("");
  const [billingCart, setBillingCart] = useState<BillingCartItem[]>([]);
  const [paymentMethod, setPaymentMethod] =
    useState<"cash" | "card" | "bank_transfer">("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [completingSale, setCompletingSale] = useState(false);
  const [billingMessage, setBillingMessage] = useState("");
  const [billingError, setBillingError] = useState(false);
  const [lastSale, setLastSale] = useState<CreateSaleResult | null>(null);

  const [purchaseSupplier, setPurchaseSupplier] = useState("");
  const [purchaseSupplierInvoice, setPurchaseSupplierInvoice] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");
  const [purchaseBatchId, setPurchaseBatchId] = useState("");
  const [purchaseBatchNumber, setPurchaseBatchNumber] = useState("");
  const [purchaseQuantity, setPurchaseQuantity] = useState("1");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseSalePrice, setPurchaseSalePrice] = useState("");
  const [purchaseExpiryDate, setPurchaseExpiryDate] = useState("");
  const [purchaseDraftLines, setPurchaseDraftLines] = useState<PurchaseDraftLine[]>([]);
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryItem[]>([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [purchaseError, setPurchaseError] = useState(false);
    const reportsToday = getLocalDateString();

  const [reportStartDate, setReportStartDate] = useState(reportsToday);
  const [reportEndDate, setReportEndDate] = useState(reportsToday);

  const [reports, setReports] = useState<ReportsData | null>(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportsError, setReportsError] = useState("");
  // Dashboard analytics — kept separate from Reports filters
  const [dashboardAnalytics, setDashboardAnalytics] =
    useState<ReportsData | null>(null);

  const [loadingDashboardAnalytics, setLoadingDashboardAnalytics] =
    useState(false);

  const [dashboardAnalyticsError, setDashboardAnalyticsError] =
    useState("");

 // Register this desktop installation with the selected pharmacy.
useEffect(() => {
  let isMounted = true;
  const generation = ++registrationGenerationRef.current;

  const isCurrentRequest = () =>
    isMounted && generation === registrationGenerationRef.current;

  async function registerDevice() {
    if (!isAuthenticated || checkingAuth) {
      return;
    }

    if (pharmacyMemberships.length === 0) {
      try {
        await deactivateActivePharmacyDatabase();
      } catch (error) {
        console.error("Could not deactivate pharmacy database:", error);
      }

      if (!isCurrentRequest()) return;

      setSelectedPharmacyId("");
      setDeviceRegistrationStatus("idle");
      setDeviceRegistrationMessage(
        "No pharmacy membership is available for this account.",
      );
      return;
    }

    // Automatically select only when there is exactly one pharmacy.
    if (pharmacyMemberships.length === 1) {
      const onlyPharmacyId = pharmacyMemberships[0].pharmacy.id;

      if (selectedPharmacyId !== onlyPharmacyId) {
        setSelectedPharmacyId(onlyPharmacyId);
        return;
      }
    }

    // Never silently choose a pharmacy when multiple memberships exist.
    if (!selectedPharmacyId) {
      setDeviceRegistrationStatus("idle");
      setDeviceRegistrationMessage("Select a pharmacy to register this device.");
      return;
    }

    const selectedMembership = pharmacyMemberships.find(
      (membership) => membership.pharmacy.id === selectedPharmacyId,
    );

    if (!selectedMembership) {
      setDeviceRegistrationStatus("idle");
      setDeviceRegistrationMessage("Please select a valid pharmacy.");
      return;
    }

    if (isOfflineSession) {
      if (!offlineRegisteredPharmacies.includes(selectedMembership.pharmacy.id)) {
        setDeviceRegistrationStatus("error");
        setDeviceRegistrationMessage(
          "This pharmacy is not registered on this device yet. Connect to the internet and register it first."
        );
        return;
      }

      try {
        const activationResult =
          await window.pharmaSathi.activatePharmacyDatabase(
            selectedMembership.pharmacy.id
          );

        if (!activationResult.success) {
          throw new Error(
            activationResult.message || "Could not activate the pharmacy database."
          );
        }

        if (!isCurrentRequest()) return;

        setDeviceRegistrationStatus("registered");
        setDeviceRegistrationMessage(
          "Offline mode — using this device's previously registered pharmacy."
        );
      } catch (error) {
        if (!isCurrentRequest()) return;
        setDeviceRegistrationStatus("error");
        setDeviceRegistrationMessage(
          error instanceof Error ? error.message : "Could not activate the pharmacy database."
        );
      }
      return;
    }

    setDeviceRegistrationStatus("registering");
    setDeviceRegistrationMessage("Registering this desktop device...");

    try {
      if (!window.pharmaSathi?.getDeviceIdentity) {
        throw new Error(
          "Device registration requires the PharmaSathi desktop application.",
        );
      }

      const identityResult =
        await window.pharmaSathi.getDeviceIdentity(selectedMembership.pharmacy.id);

      if (!identityResult.success || !identityResult.data) {
        throw new Error(
          identityResult.message || "Could not load device identity.",
        );
      }

      const response = await fetch("/api/devices/register", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pharmacyId: selectedMembership.pharmacy.id,
          deviceCode: identityResult.data.deviceCode,
          deviceName: identityResult.data.deviceName,
        }),
      });

      const result =
        (await response.json()) as DeviceRegistrationResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Could not register this device.",
        );
      }

      if (!isCurrentRequest()) return;

      const activationResult =
        await window.pharmaSathi.activatePharmacyDatabase(
          selectedMembership.pharmacy.id,
        );

      if (!activationResult.success) {
        throw new Error(
          activationResult.message ||
            "Could not activate the pharmacy database.",
        );
      }

      if (!isCurrentRequest()) return;

      try {
        const cachedRegistration =
          await window.pharmaSathi.markPharmacyRegisteredOffline(
            currentUserEmail,
            selectedMembership.pharmacy.id
          );

        if (cachedRegistration.success) {
          setOfflineRegisteredPharmacies((previous) =>
            previous.includes(selectedMembership.pharmacy.id)
              ? previous
              : [...previous, selectedMembership.pharmacy.id]
          );
        } else {
          console.warn(
            "Could not cache offline pharmacy registration:",
            cachedRegistration.message
          );
        }
      } catch (cacheError) {
        console.warn("Could not cache offline pharmacy registration:", cacheError);
      }

      if (!isCurrentRequest()) return;

      setDeviceRegistrationStatus("registered");
      setDeviceRegistrationMessage(
        result.message || "This desktop device is registered.",
      );
    } catch (error) {
      if (!isCurrentRequest()) return;

      console.error("Device registration failed:", error);

      setDeviceRegistrationStatus("error");
      setDeviceRegistrationMessage(
        error instanceof Error
          ? error.message
          : "Could not register this device.",
      );
    }
  }

  void registerDevice();

  return () => {
    isMounted = false;

    if (registrationGenerationRef.current === generation) {
      registrationGenerationRef.current += 1;
    }
  };
}, [
  isAuthenticated,
  checkingAuth,
  pharmacyMemberships,
  selectedPharmacyId,
  retryDeviceRegistration,
  isOfflineSession,
  offlineRegisteredPharmacies,
  currentUserEmail,
]);


  // Automatic cloud outbox uploader. Events remain local until the server confirms receipt.
  useEffect(() => {
    if (
      !isAuthenticated ||
      checkingAuth ||
      deviceRegistrationStatus !== "registered" ||
      !selectedPharmacyId
    ) {
      return;
    }

    let stopped = false;
    let running = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function uploadPendingEvents() {
      if (stopped || running) return;
      running = true;
      let batchEventIds: string[] = [];

      try {
        const identityResult =
          await window.pharmaSathi.getDeviceIdentity(selectedPharmacyId);

        if (stopped) return;
        if (!identityResult.success || !identityResult.data?.deviceCode) {
          throw new Error(identityResult.message || "Could not load device identity for sync.");
        }

        // Queue the pharmacy's existing local data for its one-time initial cloud backup.
        const snapshot = await window.pharmaSathi.enqueueInitialSyncSnapshot();

        if (stopped) return;
        if (!snapshot.success) {
          throw new Error(snapshot.message || "Could not prepare the initial cloud backup.");
        }

        const pending = await window.pharmaSathi.getPendingSyncEvents(100);
        if (stopped || !pending.success) {
          if (!pending.success) throw new Error(pending.message || "Could not read pending sync events.");
          return;
        }

        const events = pending.data || [];
        if (events.length === 0) return;
        batchEventIds = events.map((event) => event.event_id);

        const response = await fetch("/api/sync/push", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pharmacyId: selectedPharmacyId,
            deviceCode: identityResult.data.deviceCode,
            events: events.map((event) => ({
              eventId: event.event_id,
              eventType: event.event_type,
              entityType: event.entity_type,
              payload: event.payload,
            })),
          }),
        });

        const result = (await response.json()) as {
          success?: boolean;
          message?: string;
          received?: number;
          accepted?: number;
          duplicates?: number;
        };

        if (
          !response.ok ||
          !result.success ||
          result.received !== events.length ||
          (result.accepted ?? 0) + (result.duplicates ?? 0) !== events.length
        ) {
          throw new Error(result.message || `Cloud sync confirmation was incomplete (${response.status}).`);
        }

        if (stopped) return;

        const acknowledgement = await window.pharmaSathi.acknowledgeSyncEvents(batchEventIds);
        if (!acknowledgement.success || acknowledgement.updated !== batchEventIds.length) {
          throw new Error(
            acknowledgement.message ||
              `Cloud received events, but local acknowledgement was incomplete (${acknowledgement.updated ?? 0}/${batchEventIds.length}).`,
          );
        }

        if (!stopped) setCloudSyncStatus("connected");
      } catch (error) {
        if (!stopped) {
          console.error("Cloud outbox upload failed:", error);
          setCloudSyncStatus("error");
          // Only mark events from this attempted batch; never alter unrelated queued events.
          const message =
            error instanceof Error ? error.message : "Cloud sync failed.";
          for (const eventId of batchEventIds) {
            if (stopped) break;
            try {
              await window.pharmaSathi.markSyncEventFailed(eventId, message);
            } catch (recordError) {
              console.error("Could not record sync retry error:", recordError);
            }
          }
        }
      } finally {
        running = false;
      }
    }

    void uploadPendingEvents();
    intervalId = setInterval(() => void uploadPendingEvents(), 10000);

    return () => {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [
    isAuthenticated,
    checkingAuth,
    deviceRegistrationStatus,
    selectedPharmacyId,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
        });

        const result = (await response.json()) as AuthMeResponse;

        if (!isMounted) return;

        if (!response.ok || !result.success || !result.user) {
          await deactivateActivePharmacyDatabase();

          if (!isMounted) return;

          setSelectedPharmacyId("");
          setDeviceRegistrationStatus("idle");
          setDeviceRegistrationMessage("");
          setIsAuthenticated(false);
          setCurrentUserName("");
          setPharmacyMemberships([]);
          return;
        }

        setIsAuthenticated(true);

        setCurrentUserName(
          typeof result.user.name === "string" &&
            result.user.name.trim()
            ? result.user.name.trim()
            : "Pharmacy Owner",
        );

        setPharmacyMemberships(
          Array.isArray(result.user.memberships)
            ? result.user.memberships
            : [],
        );
      } catch (error) {
        console.error("Could not verify authentication:", error);

        try {
          await deactivateActivePharmacyDatabase();
        } catch (deactivationError) {
          console.error(
            "Could not deactivate pharmacy database after auth failure:",
            deactivationError,
          );
        }

        if (isMounted) {
          setSelectedPharmacyId("");
          setDeviceRegistrationStatus("idle");
          setDeviceRegistrationMessage("");
          setIsAuthenticated(false);
          setCurrentUserName("");
          setPharmacyMemberships([]);
        }
      } finally {
        if (isMounted) {
          setCheckingAuth(false);
        }
      }
    }

    void checkAuth();

    return () => {
      isMounted = false;
    };
  }, [authRefreshKey]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;

    try {
      localStorage.setItem("pharmasathi-theme", theme);
    } catch (error) {
      console.warn("Could not save theme preference:", error);
    }
  }, [theme]);

  useEffect(() => {
    let isMounted = true;

    if (
      !isAuthenticated ||
      deviceRegistrationStatus !== "registered" ||
      !selectedPharmacyId
    ) {
      setCheckingDatabase(false);
      setDatabaseStatus({
        success: false,
        message: "Select and register a pharmacy to activate its database.",
      });

      return () => {
        isMounted = false;
      };
    }

    async function checkDatabase() {
      setCheckingDatabase(true);

      try {
        const result = await window.pharmaSathi.getDatabaseStatus();

        if (isMounted) {
          setDatabaseStatus(result);
        }
      } catch (error) {
        console.error("Could not check database:", error);

        if (isMounted) {
          setDatabaseStatus({
            success: false,
            message: "Unable to connect to the local database.",
          });
        }
      } finally {
        if (isMounted) {
          setCheckingDatabase(false);
        }
      }
    }

    void checkDatabase();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, deviceRegistrationStatus, selectedPharmacyId]);

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
        error instanceof Error
          ? error.message
          : "Could not load medicines.",
      );
    } finally {
      setLoadingMedicines(false);
    }
  }
  async function searchMedicineCatalogue(searchTerm = catalogueSearch) {
    const term = searchTerm.trim();

    setCatalogueError("");
    setCatalogueMedicines([]);

    if (term.length < 2) {
      setCatalogueError("Please enter at least 2 characters to search.");
      return;
    }

    setLoadingCatalogue(true);

    try {
      const response = await fetch(
        `/api/catalogue/medicines?search=${encodeURIComponent(term)}&limit=30`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Could not search the medicine catalogue.",
        );
      }

      setCatalogueMedicines(result.medicines || []);

      if (!result.medicines?.length) {
        setCatalogueError("No matching medicines found in the catalogue.");
      }
    } catch (error) {
      console.error("Medicine catalogue search failed:", error);

      setCatalogueError(
        error instanceof Error
          ? error.message
          : "Could not search the medicine catalogue.",
      );
    } finally {
      setLoadingCatalogue(false);
    }
  }
    async function addCatalogueMedicine(
    medicine: (typeof catalogueMedicines)[number],
  ) {
    setAddingCatalogueMedicine(medicine.id);
    setCatalogueError("");

    try {
      const result = await window.pharmaSathi.createMedicineProfile({
        name: medicine.brandName,
        genericName: medicine.genericName || "",
        manufacturer: medicine.manufacturer || "",
        category: medicine.category || "Medicine",
        barcode: medicine.barcode || "",
        minimumStock: 10,
      });

      if (!result.success) {
        throw new Error(result.message || "Could not add medicine.");
      }

      setMedicineError(false);
      setMedicineMessage(
        result.alreadyExists
          ? "This medicine is already in your inventory."
          : "Medicine added successfully. Initial stock is zero.",
      );

      await Promise.all([
        loadMedicines(search),
        loadAlerts(),
        loadInventorySummary(),
      ]);
    } catch (error) {
      console.error("Could not add catalogue medicine:", error);

      setCatalogueError(
        error instanceof Error
          ? error.message
          : "Could not add medicine to inventory.",
      );
    } finally {
      setAddingCatalogueMedicine(null);
    }
  }
  async function loadPurchases() {
    setLoadingPurchases(true);

    try {
      const result = await window.pharmaSathi.listPurchases();
      if (!result.success) {
        throw new Error(result.message || "Could not load purchase history.");
      }
      setPurchaseHistory(result.data);
    } catch (error) {
      console.error("Could not load purchases:", error);
      setPurchaseMessage(
        error instanceof Error ? error.message : "Could not load purchase history.",
      );
      setPurchaseError(true);
    } finally {
      setLoadingPurchases(false);
    }
  }
  async function loadReports(
    startDate = reportStartDate,
    endDate = reportEndDate,
  ) {
    setLoadingReports(true);
    setReportsError("");

    try {
      const result = await window.pharmaSathi.getReports({
        startDate,
        endDate,
      });

      if (!result.success || !result.data) {
        throw new Error(
          result.message || "Could not load reports.",
        );
      }

      setReports(result.data);
    } catch (error) {
      console.error("Could not load reports:", error);

      setReportsError(
        error instanceof Error
          ? error.message
          : "Could not load reports.",
      );
    } finally {
      setLoadingReports(false);
    }
  }
    async function loadDashboardAnalytics() {
    setLoadingDashboardAnalytics(true);
    setDashboardAnalyticsError("");

    try {
      const today = new Date();
      const endDate = getLocalDateString(today);

      // Current month + previous 5 calendar months
      const start = new Date(
        today.getFullYear(),
        today.getMonth() - 5,
        1,
      );

      const startDate = getLocalDateString(start);

      const result = await window.pharmaSathi.getReports({
        startDate,
        endDate,
      });

      if (!result.success || !result.data) {
        throw new Error(
          result.message || "Could not load dashboard analytics.",
        );
      }

      setDashboardAnalytics(result.data);
    } catch (error) {
      console.error("Could not load dashboard analytics:", error);

      setDashboardAnalyticsError(
        error instanceof Error
          ? error.message
          : "Could not load dashboard analytics.",
      );
    } finally {
      setLoadingDashboardAnalytics(false);
    }
  }
  async function loadInventorySummary() {
    setLoadingInventorySummary(true);
    setInventorySummaryError("");

    try {
      const result: InventorySummaryResult =
        await window.pharmaSathi.getInventorySummary();

      if (!result.success || !result.data) {
        throw new Error(
          result.message || "Could not load inventory summary.",
        );
      }

      setInventorySummary(result.data);
    } catch (error) {
      console.error("Could not load inventory summary:", error);

      setInventorySummaryError(
        error instanceof Error
          ? error.message
          : "Could not load inventory summary.",
      );
    } finally {
      setLoadingInventorySummary(false);
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
        throw new Error(
          stockResult.message || "Could not load stock alerts.",
        );
      }

      if (!expiryResult.success) {
        throw new Error(
          expiryResult.message || "Could not load expiry alerts.",
        );
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
    if (
      deviceRegistrationStatus !== "registered" ||
      !selectedPharmacyId
    ) {
      return;
    }

    if (
      activePage === "Dashboard" ||
      activePage === "Medicines" ||
      activePage === "Billing" ||
      activePage === "Purchases"
    ) {
      void loadMedicines("");
      void loadAlerts();
      void loadInventorySummary();
      void loadDashboardAnalytics();
    }

    if (activePage === "Purchases") {
      void loadPurchases();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, deviceRegistrationStatus, selectedPharmacyId]);

  useEffect(() => {
    if (
      deviceRegistrationStatus !== "registered" ||
      !selectedPharmacyId ||
      activePage !== "Reports"
    ) {
      return;
    }

    void loadReports();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, deviceRegistrationStatus, selectedPharmacyId]);

  useEffect(() => {
    if (
      deviceRegistrationStatus !== "registered" ||
      !selectedPharmacyId ||
      activePage !== "Medicines"
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadMedicines(search);
    }, 250);

    return () => window.clearTimeout(timeoutId);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activePage, deviceRegistrationStatus, selectedPharmacyId]);

  const monthlySales = useMemo(() => {
    const today = new Date();

    return Array.from({ length: 6 }, (_, index) => {
      const monthDate = new Date(
        today.getFullYear(),
        today.getMonth() - 5 + index,
        1,
      );

      const year = monthDate.getFullYear();
      const month = String(monthDate.getMonth() + 1).padStart(2, "0");

      const monthKey = `${year}-${month}`;

      const revenue =
        dashboardAnalytics?.dailySales
          .filter((sale) => sale.report_date.startsWith(monthKey))
          .reduce((total, sale) => total + sale.revenue, 0) ?? 0;

      return {
        key: monthKey,
        label: monthDate.toLocaleDateString("en-PK", {
          month: "short",
        }),
        revenue,
      };
    });
  }, [dashboardAnalytics]);

  const monthlySalesMaximum = Math.max(
    ...monthlySales.map((month) => month.revenue),
    0,
  );
  const purchaseDraftTotal = purchaseDraftLines.reduce(
    (sum, item) => sum + item.quantity * item.purchasePrice,
    0,
  );

  function handleAddPurchaseLine() {
    setPurchaseMessage("");
    setPurchaseError(false);

    const selected = medicines.find(
      (item) => String(item.batch_id) === purchaseBatchId,
    );
    const quantity = Number(purchaseQuantity);
    const cost = Number(purchasePrice);
    const sale = Number(purchaseSalePrice);

    if (!selected) {
      setPurchaseMessage("Select a medicine first.");
      setPurchaseError(true);
      return;
    }
    if (!purchaseBatchNumber.trim() || !purchaseExpiryDate) {
      setPurchaseMessage("Enter the batch number and expiry date.");
      setPurchaseError(true);
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setPurchaseMessage("Quantity must be a whole number greater than zero.");
      setPurchaseError(true);
      return;
    }
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(sale) || sale < 0) {
      setPurchaseMessage("Enter valid purchase and sale prices.");
      setPurchaseError(true);
      return;
    }

    const duplicate = purchaseDraftLines.some(
      (item) =>
        item.medicineId === selected.medicine_id &&
        item.batchNumber.trim().toLowerCase() === purchaseBatchNumber.trim().toLowerCase(),
    );
    if (duplicate) {
      setPurchaseMessage("This medicine and batch are already in the purchase list.");
      setPurchaseError(true);
      return;
    }

    setPurchaseDraftLines((current) => [
      ...current,
      {
        medicineId: selected.medicine_id,
        medicineName: selected.name,
        batchNumber: purchaseBatchNumber.trim(),
        quantity,
        purchasePrice: cost,
        salePrice: sale,
        expiryDate: purchaseExpiryDate,
      },
    ]);
    setPurchaseBatchId("");
    setPurchaseBatchNumber("");
    setPurchaseQuantity("1");
    setPurchasePrice("");
    setPurchaseSalePrice("");
    setPurchaseExpiryDate("");
  }

  async function handleSavePurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPurchaseMessage("");
    setPurchaseError(false);

    if (!purchaseSupplier.trim()) {
      setPurchaseMessage("Enter the supplier name.");
      setPurchaseError(true);
      return;
    }
    if (purchaseDraftLines.length === 0) {
      setPurchaseMessage("Add at least one medicine to this purchase.");
      setPurchaseError(true);
      return;
    }

    setSavingPurchase(true);
    try {
      const result = await window.pharmaSathi.createPurchase({
        supplierName: purchaseSupplier.trim(),
        supplierInvoice: purchaseSupplierInvoice.trim(),
        notes: purchaseNotes.trim(),
        items: purchaseDraftLines.map((item) => ({
          medicineId: item.medicineId,
          batchNumber: item.batchNumber,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
          salePrice: item.salePrice,
          expiryDate: item.expiryDate,
        })),
      });

      if (!result.success) {
        throw new Error(result.message || "Could not save purchase.");
      }

      setPurchaseMessage(
        `Purchase ${result.invoiceNumber || ""} saved successfully. Total: ${formatCurrency(result.total ?? purchaseDraftTotal)}.`,
      );
      setPurchaseError(false);
      setPurchaseSupplier("");
      setPurchaseSupplierInvoice("");
      setPurchaseNotes("");
      setPurchaseDraftLines([]);
      setPurchaseBatchId("");
      await Promise.all([
        loadMedicines(""),
        loadAlerts(),
        loadInventorySummary(),
        loadPurchases(),
      ]);
    } catch (error) {
      console.error("Could not save purchase:", error);
      setPurchaseMessage(
        error instanceof Error ? error.message : "Could not save purchase.",
      );
      setPurchaseError(true);
    } finally {
      setSavingPurchase(false);
    }
  }

  const databaseConnected = databaseStatus?.success === true;


  const today = new Date().toISOString().slice(0, 10);

  const billingMedicines = useMemo(() => {
    const query = billingSearch.trim().toLowerCase();

    return medicines.filter((medicine) => {
      const available = medicine.quantity > 0 && medicine.expiry_date >= today;
      const matchesSearch =
        !query ||
        medicine.name.toLowerCase().includes(query) ||
        medicine.generic_name.toLowerCase().includes(query) ||
        medicine.barcode.toLowerCase().includes(query) ||
        medicine.batch_number.toLowerCase().includes(query);

      return available && matchesSearch;
    });
  }, [medicines, billingSearch, today]);

  const billingTotal = useMemo(() => {
    const subtotal = billingCart.reduce((sum, item) => {
      const medicine = medicines.find(
        (entry) => entry.batch_id === item.batchId,
      );

      return sum + (medicine ? medicine.sale_price * item.quantity : 0);
    }, 0);

    return Math.round((subtotal + Number.EPSILON) * 100) / 100;
  }, [billingCart, medicines]);

  function addToBillingCart(medicine: MedicineBatch) {
    setBillingMessage("");
    setBillingError(false);
    setLastSale(null);

    setBillingCart((current) => {
      const existing = current.find(
        (item) => item.batchId === medicine.batch_id,
      );

      if (existing) {
        if (existing.quantity >= medicine.quantity) {
          setBillingMessage(
            `Only ${medicine.quantity} units are available for ${medicine.name}.`,
          );
          setBillingError(true);
          return current;
        }

        return current.map((item) =>
          item.batchId === medicine.batch_id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }

      return [...current, { batchId: medicine.batch_id, quantity: 1 }];
    });
  }

  function changeBillingQuantity(batchId: number, quantity: number) {
    if (quantity <= 0) {
      setBillingCart((current) =>
        current.filter((item) => item.batchId !== batchId),
      );
      return;
    }

    const medicine = medicines.find((item) => item.batch_id === batchId);

    if (!medicine || quantity > medicine.quantity) {
      setBillingMessage(
        medicine
          ? `Only ${medicine.quantity} units are available for ${medicine.name}.`
          : "This medicine batch is no longer available.",
      );
      setBillingError(true);
      return;
    }

    setBillingCart((current) =>
      current.map((item) =>
        item.batchId === batchId ? { ...item, quantity } : item,
      ),
    );
    setBillingMessage("");
    setBillingError(false);
  }

  async function handleCompleteSale(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (billingCart.length === 0) {
      setBillingMessage("Add at least one medicine to the bill.");
      setBillingError(true);
      return;
    }

    const paid = Number(amountPaid);

    if (!Number.isFinite(paid) || paid < billingTotal) {
      setBillingMessage("Amount received must be at least the bill total.");
      setBillingError(true);
      return;
    }

    if (paymentMethod !== "cash" && paid !== billingTotal) {
      setBillingMessage(
        "For card or bank transfer, amount received must equal the bill total.",
      );
      setBillingError(true);
      return;
    }

    setCompletingSale(true);
    setBillingMessage("");
    setBillingError(false);

    try {
      const result = await window.pharmaSathi.createSale({
        items: billingCart.map((item) => ({
          batchId: item.batchId,
          quantity: item.quantity,
        })),
        paymentMethod,
        amountPaid: paid,
      });

      if (!result.success) {
        throw new Error(result.message || "Could not complete the sale.");
      }

      setLastSale(result);
      setBillingCart([]);
      setAmountPaid("");
      setBillingMessage(
        `Sale completed successfully. Invoice: ${result.invoiceNumber ?? "created"}.`,
      );

      await Promise.all([
        loadMedicines(""),
        loadAlerts(),
        loadInventorySummary(),
      ]);
    } catch (error) {
      setBillingMessage(
        error instanceof Error ? error.message : "Could not complete the sale.",
      );
      setBillingError(true);
    } finally {
      setCompletingSale(false);
    }
  }


  const expiredBatchCount = useMemo(
    () =>
      expiryAlerts.filter((item) => item.expiry_status === "expired").length,
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

  async function handleSaveMedicine(
    event: React.FormEvent<HTMLFormElement>,
  ) {
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

      await Promise.all([
        loadMedicines(search),
        loadAlerts(),
        loadInventorySummary(),
      ]);
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
    const isProfile = medicine.batch_id == null;
    const confirmed = window.confirm(
      isProfile
        ? `Remove "${medicine.name}" from this pharmacy inventory?\n\nThis is allowed only if it has no batches or purchase/sales history. The shared DRAP catalogue will not be deleted.`
        : `Delete batch "${medicine.batch_number}" of "${medicine.name}"?\n\nOnly this batch will be deleted.`,
    );

    if (!confirmed) return;

    const operationId = isProfile
      ? -Number(medicine.medicine_id)
      : Number(medicine.batch_id);

    setDeletingBatchId(operationId);
    setMedicineMessage("");
    setMedicineError(false);

    try {
      const result = isProfile
        ? await window.pharmaSathi.deleteMedicineProfile(medicine.medicine_id)
        : await window.pharmaSathi.deleteMedicineBatch(medicine.batch_id);

      if (!result.success) {
        throw new Error(result.message || "Could not delete this inventory record.");
      }

      if (!isProfile && editingBatchId === medicine.batch_id) {
        clearMedicineForm();
      }

      setMedicineMessage(
        isProfile
          ? "Medicine profile removed from this pharmacy inventory."
          : "Medicine batch deleted successfully.",
      );

      await Promise.all([
        loadMedicines(search),
        loadAlerts(),
        loadInventorySummary(),
      ]);
    } catch (error) {
      console.error("Could not delete inventory record:", error);
      setMedicineError(true);
      setMedicineMessage(
        error instanceof Error ? error.message : "Could not delete this record.",
      );
    } finally {
      setDeletingBatchId(null);
    }
  }

  async function handleRestoreCloudData() {
    if (!selectedPharmacyId || restoringCloudData) return;

    if (!window.confirm(
      "Restore cloud data onto this PC? Continue only if this PC is new or its local pharmacy data is empty."
    )) return;

    setRestoringCloudData(true);
    setCloudRestoreMessage("");
    setCloudRestoreError(false);

    try {
      const identity = await window.pharmaSathi.getDeviceIdentity(selectedPharmacyId);
      if (!identity.success || !identity.data?.deviceCode) {
        throw new Error(identity.message || "Could not load device identity.");
      }

      const params = new URLSearchParams({
        pharmacyId: selectedPharmacyId,
        deviceCode: identity.data.deviceCode,
      });

      const response = await fetch(`/api/sync/pull?${params}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      const result = await response.json() as {
        success?: boolean;
        message?: string;
        data?: {
          medicines: unknown[];
          batches: unknown[];
          sales: unknown[];
          purchases: unknown[];
        };
      };

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.message || `Cloud restore failed (${response.status}).`);
      }

      const imported = await window.pharmaSathi.restoreCloudData(result.data);
      if (!imported.success) {
        throw new Error(imported.message || "Local import failed.");
      }

      try {
        sessionStorage.setItem(
          "pharmasathi-cloud-restore-result",
          `Cloud restore completed: ${(result.data.medicines.length + result.data.batches.length + result.data.sales.length + result.data.purchases.length)} records imported.`
        );
      } catch {
        setCloudRestoreMessage("Cloud restore completed successfully.");
      }
      window.location.reload();
    } catch (error) {
      setCloudRestoreError(true);
      setCloudRestoreMessage(
        error instanceof Error ? error.message : "Cloud restore failed."
      );
    } finally {
      setRestoringCloudData(false);
    }
  }

  async function handleLogout() {
    let cloudLogoutMessage = "";

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        cloudLogoutMessage = "Cloud logout could not be confirmed.";
      }
    } catch (error) {
      console.warn("Cloud logout unavailable; completing local logout:", error);
      cloudLogoutMessage = "Offline logout completed. Cloud session will expire separately.";
    }

    let deactivationError: unknown = null;

    try {
      await deactivateActivePharmacyDatabase();
    } catch (error) {
      deactivationError = error;
      console.error("Could not deactivate pharmacy database:", error);
    }

    registrationGenerationRef.current += 1;
    setIsAuthenticated(false);
    setCurrentUserName("");
    setCurrentUserEmail("");
    setIsOfflineSession(false);
    setOfflineRegisteredPharmacies([]);
    setPharmacyMemberships([]);
    setSelectedPharmacyId("");
    setDeviceRegistrationStatus("idle");
    setDeviceRegistrationMessage("");
    setCheckingAuth(false);
    setHasCatalogueReviewerAccess(false);

    if (deactivationError) {
      window.alert(
        deactivationError instanceof Error
          ? deactivationError.message
          : "Logged out, but the pharmacy database could not be deactivated."
      );
    } else if (cloudLogoutMessage) {
      window.alert(cloudLogoutMessage);
    }
  }

  async function handlePharmacySelectionChange(nextPharmacyId: string) {
    if (nextPharmacyId === selectedPharmacyId) return;

    registrationGenerationRef.current += 1;

    try {
      await deactivateActivePharmacyDatabase();

      setSelectedPharmacyId(nextPharmacyId);
      setDeviceRegistrationStatus("idle");
      setDeviceRegistrationMessage("");
    } catch (error) {
      console.error("Could not switch pharmacy database:", error);

      setDeviceRegistrationStatus("error");
      setDeviceRegistrationMessage(
        error instanceof Error
          ? error.message
          : "Could not safely switch the selected pharmacy.",
      );
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

  if (checkingAuth) {
    return (
      <div className="app-shell">
        <main className="main-content">
          <p>Checking your PharmaSathi session...</p>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
  <AuthScreen
    onAuthenticated={(payload) => {
      setCurrentUserName(
        payload.user.name?.trim() || "Pharmacy Owner"
      );
      setCurrentUserEmail(payload.user.email || "");
      setPharmacyMemberships(
        Array.isArray(payload.user.memberships)
          ? payload.user.memberships
          : []
      );
      setIsOfflineSession(payload.offline);
      setOfflineRegisteredPharmacies(
        payload.registeredPharmacies || []
      );

      if (payload.offline) {
        setSelectedPharmacyId("");
        setDeviceRegistrationStatus("idle");
        setDeviceRegistrationMessage("");
        setCheckingAuth(false);
        setIsAuthenticated(true);
      } else {
        setCheckingAuth(true);
        setAuthRefreshKey((previous) => previous + 1);
      }
    }}
  />
);
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
          {navigation
            .filter(
              (item) =>
                item.label !== "Catalogue Review" ||
                hasCatalogueReviewerAccess,
            )
            .map((item) => (
            <button
              key={item.label}
              className={`nav-item ${
                activePage === item.label ? "active" : ""
              }`}
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
            <button
              type="button"
              className="theme-toggle"
              onClick={() =>
                setTheme((current) =>
                  current === "dark" ? "light" : "dark",
                )
              }
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              <span className="theme-toggle-icon" aria-hidden="true">
                {theme === "dark" ? "☀" : "☾"}
              </span>
              <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>

            <button
              type="button"
              className="theme-toggle"
              onClick={() => void handleLogout()}
              title="Log out of PharmaSathi"
            >
              <span aria-hidden="true">↪</span>
              <span>Logout</span>
            </button>

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
    ? `Assalam-o-Alaikum, ${currentUserName || "Pharmacy Owner"}!`
    : activePage === "Medicines"
      ? "Medicine inventory"
      : activePage}
</h2>

              <p className="subtitle">
                {activePage === "Dashboard"
                  ? "Allah Ta'ala aap ke rizq mein barkat ata farmaye, aap ke kaam mein asani paida farmaye aur aap ke zariye logon ko shifa aur rahat naseeb farmaye. Ameen."
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
                  <p className="stat-value">
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary
                        ? inventorySummary.total_medicines
                        : "—"}
                  </p>
                  <h4>Total medicines</h4>
                  <p className="stat-foot">
                    Unique medicine records in database
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon green">▦</span>
                    <span className="stat-caption">BATCHES</span>
                  </div>
                  <p className="stat-value">
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary
                        ? inventorySummary.total_batches
                        : "—"}
                  </p>
                  <h4>Total batches</h4>
                  <p className="stat-foot">All recorded medicine batches</p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon purple">＋</span>
                    <span className="stat-caption">AVAILABLE STOCK</span>
                  </div>
                  <p className="stat-value">
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary
                        ? inventorySummary.available_units
                        : "—"}
                  </p>
                  <h4>Available units</h4>
                  <p className="stat-foot">
                    Units in batches not yet expired
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon orange">◷</span>
                    <span className="stat-caption">EXPIRED STOCK</span>
                  </div>
                  <p className="stat-value">
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary
                        ? inventorySummary.expired_units
                        : "—"}
                  </p>
                  <h4>Expired units</h4>
                  <p className="stat-foot">
                    {expiredBatchCount} expired batch(es)
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon orange">◷</span>
                    <span className="stat-caption">EXPIRY</span>
                  </div>
                  <p className="stat-value">{expiringSoonCount}</p>
                  <h4>Expiring within 30 days</h4>
                  <p className="stat-foot">
                    Batches nearing their expiry date
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon purple">!</span>
                    <span className="stat-caption">LOW STOCK</span>
                  </div>
                  <p className="stat-value">{stockAlerts.length}</p>
                  <h4>Low-stock medicines</h4>
                  <p className="stat-foot">
                    At or below minimum stock level
                  </p>
                </article>
              </div>

              <div className="analytics-grid">
                <section className="panel analytics-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Inventory overview</h3>
                      <p>Current stock position from your local database</p>
                    </div>
                    <span className="demo-label">LIVE DATA</span>
                  </div>

                  <div className="inventory-chart">
                    {(() => {
                      const available = inventorySummary?.available_units ?? 0;
                      const expired = inventorySummary?.expired_units ?? 0;
                      const maxValue = Math.max(available, expired, 1);
                      const bars = [
                        {
                          label: "Available stock",
                          value: available,
                          color: "#138567",
                        },
                        {
                          label: "Expired stock",
                          value: expired,
                          color: "#d97757",
                        },
                      ];

                      return bars.map((bar) => (
                        <div className="chart-bar-row" key={bar.label}>
                          <div className="chart-bar-label">
                            <span>{bar.label}</span>
                            <strong>{bar.value.toLocaleString("en-PK")}</strong>
                          </div>
                          <div
                            className="chart-bar-track"
                            role="img"
                            aria-label={`${bar.label}: ${bar.value} units`}
                          >
                            <div
                              className="chart-bar-fill"
                              style={{
                                width: `${(bar.value / maxValue) * 100}%`,
                                background: bar.color,
                              }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>

                  <div className="chart-footer">
                    <span>
                      <i className="chart-legend-dot available-dot" />
                      Available units
                    </span>
                    <span>
                      <i className="chart-legend-dot expired-dot" />
                      Expired units
                    </span>
                  </div>
                </section>

                <section className="panel analytics-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Stock status</h3>
                      <p>Available versus expired inventory</p>
                    </div>
                  </div>

                  {(() => {
                    const available = inventorySummary?.available_units ?? 0;
                    const expired = inventorySummary?.expired_units ?? 0;
                    const total = available + expired;
                    const availablePercent =
                      total > 0 ? (available / total) * 100 : 0;

                    return (
                      <div className="stock-donut-layout">
                        <div
                          className={`stock-donut ${
                            total === 0 ? "stock-donut-empty" : ""
                          }`}
                          style={{
                            background:
                              total > 0
                                ? `conic-gradient(#138567 0% ${availablePercent}%, #e4a15b ${availablePercent}% 100%)`
                                : "#e8eeeb",
                          }}
                          role="img"
                          aria-label={`Stock status: ${available} available units and ${expired} expired units`}
                        >
                          <div className="stock-donut-center">
                            <strong>{total.toLocaleString("en-PK")}</strong>
                            <span>Total units</span>
                          </div>
                        </div>

                        <div className="stock-donut-legend">
                          <div>
                            <i className="chart-legend-dot available-dot" />
                            <span>Available</span>
                            <strong>
                              {available.toLocaleString("en-PK")}
                            </strong>
                          </div>
                          <div>
                            <i className="chart-legend-dot expired-dot" />
                            <span>Expired</span>
                            <strong>
                              {expired.toLocaleString("en-PK")}
                            </strong>
                          </div>
                          <div>
                            <i className="chart-legend-dot lowstock-dot" />
                            <span>Low-stock medicines</span>
                            <strong>{stockAlerts.length}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <p className="chart-note">
                    Low-stock medicines are counted separately from stock units.
                  </p>
                </section>
              </div>

                            <section className="panel analytics-panel sales-chart-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Monthly sales</h3>
                    <p>Sales performance over the last 6 months</p>
                  </div>

                  <span className="demo-label">SALES HISTORY</span>
                </div>

                <div className="monthly-sales-summary">
                  <div>
                    <span>Total sales · 6 months</span>
                    <strong>
                      {formatCurrency(
                        monthlySales.reduce(
                          (total, month) => total + month.revenue,
                          0,
                        ),
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Monthly average</span>
                    <strong>
                      {formatCurrency(
                        monthlySales.reduce(
                          (total, month) => total + month.revenue,
                          0,
                        ) / 6,
                      )}
                    </strong>
                  </div>
                </div>

                {loadingDashboardAnalytics ? (
                  <div className="sales-chart-state">
                    Loading monthly sales...
                  </div>
                ) : dashboardAnalyticsError ? (
                  <div className="sales-chart-state error">
                    {dashboardAnalyticsError}
                  </div>
                ) : (
                  <div className="monthly-sales-chart">
                    {monthlySalesMaximum > 0 ? (
                      <svg
                        className="monthly-sales-svg"
                        viewBox="0 0 720 250"
                        role="img"
                        aria-label="Monthly sales trend for the last six months"
                        preserveAspectRatio="none"
                      >
                        {[40, 85, 130, 175, 220].map((y) => (
                          <line
                            key={y}
                            x1="55"
                            y1={y}
                            x2="700"
                            y2={y}
                            className="sales-grid-line"
                          />
                        ))}

                        {[0, 1, 2, 3, 4].map((index) => {
                          const value =
                            (monthlySalesMaximum / 4) * (4 - index);

                          return (
                            <text
                              key={index}
                              x="45"
                              y={44 + index * 45}
                              textAnchor="end"
                              className="sales-axis-label"
                            >
                              {value >= 1000
                                ? `${(value / 1000).toFixed(1)}k`
                                : Math.round(value)}
                            </text>
                          );
                        })}

                        <polyline
                          points={monthlySales
                            .map((month, index) => {
                              const x = 65 + index * 125;
                              const y =
                                220 -
                                (month.revenue / monthlySalesMaximum) * 180;

                              return `${x},${y}`;
                            })
                            .join(" ")}
                          className="monthly-sales-line"
                        />

                        {monthlySales.map((month, index) => {
                          const x = 65 + index * 125;
                          const y =
                            220 -
                            (month.revenue / monthlySalesMaximum) * 180;

                          return (
                            <g key={month.key}>
                              <circle
                                cx={x}
                                cy={y}
                                r="5"
                                className="monthly-sales-point"
                              >
                                <title>
                                  {month.label}: {formatCurrency(month.revenue)}
                                </title>
                              </circle>

                              <text
                                x={x}
                                y="244"
                                textAnchor="middle"
                                className="sales-axis-label"
                              >
                                {month.label}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    ) : (
                      <div className="sales-chart-state">
                        No sales recorded in the last six months.
                        Completed billing transactions will appear here.
                      </div>
                    )}
                  </div>
                )}

                <div className="chart-footer">
                  <span>
                    <i className="chart-legend-dot available-dot" />
                    Monthly revenue (PKR)
                  </span>

                 <span>
  Source: Saved billing transactions
</span>
                </div>
              </section>

              {inventorySummaryError && (
                <div className="medicine-message error">
                  {inventorySummaryError}
                </div>
              )}

              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Quick actions</h3>
                      <p>Frequently used pharmacy tasks</p>
                    </div>
                  </div>

                  <div className="quick-actions">
                    <button
                      className="quick-action"
                      onClick={() => setActivePage("Billing")}
                    >
                      <span className="action-icon green">＋</span>
                      <span>
                        <strong>New sale</strong>
                        <small>Open billing workspace</small>
                      </span>
                      <span className="action-arrow">→</span>
                    </button>

                    <button
                      className="quick-action"
                      onClick={() => setActivePage("Medicines")}
                    >
                      <span className="action-icon blue">▤</span>
                      <span>
                        <strong>Medicine stock</strong>
                        <small>Open inventory workspace</small>
                      </span>
                      <span className="action-arrow">→</span>
                    </button>

                    <button
                      className="quick-action"
                      onClick={() => setActivePage("Purchases")}
                    >
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
                      style={{
                        color: databaseConnected ? "#138567" : "#d9a441",
                      }}
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
                    <strong
                      className={databaseConnected ? "" : "muted-status"}
                    >
                      {checkingDatabase
                        ? "Checking..."
                        : databaseConnected
                          ? "Connected"
                          : "Not connected"}
                    </strong>
                  </div>
<div className="system-row">
  <span>Registered pharmacy</span>
  <strong>
    {pharmacyMemberships.find(
      (membership) =>
        membership.pharmacy.id === selectedPharmacyId,
    )?.pharmacy.name || "Not selected"}
  </strong>
</div>

{pharmacyMemberships.length > 1 && (
  <div className="system-row">
    <label htmlFor="device-pharmacy-select">
      Select pharmacy
    </label>

    <select
      id="device-pharmacy-select"
      value={selectedPharmacyId}
      onChange={(event) => {
        void handlePharmacySelectionChange(event.target.value);
      }}
    >
      <option value="">Choose a pharmacy</option>

      {pharmacyMemberships.map((membership) => (
        <option
          key={membership.pharmacy.id}
          value={membership.pharmacy.id}
        >
          {membership.pharmacy.name}
        </option>
      ))}
    </select>
  </div>
)}

<div className="system-row">
  <span>Device registration</span>

  <strong
    className={
      deviceRegistrationStatus === "registered"
        ? ""
        : "muted-status"
    }
  >
    {deviceRegistrationStatus === "registering"
      ? "Registering..."
      : deviceRegistrationStatus === "registered"
        ? "Registered"
        : deviceRegistrationStatus === "error"
          ? "Registration failed"
          : "Not registered"}
  </strong>
</div>

{deviceRegistrationMessage && (
  <div className="system-note">
    <span>ⓘ</span>
    <p>{deviceRegistrationMessage}</p>
  </div>
)}

{deviceRegistrationStatus === "error" && (
  <button
    type="button"
    className="theme-toggle"
    onClick={() => {
      setRetryDeviceRegistration((previous) => previous + 1);
    }}
  >
    Retry device registration
  </button>
)}

<div className="system-row">
  <button
  type="button"
  className="theme-toggle"
  disabled={restoringCloudData || !selectedPharmacyId || deviceRegistrationStatus !== "registered"}
  onClick={() => void handleRestoreCloudData()}
>
  {restoringCloudData ? "Restoring..." : "Restore from Cloud"}
</button>
{cloudRestoreMessage && (
  <div
    className={cloudRestoreError ? "system-note error-message" : "system-note"}
    role="status"
  >
    <p>{cloudRestoreMessage}</p>
  </div>
)}
<span>Cloud synchronization</span>
  <strong className={
    cloudSyncStatus === "connected"
      ? "success-status"
      : cloudSyncStatus === "error"
        ? "error-status"
        : "muted-status"
  }>
    {cloudSyncStatus === "connected"
      ? "Connected"
      : cloudSyncStatus === "error"
        ? "Connection issue"
        : "Awaiting first successful upload"}
  </strong>
</div>

<div className="system-note">
  <span>ⓘ</span>
  <p>
    Cloud connection is confirmed only after an upload is accepted by the
    server and acknowledged locally. An empty queue does not confirm connectivity.
  </p>
</div>
                </section>
              </div>

              <section className="panel alerts-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Inventory alerts</h3>
                    <p>
                      Review low stock, expiring batches and expired medicines.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      void loadAlerts();
                      void loadInventorySummary();
                    }}
                    disabled={loadingAlerts || loadingInventorySummary}
                  >
                    {loadingAlerts || loadingInventorySummary
                      ? "Refreshing..."
                      : "↻ Refresh alerts"}
                  </button>
                </div>

                {alertError && (
                  <div className="medicine-message error">
                    {alertError}
                  </div>
                )}

                {loadingAlerts &&
                stockAlerts.length === 0 &&
                expiryAlerts.length === 0 ? (
                  <p className="alert-empty">Loading inventory alerts...</p>
                ) : stockAlerts.length === 0 &&
                  expiryAlerts.length === 0 ? (
                  <div className="alert-empty">
                    <span className="alert-empty-icon">✓</span>
                    <strong>No stock or expiry alerts</strong>
                    <p>
                      No matching issues were returned by the local database.
                    </p>
                  </div>
                ) : (
                  <div className="alerts-grid">
                    <div className="alert-group">
                      <div className="alert-group-heading">
                        <span className="alert-marker warning" />
                        <h4>Low stock</h4>
                        <span className="alert-count">
                          {stockAlerts.length}
                        </span>
                      </div>

                      {stockAlerts.length === 0 ? (
                        <p className="alert-empty compact">
                          No low-stock medicines.
                        </p>
                      ) : (
                        <div className="alert-list">
                          {stockAlerts.map((item) => (
                            <div
                              className="alert-item"
                              key={item.medicine_id}
                            >
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
                        <p className="alert-empty compact">
                          No expiry alerts.
                        </p>
                      ) : (
                        <div className="alert-list">
                          {expiryAlerts.map((item) => (
                            <div className="alert-item" key={item.batch_id}>
                              <div>
                                <strong>{item.name}</strong>
                                <small>
                                  Batch {item.batch_number || "—"} ·{" "}
                                  {item.expiry_date}
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
                  <span>Total medicine records</span>
                  <strong>
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary?.total_medicines ?? "—"}
                  </strong>
                </div>

                <div className="inventory-summary-card">
                  <span>Total batches</span>
                  <strong>
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary?.total_batches ?? "—"}
                  </strong>
                </div>

                <div className="inventory-summary-card">
                  <span>Available units</span>
                  <strong>
                    {loadingInventorySummary
                      ? "…"
                      : inventorySummary?.available_units ?? "—"}
                  </strong>
                </div>

                <div className="inventory-summary-card">
                  <span>Expiry alerts</span>
                  <strong>{expiryAlerts.length}</strong>
                </div>
              </div>

              <section className="panel inventory-panel">
                <div className="panel-heading inventory-heading">
                  <div>
                    <h3>Medicine inventory</h3>
                    <p>
                      Manage medicine details, batch quantities, prices and
                      expiry dates.
                    </p>
                  </div>

                  <button
                    type="button"
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
                                <div className="catalogue-panel">
                  <div className="form-heading">
                    <div>
                      <h4>Pakistan Medicine Catalogue</h4>
                      <p>
                        Search medicines from the shared DRAP source catalogue.
                      </p>
                    </div>
                  </div>

                  <div className="search-row">
                    <input
                      type="search"
                      value={catalogueSearch}
                      onChange={(event) =>
                        setCatalogueSearch(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void searchMedicineCatalogue();
                        }
                      }}
                      placeholder="Search brand, generic or manufacturer..."
                    />

                    <button
                      type="button"
                      className="primary-button"
                      disabled={loadingCatalogue}
                      onClick={() => void searchMedicineCatalogue()}
                    >
                      {loadingCatalogue ? "Searching..." : "Search catalogue"}
                    </button>
                  </div>

                  {catalogueError && (
                    <div className="medicine-message error">
                      {catalogueError}
                    </div>
                  )}

                  {catalogueMedicines.length > 0 && (
                    <div className="catalogue-results">
                      {catalogueMedicines.map((medicine) => (
                        <div className="catalogue-result" key={medicine.id}>
                          <div>
                            <strong>{medicine.brandName}</strong>
                            <p>
                              {medicine.genericName || "Generic information unavailable"}
                              {medicine.strength
                                ? ` · ${medicine.strength}`
                                : ""}
                              {medicine.dosageForm
                                ? ` · ${medicine.dosageForm}`
                                : ""}
                            </p>
                            <p>
                              Manufacturer: {medicine.manufacturer || "Not listed"}
                            </p>
                            <span>
                              {medicine.status === "VERIFIED"
                                ? "Verified catalogue record"
                                : "DRAP source record — pending review"}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="secondary-button"
                            disabled={addingCatalogueMedicine !== null}
                            onClick={() =>
                              void addCatalogueMedicine(medicine)
                            }
                          >
                            {addingCatalogueMedicine === medicine.id
                              ? "Adding..."
                              : "Add to inventory"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {medicineMessage && (
                  <div
                    className={`medicine-message ${
                      medicineError ? "error" : "success"
                    }`}
                  >
                    {medicineMessage}
                  </div>
                )}

                {showMedicineForm && (
                  <form
                    className="medicine-form"
                    onSubmit={handleSaveMedicine}
                  >
                    <div className="form-heading">
                      <div>
                        <h4>
                          {editingBatchId === null
                            ? "Add medicine batch"
                            : "Edit medicine batch"}
                        </h4>
                        <p>
                          Enter the medicine and batch information below.
                        </p>
                      </div>

                      <span className="required-note">
                        * Required fields
                      </span>
                    </div>

                    <div className="form-grid">
                      <label className="form-field">
                        <span>Medicine name *</span>
                        <input
                          required
                          maxLength={150}
                          value={form.name}
                          onChange={(event) =>
                            updateForm("name", event.target.value)
                          }
                          placeholder="e.g. Paracetamol"
                        />
                      </label>

                      <label className="form-field">
                        <span>Generic name</span>
                        <input
                          maxLength={150}
                          value={form.genericName}
                          onChange={(event) =>
                            updateForm("genericName", event.target.value)
                          }
                          placeholder="e.g. Acetaminophen"
                        />
                      </label>

                      <label className="form-field">
                        <span>Manufacturer</span>
                        <input
                          maxLength={150}
                          value={form.manufacturer}
                          onChange={(event) =>
                            updateForm("manufacturer", event.target.value)
                          }
                          placeholder="Manufacturer name"
                        />
                      </label>

                      <label className="form-field">
                        <span>Category *</span>
                        <input
                          required
                          maxLength={100}
                          value={form.category}
                          onChange={(event) =>
                            updateForm("category", event.target.value)
                          }
                          placeholder="e.g. Tablet, Syrup"
                        />
                      </label>

                      <label className="form-field">
                        <span>Barcode</span>
                        <input
                          maxLength={100}
                          value={form.barcode}
                          onChange={(event) =>
                            updateForm("barcode", event.target.value)
                          }
                          placeholder="Barcode (optional)"
                        />
                      </label>

                      <label className="form-field">
                        <span>Batch number *</span>
                        <input
                          required
                          maxLength={100}
                          value={form.batchNumber}
                          onChange={(event) =>
                            updateForm("batchNumber", event.target.value)
                          }
                          placeholder="Manufacturer batch number"
                        />
                      </label>

                      <label className="form-field">
                        <span>Purchase price (PKR) *</span>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.purchasePrice}
                          onChange={(event) =>
                            updateForm("purchasePrice", event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </label>

                      <label className="form-field">
                        <span>Sale price (PKR) *</span>
                        <input
                          required
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.salePrice}
                          onChange={(event) =>
                            updateForm("salePrice", event.target.value)
                          }
                          placeholder="0.00"
                        />
                      </label>

                      <label className="form-field">
                        <span>Quantity *</span>
                        <input
                          required
                          type="number"
                          min="0"
                          step="1"
                          value={form.quantity}
                          onChange={(event) =>
                            updateForm("quantity", event.target.value)
                          }
                          placeholder="Available units"
                        />
                      </label>

                      <label className="form-field">
                        <span>Minimum stock level *</span>
                        <input
                          required
                          type="number"
                          min="0"
                          step="1"
                          value={form.minimumStock}
                          onChange={(event) =>
                            updateForm("minimumStock", event.target.value)
                          }
                          placeholder="10"
                        />
                      </label>

                      <label className="form-field">
                        <span>Expiry date *</span>
                        <input
                          required
                          type="date"
                          value={form.expiryDate}
                          onChange={(event) =>
                            updateForm("expiryDate", event.target.value)
                          }
                        />
                      </label>
                    </div>

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
                            : "Update batch"}
                      </button>
                    </div>
                  </form>
                )}

                <div className="inventory-toolbar">
                  <div className="search-box">
                    <span aria-hidden="true">⌕</span>
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by medicine, generic name, barcode or batch..."
                      aria-label="Search medicines"
                    />
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      void loadMedicines(search);
                      void loadAlerts();
                      void loadInventorySummary();
                    }}
                    disabled={
                      loadingMedicines ||
                      loadingAlerts ||
                      loadingInventorySummary
                    }
                  >
                    {loadingMedicines ? "Loading..." : "↻ Refresh"}
                  </button>
                </div>

                {loadingMedicines && medicines.length === 0 ? (
                  <div className="table-empty">
                    <p>Loading medicine inventory...</p>
                  </div>
                ) : medicines.length === 0 ? (
                  <div className="table-empty">
                    <span className="empty-icon">▤</span>
                    <h4>
                      {search.trim()
                        ? "No matching medicines found"
                        : "Your inventory is empty"}
                    </h4>
                    <p>
                      {search.trim()
                        ? "Try a different name, barcode or batch number."
                        : "Add your first medicine batch to start managing stock."}
                    </p>

                    {!search.trim() && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={openNewMedicineForm}
                      >
                        + Add first medicine
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Medicine</th>
                          <th>Batch no.</th>
                          <th>Quantity</th>
                          <th>Min. stock</th>
                          <th>Purchase</th>
                          <th>Sale price</th>
                          <th>Expiry date</th>
                          <th>Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {medicines.map((medicine) => {
                          const isExpired = medicine.expiry_date < today;
                          const isLowStock =
                            !isExpired &&
                            medicine.quantity <= medicine.minimum_stock;

                          return (
                            <tr key={medicine.batch_id}>
                              <td>
                                <div className="medicine-name-cell">
                                  <strong>{medicine.name}</strong>
                                  {medicine.generic_name && (
                                    <small>{medicine.generic_name}</small>
                                  )}
                                  {medicine.manufacturer && (
                                    <small>{medicine.manufacturer}</small>
                                  )}
                                </div>
                              </td>

                              <td>
                                <span className="batch-number">
                                  {medicine.batch_number || "—"}
                                </span>
                              </td>

                              <td>
                                <span
                                  className={`quantity-badge ${
                                    isExpired
                                      ? "expired"
                                      : isLowStock
                                        ? "low"
                                        : "normal"
                                  }`}
                                >
                                  {medicine.quantity}
                                </span>
                              </td>

                              <td>{medicine.minimum_stock}</td>

                              <td>
                                {formatCurrency(medicine.purchase_price)}
                              </td>

                              <td>
                                {formatCurrency(medicine.sale_price)}
                              </td>

                              <td>
                                <span
                                  className={`expiry-date ${
                                    isExpired ? "expired" : ""
                                  }`}
                                >
                                  {medicine.expiry_date}
                                </span>
                              </td>

                              <td>
                                <div className="table-actions">
                                  <button
                                    type="button"
                                    className="icon-button edit"
                                    title="Edit medicine batch"
                                    aria-label={`Edit batch ${medicine.batch_number}`}
                                    onClick={() =>
                                      startEditingMedicine(medicine)
                                    }
                                  >
                                    ✎
                                  </button>

                                  <button
                                    type="button"
                                    className="icon-button delete"
                                    title={
                                      medicine.batch_id == null
                                        ? "Remove medicine profile"
                                        : "Delete medicine batch"
                                    }
                                    aria-label={`Delete ${medicine.name} from inventory`}
                                    disabled={
                                      deletingBatchId ===
                                      (medicine.batch_id == null
                                        ? -Number(medicine.medicine_id)
                                        : Number(medicine.batch_id))
                                    }
                                    onClick={() =>
                                      void handleDeleteMedicine(medicine)
                                    }
                                  >
                                    {deletingBatchId ===
                                    (medicine.batch_id == null
                                      ? -Number(medicine.medicine_id)
                                      : Number(medicine.batch_id))
                                      ? "…"
                                      : "×"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="inventory-footnote">
                  <span aria-hidden="true">ⓘ</span>
                  <p>
                    Inventory changes are saved to the local database. Expired
                    batches should not be dispensed to customers.
                  </p>
                </div>
              </section>

            </>
          ) : activePage === "Billing" ? (
            <div className="billing-workspace">
              <section className="panel billing-inventory-panel">
                <div className="section-heading">
                  <div>
                    <span className="section-eyebrow">POINT OF SALE</span>
                    <h3>Select medicines</h3>
                    <p>Only in-stock, non-expired batches are available for sale.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loadingMedicines}
                    onClick={() => {
                      void loadMedicines("");
                      void loadAlerts();
                      void loadInventorySummary();
                    }}
                  >
                    {loadingMedicines ? "Refreshing..." : "↻ Refresh stock"}
                  </button>
                </div>

                <div className="inventory-toolbar billing-toolbar">
                  <div className="search-box">
                    <span aria-hidden="true">⌕</span>
                    <input
                      type="search"
                      value={billingSearch}
                      onChange={(event) => setBillingSearch(event.target.value)}
                      placeholder="Search medicine, generic name, barcode or batch..."
                      aria-label="Search medicines for billing"
                    />
                  </div>
                </div>

                {loadingMedicines && medicines.length === 0 ? (
                  <div className="table-empty">
                    <p>Loading available stock...</p>
                  </div>
                ) : billingMedicines.length === 0 ? (
                  <div className="table-empty">
                    <span className="empty-icon">▤</span>
                    <h4>
                      {billingSearch.trim()
                        ? "No available matching batches"
                        : "No saleable stock available"}
                    </h4>
                    <p>
                      {billingSearch.trim()
                        ? "Try another search term or refresh the inventory."
                        : "Add a medicine batch with available quantity and a future expiry date in Medicines."}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setActivePage("Medicines")}
                    >
                      Open medicines inventory
                    </button>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="inventory-table billing-medicine-table">
                      <thead>
                        <tr>
                          <th>Medicine</th>
                          <th>Batch</th>
                          <th>Stock</th>
                          <th>Expiry</th>
                          <th>Price</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billingMedicines.map((medicine) => {
                          const cartItem = billingCart.find(
                            (item) => item.batchId === medicine.batch_id,
                          );
                          const inCart = cartItem?.quantity ?? 0;

                          return (
                            <tr key={medicine.batch_id}>
                              <td>
                                <div className="medicine-name-cell">
                                  <strong>{medicine.name}</strong>
                                  {medicine.generic_name && (
                                    <small>{medicine.generic_name}</small>
                                  )}
                                </div>
                              </td>
                              <td>{medicine.batch_number}</td>
                              <td>{medicine.quantity}</td>
                              <td>{medicine.expiry_date}</td>
                              <td>{formatCurrency(medicine.sale_price)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="primary-button billing-add-button"
                                  disabled={inCart >= medicine.quantity}
                                  onClick={() => addToBillingCart(medicine)}
                                >
                                  {inCart > 0 ? `Add more (${inCart})` : "+ Add"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="panel billing-cart-panel">
                <div className="section-heading">
                  <div>
                    <span className="section-eyebrow">CURRENT SALE</span>
                    <h3>Bill summary</h3>
                    <p>{billingCart.length} batch(es) in this bill</p>
                  </div>
                  {billingCart.length > 0 && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={completingSale}
                      onClick={() => {
                        setBillingCart([]);
                        setBillingMessage("");
                        setBillingError(false);
                        setLastSale(null);
                        setAmountPaid("");
                      }}
                    >
                      Clear bill
                    </button>
                  )}
                </div>

                {billingCart.length === 0 ? (
                  <div className="billing-empty-cart">
                    <span className="empty-icon">▧</span>
                    <h4>Your bill is empty</h4>
                    <p>Add medicines from the stock list to start a sale.</p>
                  </div>
                ) : (
                  <div className="billing-cart-list">
                    {billingCart.map((item) => {
                      const medicine = medicines.find(
                        (entry) => entry.batch_id === item.batchId,
                      );

                      if (!medicine) return null;

                      return (
                        <div className="billing-cart-item" key={item.batchId}>
                          <div className="billing-cart-item-info">
                            <strong>{medicine.name}</strong>
                            <small>
                              Batch {medicine.batch_number} ·{" "}
                              {formatCurrency(medicine.sale_price)} each
                            </small>
                            <strong>
                              {formatCurrency(medicine.sale_price * item.quantity)}
                            </strong>
                          </div>
                          <div className="billing-quantity-controls">
                            <button
                              type="button"
                              className="secondary-button"
                              aria-label={`Decrease ${medicine.name} quantity`}
                              disabled={completingSale}
                              onClick={() =>
                                changeBillingQuantity(item.batchId, item.quantity - 1)
                              }
                            >
                              −
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              type="button"
                              className="secondary-button"
                              aria-label={`Increase ${medicine.name} quantity`}
                              disabled={
                                completingSale || item.quantity >= medicine.quantity
                              }
                              onClick={() =>
                                changeBillingQuantity(item.batchId, item.quantity + 1)
                              }
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="icon-button delete"
                              aria-label={`Remove ${medicine.name}`}
                              disabled={completingSale}
                              onClick={() => changeBillingQuantity(item.batchId, 0)}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <form className="billing-checkout" onSubmit={handleCompleteSale}>
                  <div className="billing-total-row">
                    <span>Subtotal</span>
                    <strong>{formatCurrency(billingTotal)}</strong>
                  </div>
                  <div className="billing-total-row billing-grand-total">
                    <span>Total payable</span>
                    <strong>{formatCurrency(billingTotal)}</strong>
                  </div>

                  <label className="form-field">
                    <span>Payment method</span>
                    <select
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(
                          event.target.value as "cash" | "card" | "bank_transfer",
                        )
                      }
                      disabled={completingSale}
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                  </label>

                  <label className="form-field">
                    <span>
                      {paymentMethod === "cash"
                        ? "Amount received (PKR)"
                        : "Amount paid (PKR)"}
                    </span>
                    <input
                      type="number"
                      min={billingTotal}
                      step="0.01"
                      required
                      value={amountPaid}
                      onChange={(event) => setAmountPaid(event.target.value)}
                      placeholder={billingTotal.toFixed(2)}
                      disabled={completingSale || billingCart.length === 0}
                    />
                  </label>

                  {paymentMethod === "cash" && Number(amountPaid) >= billingTotal && (
                    <div className="billing-total-row">
                      <span>Change to return</span>
                      <strong>
                        {formatCurrency(
                          Math.max(0, Number(amountPaid) - billingTotal),
                        )}
                      </strong>
                    </div>
                  )}

                  {billingMessage && (
                    <div
                      className={`billing-message ${billingError ? "error" : "success"}`}
                      role="status"
                    >
                      {billingMessage}
                    </div>
                  )}

                  {lastSale?.success && (
                    <div className="billing-invoice-confirmation">
                      <span className="section-eyebrow">SALE CONFIRMED</span>
                      <h4>Invoice {lastSale.invoiceNumber}</h4>
                      <p>Total: {formatCurrency(lastSale.total ?? 0)}</p>
                      <p>Paid: {formatCurrency(lastSale.amountPaid ?? 0)}</p>
                      <p>Change: {formatCurrency(lastSale.changeDue ?? 0)}</p>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => window.print()}
                      >
                        Print invoice
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="primary-button billing-complete-button"
                    disabled={
                      completingSale ||
                      billingCart.length === 0 ||
                      !amountPaid.trim() ||
                      !Number.isFinite(Number(amountPaid)) ||
                      Number(amountPaid) < billingTotal
                    }
                  >
                    {completingSale ? "Processing sale..." : "Complete sale"}
                  </button>
                  <p className="billing-security-note">
                    Stock is deducted only after the database confirms the sale.
                  </p>
                </form>
              </section>
            </div>
          ) : activePage === "Purchases" ? (
            <div className="purchases-workspace">
              <section className="panel purchase-entry-panel">
                <div className="section-heading">
                  <div>
                    <span className="section-eyebrow">INVENTORY IN</span>
                    <h3>Record a purchase</h3>
                    <p>Record stock received from a supplier. Stock changes only after the purchase is saved.</p>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loadingPurchases || savingPurchase}
                    onClick={() => {
                      void loadPurchases();
                      void loadMedicines("");
                    }}
                  >
                    {loadingPurchases ? "Refreshing..." : "↻ Refresh"}
                  </button>
                </div>

                {purchaseMessage && (
                  <div className={purchaseError ? "form-message form-message-error" : "form-message form-message-success"} role="status">
                    {purchaseMessage}
                  </div>
                )}

                <form onSubmit={handleSavePurchase} className="purchase-form">
                  <div className="purchase-fields-grid">
                    <label className="form-field">
                      <span>Supplier name *</span>
                      <input value={purchaseSupplier} onChange={(event) => setPurchaseSupplier(event.target.value)} required placeholder="e.g. ABC Distributors" />
                    </label>
                    <label className="form-field">
                      <span>Supplier invoice number</span>
                      <input value={purchaseSupplierInvoice} onChange={(event) => setPurchaseSupplierInvoice(event.target.value)} placeholder="Optional invoice/reference" />
                    </label>
                    <label className="form-field purchase-notes-field">
                      <span>Notes</span>
                      <input value={purchaseNotes} onChange={(event) => setPurchaseNotes(event.target.value)} placeholder="Optional purchase notes" />
                    </label>
                  </div>

                  <div className="purchase-item-builder">
                    <h4>Add medicine to purchase</h4>
                    <div className="purchase-fields-grid">
                      <label className="form-field purchase-medicine-field">
                        <span>Medicine *</span>
                        <select
                          value={purchaseBatchId}
                          onChange={(event) => {
                            const selectedId = event.target.value;
                            setPurchaseBatchId(selectedId);
                            const selected = medicines.find((item) => String(item.batch_id) === selectedId);
                            if (selected) {
                              setPurchaseBatchNumber(selected.batch_number);
                              setPurchasePrice(String(selected.purchase_price));
                              setPurchaseSalePrice(String(selected.sale_price));
                              setPurchaseExpiryDate(selected.expiry_date);
                            } else {
                              setPurchaseBatchNumber("");
                              setPurchasePrice("");
                              setPurchaseSalePrice("");
                              setPurchaseExpiryDate("");
                            }
                          }}
                        >
                          <option value="">Select medicine / existing batch</option>
                          {medicines.map((item) => (
                            <option key={item.batch_id} value={String(item.batch_id)}>
                              {item.name} — batch {item.batch_number} (current stock: {item.quantity})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span>Batch number *</span>
                        <input value={purchaseBatchNumber} onChange={(event) => setPurchaseBatchNumber(event.target.value)} required placeholder="Batch number" />
                      </label>
                      <label className="form-field">
                        <span>Expiry date *</span>
                        <input type="date" value={purchaseExpiryDate} onChange={(event) => setPurchaseExpiryDate(event.target.value)} required />
                      </label>
                      <label className="form-field">
                        <span>Quantity *</span>
                        <input type="number" min="1" step="1" value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(event.target.value)} required />
                      </label>
                      <label className="form-field">
                        <span>Purchase price / unit (Rs) *</span>
                        <input type="number" min="0" step="0.01" value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} required />
                      </label>
                      <label className="form-field">
                        <span>Sale price / unit (Rs) *</span>
                        <input type="number" min="0" step="0.01" value={purchaseSalePrice} onChange={(event) => setPurchaseSalePrice(event.target.value)} required />
                      </label>
                    </div>
                    <button type="button" className="secondary-button" onClick={handleAddPurchaseLine}>
                      + Add item
                    </button>
                  </div>

                  <div className="purchase-draft">
                    <div className="section-heading">
                      <div>
                        <h4>Purchase items</h4>
                        <p>{purchaseDraftLines.length} item line(s)</p>
                      </div>
                      <strong>{formatCurrency(purchaseDraftTotal)}</strong>
                    </div>
                    {purchaseDraftLines.length === 0 ? (
                      <div className="table-empty">
                        <p>No items added yet. Select a medicine, enter batch details and click “Add item”.</p>
                      </div>
                    ) : (
                      <div className="table-scroll">
                        <table className="inventory-table">
                          <thead>
                            <tr>
                              <th>Medicine / batch</th>
                              <th>Expiry</th>
                              <th>Qty</th>
                              <th>Unit cost</th>
                              <th>Line total</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {purchaseDraftLines.map((item, index) => (
                              <tr key={`${item.medicineId}-${item.batchNumber}`}>
                                <td>{item.medicineName}<br /><small>{item.batchNumber}</small></td>
                                <td>{item.expiryDate}</td>
                                <td>{item.quantity}</td>
                                <td>{formatCurrency(item.purchasePrice)}</td>
                                <td>{formatCurrency(item.quantity * item.purchasePrice)}</td>
                                <td>
                                  <button type="button" className="secondary-button" onClick={() => setPurchaseDraftLines((current) => current.filter((_, i) => i !== index))}>
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <button type="submit" className="primary-button" disabled={savingPurchase || purchaseDraftLines.length === 0 || !purchaseSupplier.trim()}>
                    {savingPurchase ? "Saving purchase..." : "Save purchase & update stock"}
                  </button>
                </form>
              </section>

              <section className="panel purchase-history-panel">
                <div className="section-heading">
                  <div>
                    <span className="section-eyebrow">PURCHASE RECORDS</span>
                    <h3>Purchase history</h3>
                    <p>Recent purchases saved in this local database.</p>
                  </div>
                </div>
                {loadingPurchases && purchaseHistory.length === 0 ? (
                  <div className="table-empty"><p>Loading purchase history...</p></div>
                ) : purchaseHistory.length === 0 ? (
                  <div className="table-empty">
                    <span className="empty-icon">⇩</span>
                    <h4>No purchases recorded</h4>
                    <p>Saved supplier purchases will appear here.</p>
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="inventory-table">
                      <thead>
                        <tr><th>Invoice</th><th>Supplier</th><th>Date</th><th>Items</th><th>Units</th><th>Total</th></tr>
                      </thead>
                      <tbody>
                        {purchaseHistory.map((purchase) => (
                          <tr key={purchase.id}>
                            <td>{purchase.invoice_number}</td>
                            <td>{purchase.supplier_name}{purchase.supplier_invoice ? <><br /><small>Supplier invoice: {purchase.supplier_invoice}</small></> : null}</td>
                            <td>{new Date(purchase.created_at).toLocaleString()}</td>
                            <td>{purchase.item_count}</td>
                            <td>{purchase.total_units}</td>
                            <td>{formatCurrency(purchase.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : activePage === "Catalogue Review" ? (
            <CatalogueReview />
          ) : (
            <div className="reports-workspace">
  <div className="reports-page-heading">
    <div>
      <span className="section-eyebrow">BUSINESS ANALYTICS</span>
      <h2>Reports & Analytics</h2>
      <p>Track sales, gross profit, purchases and inventory performance.</p>
    </div>

    <button
      type="button"
      className="secondary-button"
      onClick={() => void loadReports()}
      disabled={loadingReports}
    >
      {loadingReports ? "Refreshing..." : "↻ Refresh"}
    </button>
  </div>

  <section className="panel reports-filter-panel">
    <div className="section-heading">
      <div>
        <h3>Report date range</h3>
        <p>Select a period to view business performance.</p>
      </div>
    </div>

    <div className="reports-filter-controls">
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          const date = getLocalDateString();
          setReportStartDate(date);
          setReportEndDate(date);
          void loadReports(date, date);
        }}
      >
        Today
      </button>

      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - 6);

          const startDate = getLocalDateString(start);
          const endDate = getLocalDateString(end);

          setReportStartDate(startDate);
          setReportEndDate(endDate);
          void loadReports(startDate, endDate);
        }}
      >
        Last 7 days
      </button>

      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - 29);

          const startDate = getLocalDateString(start);
          const endDate = getLocalDateString(end);

          setReportStartDate(startDate);
          setReportEndDate(endDate);
          void loadReports(startDate, endDate);
        }}
      >
        Last 30 days
      </button>

      <label className="reports-date-field">
        <span>From</span>
        <input
          type="date"
          value={reportStartDate}
          max={reportEndDate}
          onChange={(event) => setReportStartDate(event.target.value)}
        />
      </label>

      <label className="reports-date-field">
        <span>To</span>
        <input
          type="date"
          value={reportEndDate}
          min={reportStartDate}
          onChange={(event) => setReportEndDate(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="primary-button"
        disabled={
          loadingReports ||
          !reportStartDate ||
          !reportEndDate ||
          reportStartDate > reportEndDate
        }
        onClick={() => void loadReports(reportStartDate, reportEndDate)}
      >
        Apply filters
      </button>
    </div>
  </section>

  {reportsError && (
    <div className="form-message error">
      {reportsError}
    </div>
  )}

  {loadingReports && !reports ? (
    <section className="panel table-empty">
      <p>Loading business reports...</p>
    </section>
  ) : reports ? (
    <>
      <div className="reports-summary-heading">
        <div>
          <h3>Financial overview</h3>
          <p>
            {reports.startDate} to {reports.endDate}
          </p>
        </div>
      </div>

      <div className="stats-grid reports-stats-grid">
        <article className="stat-card">
          <span className="stat-label">Total sales</span>
          <strong>{formatCurrency(reports.sales.total_revenue)}</strong>
          <small>{reports.sales.invoice_count} invoices</small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Gross profit</span>
          <strong>{formatCurrency(reports.profit.gross_profit)}</strong>
          <small>Revenue minus cost of goods</small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Purchases</span>
          <strong>{formatCurrency(reports.purchases.total_purchases)}</strong>
          <small>{reports.purchases.purchase_count} purchase records</small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Amount received</span>
          <strong>{formatCurrency(reports.sales.amount_received)}</strong>
          <small>
            Change returned: {formatCurrency(reports.sales.change_returned)}
          </small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Units sold</span>
          <strong>{reports.profit.units_sold.toLocaleString()}</strong>
          <small>Items sold in selected period</small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Cost of goods</span>
          <strong>{formatCurrency(reports.profit.cost_of_goods)}</strong>
          <small>Cost of sold items</small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Inventory units</span>
          <strong>{reports.inventory.available_units.toLocaleString()}</strong>
          <small>{reports.inventory.total_batches} batches</small>
        </article>

        <article className="stat-card">
          <span className="stat-label">Medicines</span>
          <strong>{reports.inventory.total_medicines.toLocaleString()}</strong>
          <small>Registered medicines</small>
        </article>
      </div>

      <div className="reports-tables-grid">
        <section className="panel reports-table-panel">
          <div className="section-heading">
            <div>
              <h3>Daily sales</h3>
              <p>Sales performance by date.</p>
            </div>
          </div>

          {reports.dailySales.length === 0 ? (
            <div className="table-empty">
              <h4>No sales in this period</h4>
              <p>Sales records will appear here.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Invoices</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.dailySales.map((day) => (
                    <tr key={day.report_date}>
                      <td>{day.report_date}</td>
                      <td>{day.invoice_count}</td>
                      <td>{formatCurrency(day.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel reports-table-panel">
          <div className="section-heading">
            <div>
              <h3>Top selling medicines</h3>
              <p>Top medicines ranked by sales revenue.</p>
            </div>
          </div>

          {reports.topMedicines.length === 0 ? (
            <div className="table-empty">
              <h4>No medicine sales</h4>
              <p>Medicine performance will appear here after sales.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Units</th>
                    <th>Revenue</th>
                    <th>Gross profit</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.topMedicines.map((medicine) => (
                    <tr key={medicine.medicine_id}>
                      <td>{medicine.medicine_name}</td>
                      <td>{medicine.units_sold}</td>
                      <td>{formatCurrency(medicine.revenue)}</td>
                      <td>{formatCurrency(medicine.gross_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="reports-tables-grid">
        <section className="panel reports-table-panel">
          <div className="section-heading">
            <div>
              <h3>Low stock alerts</h3>
              <p>Medicines that need restocking.</p>
            </div>
            <span className="reports-count">
              {reports.stockAlerts.length}
            </span>
          </div>

          {reports.stockAlerts.length === 0 ? (
            <div className="table-empty">
              <h4>Stock levels look good</h4>
              <p>No low-stock medicines found.</p>
            </div>
          ) : (
            <div className="reports-alert-list">
              {reports.stockAlerts.map((item) => (
                <div className="reports-alert-item" key={item.medicine_id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.generic_name || "No generic name"}</small>
                  </div>
                  <div className="reports-alert-value">
                    <strong>{item.available_quantity}</strong>
                    <small>Minimum: {item.minimum_stock}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel reports-table-panel">
          <div className="section-heading">
            <div>
              <h3>Expiry alerts</h3>
              <p>Expired and soon-to-expire batches.</p>
            </div>
            <span className="reports-count">
              {reports.expiryAlerts.length}
            </span>
          </div>

          {reports.expiryAlerts.length === 0 ? (
            <div className="table-empty">
              <h4>No expiry alerts</h4>
              <p>No expired or soon-to-expire batches found.</p>
            </div>
          ) : (
            <div className="reports-alert-list">
              {reports.expiryAlerts.map((item) => (
                <div className="reports-alert-item" key={item.batch_id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      Batch: {item.batch_number} · Expiry: {item.expiry_date}
                    </small>
                  </div>
                  <div className="reports-alert-value">
                    <strong>
                      {item.expiry_status === "expired"
                        ? "Expired"
                        : "Expiring soon"}
                    </strong>
                    <small>{item.quantity} units</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="reports-disclaimer">
        Gross profit is calculated from recorded sales and item costs. It does
        not include operating expenses, salaries, rent or other overheads.
      </p>
    </>
  ) : (
    <section className="panel table-empty">
      <h4>No report data available</h4>
      <p>Try refreshing the report or selecting another date range.</p>
    </section>
  )}
</div>
          )}
        </section>

        <footer className="app-footer">
          <span>PharmaSathi Desktop</span>
          <span>Local-first pharmacy management</span>
        </footer>
      </main>
    </div>
  );
}

export default App;

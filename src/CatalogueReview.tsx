
import { useCallback, useEffect, useState } from "react";
import "./CatalogueReview.css";

type Medicine = {
  id: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  manufacturer: string;
  category: string;
  barcode: string;
  registrationNumber: string;
  description: string;
  createdAt: string;
};

type PendingResponse = {
  success: boolean;
  message?: string;
  medicines: Medicine[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

function getSourceDetails(description: string) {
  const details: Record<string, string> = {};

  description.split("|").forEach((part) => {
    const separator = part.indexOf(":");

    if (separator === -1) return;

    const label = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();

    if (label && value) details[label] = value;
  });

  return details;
}

function isMissing(value: string) {
  return !value.trim() || value.trim() === "—";
}

export default function CatalogueReview() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Medicine | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/catalogue/review/pending?page=${page}&limit=20&search=${encodeURIComponent(search.trim())}`,
        { credentials: "include" },
      );

      const result = (await response.json()) as PendingResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Could not load pending medicines.");
      }

      setMedicines(Array.isArray(result.medicines) ? result.medicines : []);
      setTotal(result.pagination?.total ?? result.medicines.length);
      setTotalPages(Math.max(1, result.pagination?.totalPages ?? 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPending();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [loadPending]);

  async function submitDecision(decision: "VERIFIED" | "REJECTED") {
    if (!selected || submitting) return;

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/catalogue/review/${encodeURIComponent(selected.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, note: note.trim() }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Review decision failed.");
      }

      setMessage(result.message || `Medicine ${decision.toLowerCase()} successfully.`);
      setSelected(null);
      setNote("");
      await loadPending();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  const source = selected ? getSourceDetails(selected.description) : {};
  const originalComposition = source["original composition"] || "";
  const compositionNeedsReview =
    Boolean(source["composition parsing"]?.toLowerCase().includes("manual review")) ||
    (!selected?.genericName && Boolean(originalComposition));

  const qualityWarnings = selected
    ? [
        isMissing(selected.genericName) ? "Generic name has not been confidently identified." : "",
        isMissing(selected.strength) ? "Strength is missing from normalized data." : "",
        compositionNeedsReview ? "Original composition requires manual review." : "",
        isMissing(selected.manufacturer) ||
        source["manufacturer verification"]?.toLowerCase().includes("missing")
          ? "Manufacturer information requires verification."
          : "",
        isMissing(selected.registrationNumber) ? "DRAP registration number is missing." : "",
      ].filter(Boolean)
    : [];

  return (
    <div className="catalogue-review">
      <div className="catalogue-review-heading">
        <div>
          <span className="section-eyebrow">MASTER MEDICINE DATABASE</span>
          <h2>Catalogue Review</h2>
          <p>Review DRAP catalogue entries before making them available as verified medicines.</p>
        </div>

        <button
          className="secondary-button"
          onClick={() => void loadPending()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      <div className="catalogue-review-stats">
        <div className="panel">
          <span>Pending medicines</span>
          <strong>{total}</strong>
        </div>
        <div className="panel">
          <span>Current page</span>
          <strong>{page} / {totalPages}</strong>
        </div>
      </div>

      {message && <div className="medicine-message success">{message}</div>}
      {error && <div className="medicine-message error">{error}</div>}

      {selected && (
        <section className="panel catalogue-decision-panel">
          <div className="section-heading">
            <div>
              <h3>Review: {selected.brandName}</h3>
              <p>Compare the normalized information with the original DRAP source details.</p>
            </div>

            <button
              className="secondary-button"
              onClick={() => {
                setSelected(null);
                setNote("");
              }}
              disabled={submitting}
            >
              Close
            </button>
          </div>

          {qualityWarnings.length > 0 && (
            <div className="catalogue-quality-warning">
              <strong>Information requiring attention</strong>
              <ul>
                {qualityWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="catalogue-data-section">
            <div className="catalogue-section-title">
              <h4>Normalized medicine information</h4>
              <span>Structured catalogue fields</span>
            </div>

            <div className="catalogue-detail-grid">
              {[
                ["Brand name", selected.brandName],
                ["Generic name", selected.genericName],
                ["Strength", selected.strength],
                ["Dosage form", selected.dosageForm],
                ["Manufacturer", selected.manufacturer],
                ["Category", selected.category],
                ["Barcode", selected.barcode],
                ["DRAP registration", selected.registrationNumber],
              ].map(([label, value]) => (
                <div className="catalogue-detail" key={label}>
                  <span>{label}</span>
                  <strong>{value || "Not provided"}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="catalogue-data-section">
            <div className="catalogue-section-title">
              <h4>Original DRAP source information</h4>
              <span>Preserved source details</span>
            </div>

            <div className="catalogue-detail-grid catalogue-source-grid">
              {[
                ["Original composition", originalComposition],
                ["Source company", source["source company"]],
                ["Source company address", source["source company address"]],
                ["Registration status", source["registration status"]],
                ["Used for", source["used for"]],
                ["Source", source["source"]],
              ].map(([label, value]) => (
                <div className="catalogue-detail" key={label}>
                  <span>{label}</span>
                  <strong>{value || "Not provided"}</strong>
                </div>
              ))}
            </div>
          </div>

          {selected.description && (
            <details className="catalogue-raw-source">
              <summary>View complete stored source description</summary>
              <p>{selected.description}</p>
            </details>
          )}

          <label className="catalogue-note-label" htmlFor="catalogue-review-note">
            Reviewer note (optional)
          </label>

          <textarea
            id="catalogue-review-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="Record verification findings or reasons for your decision..."
            disabled={submitting}
          />

          <div className="catalogue-decision-actions">
            <button
              className="primary-button"
              onClick={() => void submitDecision("VERIFIED")}
              disabled={submitting}
            >
              {submitting ? "Processing..." : "✓ Approve & Verify"}
            </button>

            <button
              className="catalogue-reject-button"
              onClick={() => void submitDecision("REJECTED")}
              disabled={submitting}
            >
              Reject
            </button>
          </div>
        </section>
      )}

      <section className="panel catalogue-list-panel">
        <div className="section-heading">
          <div>
            <h3>Pending review queue</h3>
            <p>Only active medicines awaiting review are shown.</p>
          </div>
          <span className="demo-label">PENDING</span>
        </div>

        <div className="catalogue-search">
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search brand, generic, manufacturer, barcode or DRAP registration..."
            aria-label="Search pending medicines"
          />
          {search && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
            >
              Clear
            </button>
          )}
        </div>

        <p className="catalogue-search-count">
          {search.trim()
            ? `${total} matching pending medicine(s)`
            : `${total} pending medicine(s)`}
        </p>

        {loading ? (
          <p className="catalogue-state">Loading catalogue...</p>
        ) : medicines.length === 0 ? (
          <p className="catalogue-state">{search.trim() ? "No matching pending medicines found. Try another search." : "No pending medicines found."}</p>
        ) : (
          <div className="catalogue-table-wrap">
            <table className="catalogue-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Generic / Strength</th>
                  <th>Dosage form</th>
                  <th>Manufacturer</th>
                  <th>DRAP Reg. No.</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {medicines.map((medicine) => (
                  <tr key={medicine.id}>
                    <td><strong>{medicine.brandName}</strong></td>
                    <td>
                      {[medicine.genericName, medicine.strength]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td>{medicine.dosageForm || "—"}</td>
                    <td>{medicine.manufacturer || "—"}</td>
                    <td>{medicine.registrationNumber || "—"}</td>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setSelected(medicine);
                          setNote("");
                          setMessage("");
                        }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="catalogue-pagination">
          <button
            className="secondary-button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </button>

          <span>Page {page} of {totalPages}</span>

          <button
            className="secondary-button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

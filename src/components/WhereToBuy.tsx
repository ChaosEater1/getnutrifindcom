import { useState } from "react";
import type { Product } from "@/lib/nutrifind";
import { useLocation } from "@/hooks/useLocation";

interface Props {
  item: Product;
  variant?: "light" | "dark";
}

function parseStores(raw?: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/,|;/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()))
    )
  ).slice(0, 8);
}

function mapsUrl(store: string, area: string, productName?: string) {
  const q = `${store} ${area}${productName ? " " + productName : ""}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function WhereToBuy({ item, variant = "light" }: Props) {
  const { location, requesting, error, requestGeo, setManual, clear } = useLocation();
  const [manualInput, setManualInput] = useState("");
  const [showManual, setShowManual] = useState(false);

  const stores = parseStores(item.stores);
  const isDark = variant === "dark";

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      setManual(manualInput);
      setManualInput("");
      setShowManual(false);
    }
  };

  return (
    <div className={`buy-block ${isDark ? "dark" : ""}`}>
      <h4 className="buy-title">📍 Where to buy</h4>

      {!location && (
        <div className="buy-locate">
          <p className="buy-sub">Set your area to find nearby stockists.</p>
          <div className="buy-actions">
            <button
              className="buy-btn primary"
              onClick={requestGeo}
              disabled={requesting}
              type="button"
            >
              {requesting ? "Locating…" : "📡 Use my location"}
            </button>
            <button
              className="buy-btn ghost"
              onClick={() => setShowManual((s) => !s)}
              type="button"
            >
              ✏️ Enter manually
            </button>
          </div>
          {showManual && (
            <form onSubmit={submitManual} className="buy-manual">
              <input
                className="buy-input"
                type="text"
                placeholder="Postcode or city (e.g. SW1A 1AA)"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                autoFocus
              />
              <button type="submit" className="buy-btn primary small">
                Save
              </button>
            </form>
          )}
          {error && <div className="buy-error">{error}</div>}
        </div>
      )}

      {location && (
        <>
          <div className="buy-area">
            <span>
              📍 <strong>{location.label}</strong>
            </span>
            <button className="buy-link" onClick={clear} type="button">
              Change
            </button>
          </div>

          {stores.length === 0 ? (
            <div className="buy-empty">
              No store data reported for this product yet. Try searching:
              <div className="buy-fallback">
                <a
                  className="store-chip"
                  href={mapsUrl("supermarket", location.label, item.product_name)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🏪 Nearby supermarkets
                </a>
              </div>
            </div>
          ) : (
            <>
              <p className="buy-sub">Reported stockists — tap to find one near you:</p>
              <div className="store-list">
                {stores.map((s) => (
                  <a
                    key={s}
                    href={mapsUrl(s, location.label, item.product_name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="store-chip"
                  >
                    🛒 {s}
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

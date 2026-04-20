import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  type Product,
  type ScoredProduct,
  calcScore,
  fakePrice,
  fmt,
  kcal,
  passesFilters,
  scanAdditives,
  scoreClass,
  scoreWord,
} from "@/lib/nutrifind";
import { ProductDetail } from "@/components/ProductDetail";
import { WhereToBuy } from "@/components/WhereToBuy";
import { AiTip } from "@/components/AiTip";
import { fetchNutritionTip } from "@/lib/aiTip";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NutriFind — Eat smarter, shop better" },
      {
        name: "description",
        content:
          "Search any food and compare real nutrition data across products, ranked by a transparent health score with additive-aware analysis.",
      },
    ],
  }),
  component: NutriFindPage,
});

const QUICK = ["Granola", "Greek Yogurt", "Protein Bar", "Bread", "Oat Milk", "Chicken", "Eggs"];
type SearchMode = "ingredient" | "meal";
const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "ingredient", label: "🥩 Just the ingredient", hint: "e.g. plain beef to cook with" },
  { id: "meal", label: "🍔 Meal / prepared product", hint: "e.g. beef burger, ready meal" },
];
const FILTERS: { id: string; label: string }[] = [
  { id: "high_protein", label: "💪 High Protein" },
  { id: "low_sugar", label: "🍬 Low Sugar" },
  { id: "high_fibre", label: "🌿 High Fibre" },
  { id: "vegan", label: "🌱 Vegan" },
  { id: "no_additives", label: "⚠️ No Flagged Additives" },
];

function NutriFindPage() {
  const [query, setQuery] = useState("");
  const [rawResults, setRaw] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [expanded, setExpanded] = useState<string | number | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const [mode, setMode] = useState<SearchMode>("ingredient");
  const [aiTip, setAiTip] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadAiTip = useCallback(async (term: string) => {
    setAiLoading(true);
    setAiTip("");
    setAiError(null);
    try {
      const result = await fetchNutritionTip({ data: { query: term } });
      if (result.error) setAiError(result.error);
      else setAiTip(result.tip);
    } catch {
      setAiError("Couldn't fetch nutritionist tip.");
    } finally {
      setAiLoading(false);
    }
  }, []);

  const doSearch = useCallback(
    async (q?: string, modeOverride?: SearchMode) => {
      const term = (q ?? query).trim();
      if (!term) return;
      const activeMode = modeOverride ?? mode;
      setLoading(true);
      setError(null);
      setRaw([]);
      setSearched(true);
      setExpanded(null);
      setFilters([]);

      // Kick off the AI tip in parallel
      loadAiTip(term);

      const refinedTerm = activeMode === "meal" ? term : `${term} raw fresh`;

      try {
        const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
          refinedTerm
        )}&search_simple=1&action=process&json=1&page_size=30&lc=en&fields=product_name,product_name_en,brands,nutriments,nutriscore_grade,ingredients_text,ingredients_text_en,labels_tags,code,quantity,stores,stores_tags,image_small_url`;
        const res = await fetch(url);
        const data = await res.json();
        const products: Product[] = (data.products || [])
          .map((p: Product & { product_name_en?: string }) => ({
            ...p,
            product_name: p.product_name_en || p.product_name,
            ingredients_text: p.ingredients_text_en || p.ingredients_text,
          }))
          .filter((p: Product) => p.product_name && p.nutriments)
          .slice(0, 20);
        setRaw(products);
      } catch {
        setError("Couldn't load results. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [query, mode, loadAiTip]
  );

  const toggleFilter = (id: string) =>
    setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const scored: ScoredProduct[] = rawResults
    .map((p) => ({
      ...p,
      _score: calcScore(p.nutriments || {}, p),
      _additives: scanAdditives(p.ingredients_text),
    }))
    .filter((p) => passesFilters(p, filters))
    .sort((a, b) => b._score - a._score);

  const topPick = scored[0] || null;
  const rest = scored.slice(1);

  return (
    <div className="app">
      {/* HERO */}
      <header className="hero">
        <div className="hero-eyebrow">🌿 NutriFind</div>
        <h1 className="hero-title">
          Eat smarter,
          <br />
          <em>shop better.</em>
        </h1>
        <p className="hero-sub">
          Real products · real ingredients · additive-aware health scores.
        </p>

        <div className="search-wrap">
          <div className="search-bar">
            <input
              className="search-input"
              type="text"
              placeholder="Search granola, yogurt, bread…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
            />
            <button
              className="search-btn"
              onClick={() => doSearch()}
              disabled={loading}
              aria-label="Search"
            >
              {loading ? "…" : "🔍 Search"}
            </button>
          </div>

          <div className="mode-toggle" role="radiogroup" aria-label="Search type">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                className={`mode-btn ${mode === m.id ? "active" : ""}`}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="quick-chips">
            {QUICK.map((q) => (
              <button
                key={q}
                className="chip"
                onClick={() => {
                  setQuery(q);
                  doSearch(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="main">
        {searched && <AiTip loading={aiLoading} tip={aiTip} error={aiError} />}

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <div className="loading-text">Fetching real product data…</div>
          </div>
        )}

        {!loading && error && <div className="error-box">⚠️ {error}</div>}

        {!loading && !searched && !error && (
          <div className="empty">
            <div className="empty-icon">🥗</div>
            <h2 className="empty-title">What are you shopping for?</h2>
            <p className="empty-sub">
              Search any food above or tap a quick search to see real nutrition data ranked by
              health score — with watchful eyes on additives.
            </p>
          </div>
        )}

        {!loading && searched && !error && (
          <>
            {rawResults.length > 0 && (
              <div className="filter-bar">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    className={`filter-btn ${filters.includes(f.id) ? "active" : ""}`}
                    onClick={() => toggleFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {scored.length === 0 && (
              <div className="no-results">
                <div className="empty-icon">🔍</div>
                <h2 className="empty-title">No matches</h2>
                <p className="empty-sub">Try a different search term or remove a filter.</p>
              </div>
            )}

            {topPick && (
              <>
                <h3 className="sec-title">Best Choice</h3>
                <p className="sec-sub">Highest health score for "{query}"</p>
                {(() => {
                  const n = topPick.nutriments || {};
                  const sc = topPick._score;
                  const isOpen = expanded === "top";
                  const additives = topPick._additives || [];
                  return (
                    <section className="top-card">
                      <div className="top-card-eyebrow">🏆 Recommended</div>
                      <h2 className="top-card-name">{topPick.product_name}</h2>
                      <div className="top-card-brand">
                        {topPick.brands || "Unknown brand"}
                        {topPick.quantity ? ` · ${topPick.quantity}` : ""}
                      </div>

                      {topPick.image_small_url && (
                        <img
                          src={topPick.image_small_url}
                          alt={topPick.product_name}
                          className="top-card-img"
                          loading="lazy"
                        />
                      )}

                      <div className="nutr-grid">
                        <div className="nutr-cell">
                          <div className="nutr-val">{kcal(n)}</div>
                          <div className="nutr-lbl">kcal</div>
                        </div>
                        <div className="nutr-cell">
                          <div className="nutr-val">{fmt(n.proteins_100g, "g")}</div>
                          <div className="nutr-lbl">protein</div>
                        </div>
                        <div className="nutr-cell">
                          <div className="nutr-val">{fmt(n.carbohydrates_100g, "g")}</div>
                          <div className="nutr-lbl">carbs</div>
                        </div>
                        <div className="nutr-cell">
                          <div className="nutr-val">{fmt(n.fat_100g, "g")}</div>
                          <div className="nutr-lbl">fat</div>
                        </div>
                      </div>

                      {additives.length > 0 ? (
                        <div className="additive-summary danger">
                          ⚠️ {additives.length} flagged additive{additives.length > 1 ? "s" : ""}
                        </div>
                      ) : topPick.ingredients_text ? (
                        <div className="additive-summary clean">✓ No flagged additives</div>
                      ) : null}

                      <div className="top-card-footer">
                        <div className="score-row">
                          <div className={`score-ring ring-${scoreClass(sc)}`}>{sc}</div>
                          <div className="score-meta">
                            <div className="score-meta-lbl">Health Score</div>
                            <div className="score-meta-val">{scoreWord(sc)}</div>
                          </div>
                        </div>
                        <div className="top-price">
                          <div className="top-price-amt">~£{fakePrice(topPick.code)}</div>
                          <div className="top-price-per">est. price</div>
                        </div>
                      </div>

                      <WhereToBuy item={topPick} variant="dark" />

                      <div
                        className="expand-toggle"
                        onClick={() => setExpanded(isOpen ? null : "top")}
                      >
                        {isOpen ? "▲ Hide details" : "▼ Full breakdown"}
                      </div>

                      {isOpen && <ProductDetail item={topPick} variant="dark" />}
                    </section>
                  );
                })()}
              </>
            )}

            {rest.length > 0 && (
              <>
                <h3 className="sec-title">All Options</h3>
                <p className="sec-sub">Tap any item for the full breakdown</p>
                <div className="results-list">
                  {rest.map((item, i) => {
                    const sc = item._score;
                    const cls = scoreClass(sc);
                    const isOpen = expanded === i;
                    const pillClass =
                      cls === "high" ? "pill-green" : cls === "mid" ? "pill-amber" : "pill-red";
                    const additiveCount = item._additives?.length || 0;
                    return (
                      <article key={(item.code || "") + i} className="result-card">
                        <div
                          className="result-card-top"
                          onClick={() => setExpanded(isOpen ? null : i)}
                        >
                          <div className="result-rank">#{i + 2}</div>
                          {item.image_small_url && (
                            <img
                              src={item.image_small_url}
                              alt=""
                              className="result-thumb"
                              loading="lazy"
                            />
                          )}
                          <div className="result-info">
                            <div className="result-name">{item.product_name}</div>
                            <div className="result-meta">
                              <span>{item.brands || "Unknown"}</span>
                              {item.quantity && (
                                <>
                                  <span>·</span>
                                  <span>{item.quantity}</span>
                                </>
                              )}
                              <span className={`pill ${pillClass}`}>{scoreWord(sc)}</span>
                              {additiveCount > 0 && (
                                <span className="pill pill-red">⚠️ {additiveCount}</span>
                              )}
                            </div>
                          </div>
                          <div className="result-right">
                            <div className="result-price">~£{fakePrice(item.code)}</div>
                            <div className={`score-dot ring-${cls}`}>{sc}</div>
                          </div>
                        </div>
                        {isOpen && <ProductDetail item={item} variant="light" />}
                      </article>
                    );
                  })}
                </div>
              </>
            )}

            {scored.length > 0 && (
              <p className="price-disclaimer">
                💡 Prices shown are rough estimates only — actual in-store and online prices vary
                by retailer, location, and offers.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

import { type ScoredProduct, kcal, fmt, buildExplanation } from "@/lib/nutrifind";
import { WhereToBuy } from "@/components/WhereToBuy";

interface Props {
  item: ScoredProduct;
  variant?: "light" | "dark";
}

export function ProductDetail({ item, variant = "light" }: Props) {
  const n = item.nutriments || {};
  const ingrs = (item.ingredients_text || "")
    .split(/,|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 14);

  const additives = item._additives || [];
  const { good, bad, summary } = buildExplanation(item);

  const nutrCells: Array<[string, string, string]> = [
    ["🔥", kcal(n), "Calories"],
    ["💪", fmt(n.proteins_100g, "g"), "Protein"],
    ["🌾", fmt(n.carbohydrates_100g, "g"), "Carbs"],
    ["🧈", fmt(n.fat_100g, "g"), "Fat"],
    ["🌿", fmt(n.fiber_100g, "g"), "Fibre"],
    ["🍬", fmt(n.sugars_100g, "g"), "Sugar"],
    ["🧂", fmt(n.salt_100g, "g"), "Salt"],
  ];

  return (
    <div className={`expand-panel ${variant === "dark" ? "dark" : ""}`}>
      <h4>Nutrition per 100g</h4>
      <div className="nutr-row">
        {nutrCells.map(([emoji, val, label]) => (
          <span key={label} className="nutr-pill">
            <span>{emoji}</span>
            <strong>{val}</strong>
            <span style={{ opacity: 0.7 }}>{label}</span>
          </span>
        ))}
      </div>

      {additives.length > 0 && (
        <>
          <h4>⚠️ Flagged Additives</h4>
          <div className="additive-list">
            {additives.map((a) => (
              <div key={a.name} className={`additive-item severity-${a.severity}`}>
                <div className="additive-head">
                  <strong>{a.name}</strong>
                  <span className={`additive-badge sev-${a.severity}`}>
                    {a.severity} risk · −{a.penalty} pts
                  </span>
                </div>
                <p className="additive-note">{a.note}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {ingrs.length > 0 && (
        <>
          <h4>Ingredients</h4>
          <div className="ingr-list">
            {ingrs.map((i, idx) => (
              <span key={`i-${idx}`} className="ingr-tag">
                {i}
              </span>
            ))}
          </div>
        </>
      )}

      <h4>What this means</h4>
      <div
        className={
          item._score >= 65 ? "highlight-box" : item._score >= 42 ? "warning-box" : "danger-box"
        }
      >
        {summary}
      </div>

      {good.length > 0 && (
        <div className="highlight-box">
          <strong>✅ Good:</strong>
          <ul style={{ paddingLeft: 18, marginTop: 4 }}>
            {good.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {bad.length > 0 && (
        <div className="warning-box">
          <strong>⚠️ Watch out:</strong>
          <ul style={{ paddingLeft: 18, marginTop: 4 }}>
            {bad.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <WhereToBuy item={item} variant={variant} />
    </div>
  );
}

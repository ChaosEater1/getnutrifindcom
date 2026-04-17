// Nutrition scoring + helpers for NutriFind

export type Nutriments = {
  energy_100g?: number;
  energy_kcal_100g?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  "saturated-fat_100g"?: number;
  sugars_100g?: number;
  salt_100g?: number;
  fiber_100g?: number;
};

export type Product = {
  product_name?: string;
  brands?: string;
  nutriments?: Nutriments;
  ingredients_text?: string;
  labels_tags?: string[];
  code?: string;
  quantity?: string;
};

export type ScoredProduct = Product & { _score: number };

export function calcScore(n: Nutriments): number {
  let s = 50;
  const protein = n.proteins_100g ?? 0;
  const fibre = n.fiber_100g ?? 0;
  const sugar = n.sugars_100g ?? 0;
  const satFat = n["saturated-fat_100g"] ?? 0;
  const salt = n.salt_100g ?? 0;
  const energy = n.energy_100g ?? 0;

  if (protein >= 20) s += 18;
  else if (protein >= 10) s += 10;
  else if (protein >= 5) s += 4;

  if (fibre >= 6) s += 15;
  else if (fibre >= 3) s += 8;
  else if (fibre >= 1) s += 3;

  if (sugar > 20) s -= 18;
  else if (sugar > 10) s -= 9;
  else if (sugar > 5) s -= 4;

  if (satFat > 10) s -= 15;
  else if (satFat > 5) s -= 7;

  if (salt > 1.5) s -= 10;
  else if (salt > 0.5) s -= 4;

  if (energy > 2500) s -= 8;

  return Math.min(100, Math.max(0, Math.round(s)));
}

export function scoreClass(s: number): "high" | "mid" | "low" {
  return s >= 68 ? "high" : s >= 42 ? "mid" : "low";
}

export function scoreWord(s: number): string {
  return s >= 80 ? "Excellent" : s >= 65 ? "Good" : s >= 42 ? "Fair" : "Poor";
}

export function kcal(n: Nutriments): string {
  const e = n.energy_kcal_100g ?? (n.energy_100g ? Math.round(n.energy_100g / 4.184) : null);
  return e ? `${Math.round(e)} kcal` : "—";
}

export function fmt(v: number | undefined, unit: string): string {
  return v != null ? `${Math.round(v * 10) / 10}${unit}` : "—";
}

export function passesFilters(item: Product, active: string[]): boolean {
  if (!active.length) return true;
  const n = item.nutriments || {};
  for (const f of active) {
    if (f === "high_protein" && (n.proteins_100g || 0) < 10) return false;
    if (f === "low_sugar" && (n.sugars_100g || 0) > 8) return false;
    if (f === "high_fibre" && (n.fiber_100g || 0) < 3) return false;
    if (f === "vegan") {
      const labels = (item.labels_tags || []).join(" ") + " " + (item.ingredients_text || "").toLowerCase();
      if (!labels.includes("vegan") && !labels.includes("plant")) return false;
    }
  }
  return true;
}

export function fakePrice(code?: string): string {
  const n = parseInt((code || "123456").slice(-4), 10) || 1234;
  return ((n % 800) / 100 + 0.99).toFixed(2);
}

export function buildExplanation(item: ScoredProduct): {
  good: string[];
  bad: string[];
  summary: string;
} {
  const n = item.nutriments || {};
  const good: string[] = [];
  const bad: string[] = [];

  const protein = n.proteins_100g ?? 0;
  const fibre = n.fiber_100g ?? 0;
  const sugar = n.sugars_100g ?? 0;
  const satFat = n["saturated-fat_100g"] ?? 0;
  const salt = n.salt_100g ?? 0;

  if (protein >= 15) good.push(`High in protein (${fmt(protein, "g")} per 100g) — great for satiety and muscle.`);
  else if (protein >= 8) good.push(`Decent protein content (${fmt(protein, "g")} per 100g).`);

  if (fibre >= 6) good.push(`Excellent fibre (${fmt(fibre, "g")} per 100g) — supports digestion.`);
  else if (fibre >= 3) good.push(`Good source of fibre (${fmt(fibre, "g")} per 100g).`);

  if (sugar <= 5) good.push(`Low in sugar (${fmt(sugar, "g")} per 100g).`);
  if (satFat <= 1.5) good.push(`Low saturated fat (${fmt(satFat, "g")} per 100g).`);
  if (salt <= 0.3) good.push(`Low salt content (${fmt(salt, "g")} per 100g).`);

  if (sugar > 15) bad.push(`Very high sugar (${fmt(sugar, "g")} per 100g) — limit intake.`);
  else if (sugar > 8) bad.push(`Notable sugar (${fmt(sugar, "g")} per 100g).`);

  if (satFat > 8) bad.push(`High saturated fat (${fmt(satFat, "g")} per 100g).`);
  else if (satFat > 5) bad.push(`Moderate saturated fat (${fmt(satFat, "g")} per 100g).`);

  if (salt > 1.5) bad.push(`High salt (${fmt(salt, "g")} per 100g) — watch portion size.`);
  else if (salt > 0.8) bad.push(`Moderate salt (${fmt(salt, "g")} per 100g).`);

  let summary = "";
  if (item._score >= 80) summary = "An excellent choice — strong nutrient profile with no major red flags.";
  else if (item._score >= 65) summary = "A solid healthy pick — good nutritional balance overall.";
  else if (item._score >= 42) summary = "An okay choice — fine in moderation, but check the flagged areas.";
  else summary = "Low health score — high in sugar, salt, or saturated fat. Best as an occasional treat.";

  return { good, bad, summary };
}

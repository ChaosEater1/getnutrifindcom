// Nutrition scoring + helpers for NutriFind

export type Nutriments = {
  energy_100g?: number;
  energy_kcal_100g?: number;
  "energy-kcal_100g"?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  "saturated-fat_100g"?: number;
  sugars_100g?: number;
  salt_100g?: number;
  fiber_100g?: number;
};

export type ProductSource = "OFF" | "USDA";

export type Product = {
  product_name?: string;
  brands?: string;
  nutriments?: Nutriments;
  ingredients_text?: string;
  ingredients_text_en?: string;
  labels_tags?: string[];
  code?: string;
  quantity?: string;
  stores?: string;
  stores_tags?: string[];
  nutriscore_grade?: string;
  image_small_url?: string;
  _source?: ProductSource;
  _usdaPatched?: boolean;
  _fdcId?: number;
};

export type AdditiveSeverity = "high" | "medium" | "low";

export type Additive = {
  codes: string[];
  name: string;
  severity: AdditiveSeverity;
  penalty: number;
  note: string;
};

export type ScoredProduct = Product & {
  _score: number;
  _additives: Additive[];
};

export const ADDITIVE_WATCHLIST: Additive[] = [
  { codes: ["e250", "sodium nitrite", "e251", "sodium nitrate"], name: "Sodium Nitrite/Nitrate", severity: "high", penalty: 15, note: "Linked to increased colorectal cancer risk at high intake. Common in processed meats." },
  { codes: ["e320", "bha", "butylated hydroxyanisole"], name: "BHA (E320)", severity: "high", penalty: 12, note: "Synthetic antioxidant, classified as possibly carcinogenic by IARC." },
  { codes: ["e321", "bht", "butylated hydroxytoluene"], name: "BHT (E321)", severity: "medium", penalty: 8, note: "Controversial synthetic preservative. Some studies show hormonal disruption in animals." },
  { codes: ["e211", "sodium benzoate"], name: "Sodium Benzoate (E211)", severity: "medium", penalty: 8, note: "Can react with vitamin C to form benzene. Linked to hyperactivity in children." },
  { codes: ["e621", "monosodium glutamate", "msg"], name: "MSG (E621)", severity: "low", penalty: 3, note: "Generally recognised as safe, but some individuals report sensitivity." },
  { codes: ["e407", "carrageenan"], name: "Carrageenan (E407)", severity: "medium", penalty: 7, note: "Some evidence links it to gut inflammation and digestive issues." },
  { codes: ["e951", "aspartame"], name: "Aspartame (E951)", severity: "medium", penalty: 6, note: "Classified as 'possibly carcinogenic' by WHO in 2023. Avoid with PKU." },
  { codes: ["e950", "acesulfame", "acesulfame-k", "acesulfame potassium"], name: "Acesulfame-K (E950)", severity: "low", penalty: 4, note: "Artificial sweetener with limited long-term safety data." },
  { codes: ["e122", "carmoisine", "azorubine"], name: "Carmoisine (E122)", severity: "medium", penalty: 7, note: "Azo dye linked to hyperactivity in children. Banned in some countries." },
  { codes: ["e102", "tartrazine"], name: "Tartrazine (E102)", severity: "medium", penalty: 7, note: "Yellow food dye associated with hyperactivity and allergic reactions." },
  { codes: ["e110", "sunset yellow"], name: "Sunset Yellow (E110)", severity: "medium", penalty: 7, note: "Artificial dye linked to hyperactivity. Requires warning label in the EU." },
  { codes: ["e129", "allura red"], name: "Allura Red (E129)", severity: "medium", penalty: 6, note: "Red dye linked to hyperactivity in children. Part of the 'Southampton Six'." },
  { codes: ["high fructose corn syrup", "hfcs", "glucose-fructose syrup"], name: "High-Fructose Corn Syrup", severity: "high", penalty: 12, note: "Heavily processed sugar linked to obesity, insulin resistance, and fatty liver disease." },
  { codes: ["e150d", "sulfite ammonia caramel"], name: "Caramel Colour (E150d)", severity: "low", penalty: 4, note: "Class IV caramel colour contains 4-MEI, a potential carcinogen." },
  { codes: ["e282", "calcium propionate"], name: "Calcium Propionate (E282)", severity: "low", penalty: 3, note: "Bread preservative; some studies suggest links to behavioural issues in children." },
  { codes: ["potassium bromate", "e924"], name: "Potassium Bromate (E924)", severity: "high", penalty: 15, note: "Flour improver banned in the EU and UK. Possible human carcinogen." },
  { codes: ["partially hydrogenated", "hydrogenated vegetable oil", "hydrogenated palm"], name: "Hydrogenated Oils (Trans Fats)", severity: "high", penalty: 14, note: "Trans fats raise LDL cholesterol and lower HDL. Strongly linked to heart disease." },
];

export function scanAdditives(ingredientsText?: string): Additive[] {
  if (!ingredientsText) return [];
  const lower = ingredientsText.toLowerCase();
  const found: Additive[] = [];
  for (const additive of ADDITIVE_WATCHLIST) {
    for (const code of additive.codes) {
      if (lower.includes(code)) {
        found.push(additive);
        break;
      }
    }
  }
  return found;
}

export function calcScore(n: Nutriments, product?: Product): number {
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

  // Nutri-Score bonus
  const ns = (product?.nutriscore_grade || "").toLowerCase();
  if (ns === "a") s += 10;
  else if (ns === "b") s += 5;
  else if (ns === "d") s -= 5;
  else if (ns === "e") s -= 10;

  // Additive penalty
  if (product) {
    const flagged = scanAdditives(product.ingredients_text);
    for (const a of flagged) s -= a.penalty;
  }

  return Math.min(100, Math.max(0, Math.round(s)));
}

export function scoreClass(s: number): "high" | "mid" | "low" {
  return s >= 68 ? "high" : s >= 42 ? "mid" : "low";
}

export function scoreWord(s: number): string {
  return s >= 80 ? "Excellent" : s >= 65 ? "Good" : s >= 42 ? "Fair" : "Poor";
}

export function kcal(n: Nutriments): string {
  const e = n.energy_kcal_100g ?? n["energy-kcal_100g"] ?? (n.energy_100g ? Math.round(n.energy_100g / 4.184) : null);
  return e ? `${Math.round(e)} kcal` : "—";
}

export function fmt(v: number | undefined, unit: string): string {
  return v != null ? `${Math.round(v * 10) / 10}${unit}` : "—";
}

export function passesFilters(item: ScoredProduct, active: string[]): boolean {
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
    if (f === "no_additives" && (item._additives?.length || 0) > 0) return false;
    if (f === "usda_only" && item._source !== "USDA") return false;
    if (f === "off_only" && item._source !== "OFF") return false;
  }
  return true;
}

// ─── USDA FoodData Central ────────────────────────────────────────────────────
// DEMO_KEY works for low-volume testing (~30 req/hr). Get a free key at
// https://fdc.nal.usda.gov/api-guide.html for higher limits.
const USDA_API_KEY = "DEMO_KEY";

const USDA_IDS = {
  kcal: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sugar: 2000,
  satFat: 1258,
  sodium: 1093,
} as const;

type UsdaNutrient = {
  nutrientId?: number;
  nutrient?: { id?: number };
  value?: number;
  amount?: number;
};

type UsdaFood = {
  fdcId?: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  foodNutrients?: UsdaNutrient[];
};

function extractUsdaNutrients(foodNutrients?: UsdaNutrient[]): Nutriments {
  const m: Record<number, number> = {};
  for (const n of foodNutrients || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    if (id != null) m[id] = n.value ?? n.amount ?? 0;
  }
  const sodiumMg = m[USDA_IDS.sodium] || 0;
  return {
    "energy-kcal_100g": m[USDA_IDS.kcal] || 0,
    proteins_100g: m[USDA_IDS.protein] || 0,
    fat_100g: m[USDA_IDS.fat] || 0,
    carbohydrates_100g: m[USDA_IDS.carbs] || 0,
    fiber_100g: m[USDA_IDS.fiber] || 0,
    sugars_100g: m[USDA_IDS.sugar] || 0,
    "saturated-fat_100g": m[USDA_IDS.satFat] || 0,
    salt_100g: (sodiumMg * 2.5) / 1000,
  };
}

function normaliseUsda(food: UsdaFood): Product {
  return {
    product_name: food.description,
    brands: food.brandOwner || food.brandName || "",
    ingredients_text: food.ingredients || "",
    nutriments: extractUsdaNutrients(food.foodNutrients),
    nutriscore_grade: "",
    labels_tags: [],
    _source: "USDA",
    _fdcId: food.fdcId,
    code: food.fdcId ? `usda-${food.fdcId}` : undefined,
  };
}

export async function fetchUsda(query: string): Promise<Product[]> {
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(
      query
    )}&dataType=Branded,SR%20Legacy,Foundation&pageSize=15&api_key=${USDA_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { foods?: UsdaFood[] };
    return (data.foods || [])
      .filter((f) => f.description)
      .map(normaliseUsda);
  } catch {
    return [];
  }
}

export function mergeProductSources(off: Product[], usda: Product[]): Product[] {
  const merged: Product[] = [];
  const keyOf = (p: Product) => (p.product_name || "").toLowerCase().trim();
  const seen = new Set<string>();

  for (const p of off) {
    const k = keyOf(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push({ ...p, _source: "OFF" });
  }

  for (const p of usda) {
    const k = keyOf(p);
    if (!k) continue;
    const existing = merged.find((o) => keyOf(o) === k);
    if (existing) {
      const n = existing.nutriments || {};
      const u = p.nutriments || {};
      const fields: (keyof Nutriments)[] = [
        "proteins_100g",
        "fiber_100g",
        "sugars_100g",
        "saturated-fat_100g",
        "salt_100g",
        "energy-kcal_100g",
        "carbohydrates_100g",
        "fat_100g",
      ];
      let patched = false;
      const next: Nutriments = { ...n };
      for (const f of fields) {
        if ((next[f] == null || next[f] === 0) && u[f]) {
          next[f] = u[f];
          patched = true;
        }
      }
      if (patched) {
        existing.nutriments = next;
        existing._usdaPatched = true;
      }
      if (!existing.ingredients_text && p.ingredients_text) {
        existing.ingredients_text = p.ingredients_text;
      }
    } else if (!seen.has(k)) {
      seen.add(k);
      merged.push(p);
    }
  }

  return merged;
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

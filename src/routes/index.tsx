// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NutriFind — Eat smarter, shop better" },
      {
        name: "description",
        content:
          "Search any food and compare real nutrition data across products, ranked by a transparent, additive-aware health score personalised to your goals.",
      },
    ],
  }),
  component: NutriFind,
});

const USDA_API_KEY = "DEMO_KEY";
const LS_PROFILE = "nutrifind_profile";
const LS_SAVED = "nutrifind_saved";
function lsGet(key, fallback) { try { const v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function lsSet(key, val) { try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(val)); } catch {} }

const SEARCH_MODES = [
  { id: "ingredient", label: "Ingredient", icon: "🥦", desc: "Raw or whole foods — chicken, oats, spinach, almonds" },
  { id: "meal", label: "Prepared Meal", icon: "🍱", desc: "Packaged or ready-made — lasagne, soup, protein bars, cereal" },
];

function detectMode(product) {
  const name = (product.product_name || "").toLowerCase();
  const ingredients = (product.ingredients_text || "").toLowerCase();
  const ingredientCount = ingredients ? ingredients.split(",").length : 0;
  const mealKeywords = ["lasagne","lasagna","soup","stew","curry","pizza","pasta dish","ready meal","prepared","frozen meal","dinner","entree","entrée","sandwich","wrap","burger","nugget","finger","casserole","pot pie","mac and cheese","macaroni and cheese"];
  const ingredientKeywords = ["raw","fresh","whole","organic","plain","natural","unprocessed"];
  if (mealKeywords.some(k => name.includes(k))) return "meal";
  if (ingredientKeywords.some(k => name.includes(k))) return "ingredient";
  if (ingredientCount > 10) return "meal";
  if (ingredientCount <= 3 && ingredientCount > 0) return "ingredient";
  return null;
}

function calcProcessingLevel(ingredientsText) {
  if (!ingredientsText) return null;
  const count = ingredientsText.split(",").length;
  if (count <= 3) return { label: "Minimal Processing", color: "#2d6a4f", score: 3 };
  if (count <= 8) return { label: "Lightly Processed", color: "#74c69d", score: 2 };
  if (count <= 15) return { label: "Moderately Processed", color: "#f4a261", score: 1 };
  return { label: "Highly Processed", color: "#e63946", score: 0 };
}

function calcMealCompleteness(n) {
  const protein = n.proteins_100g || 0;
  const carbs = n.carbohydrates_100g || 0;
  const fat = n.fat_100g || 0;
  const fibre = n.fiber_100g || n.fibre_100g || 0;
  let pts = 0;
  if (protein >= 8) pts++;
  if (carbs >= 15 && carbs <= 60) pts++;
  if (fat >= 3 && fat <= 20) pts++;
  if (fibre >= 2) pts++;
  const labels = ["Incomplete","Minimal","Moderate","Good","Complete"];
  const colors = ["#e63946","#f4a261","#f4a261","#74c69d","#2d6a4f"];
  return { label: labels[pts], color: colors[pts], pts };
}

const ADDITIVE_WATCHLIST = [
  { codes: ["e250","sodium nitrite","e251","sodium nitrate"], name: "Sodium Nitrite/Nitrate", severity: "high", penalty: 15, mealPenalty: 10, note: "Linked to increased colorectal cancer risk at high intake. Common in processed meats." },
  { codes: ["e320","bha","butylated hydroxyanisole"], name: "BHA (E320)", severity: "high", penalty: 12, mealPenalty: 9, note: "Synthetic antioxidant, classified as possibly carcinogenic by IARC." },
  { codes: ["e321","bht","butylated hydroxytoluene"], name: "BHT (E321)", severity: "medium", penalty: 8, mealPenalty: 6, note: "Controversial synthetic preservative. Some studies show hormonal disruption in animals." },
  { codes: ["e211","sodium benzoate"], name: "Sodium Benzoate (E211)", severity: "medium", penalty: 8, mealPenalty: 6, note: "Can react with vitamin C to form benzene. Linked to hyperactivity in children." },
  { codes: ["e621","monosodium glutamate","msg"], name: "MSG (E621)", severity: "low", penalty: 3, mealPenalty: 2, note: "Generally recognised as safe, but some individuals report sensitivity." },
  { codes: ["e407","carrageenan"], name: "Carrageenan (E407)", severity: "medium", penalty: 7, mealPenalty: 5, note: "Some evidence links it to gut inflammation and digestive issues." },
  { codes: ["e951","aspartame"], name: "Aspartame (E951)", severity: "medium", penalty: 6, mealPenalty: 5, note: "Classified as 'possibly carcinogenic' by WHO in 2023. Avoid with PKU." },
  { codes: ["e950","acesulfame","acesulfame-k","acesulfame potassium"], name: "Acesulfame-K (E950)", severity: "low", penalty: 4, mealPenalty: 3, note: "Artificial sweetener with limited long-term safety data." },
  { codes: ["e102","tartrazine"], name: "Tartrazine (E102)", severity: "medium", penalty: 7, mealPenalty: 5, note: "Yellow food dye associated with hyperactivity and allergic reactions." },
  { codes: ["e110","sunset yellow"], name: "Sunset Yellow (E110)", severity: "medium", penalty: 7, mealPenalty: 5, note: "Artificial dye linked to hyperactivity. Requires warning label in the EU." },
  { codes: ["e129","allura red"], name: "Allura Red (E129)", severity: "medium", penalty: 6, mealPenalty: 5, note: "Red dye linked to hyperactivity in children." },
  { codes: ["high fructose corn syrup","hfcs","glucose-fructose syrup"], name: "High-Fructose Corn Syrup", severity: "high", penalty: 12, mealPenalty: 10, note: "Heavily processed sugar linked to obesity, insulin resistance, and fatty liver disease." },
  { codes: ["e150d","sulfite ammonia caramel","caramel colour"], name: "Caramel Colour (E150d)", severity: "low", penalty: 4, mealPenalty: 3, note: "Class IV caramel colour contains 4-MEI, a potential carcinogen." },
  { codes: ["e282","calcium propionate"], name: "Calcium Propionate (E282)", severity: "low", penalty: 3, mealPenalty: 2, note: "Bread preservative; some studies suggest links to behavioural issues in children." },
  { codes: ["potassium bromate","e924"], name: "Potassium Bromate (E924)", severity: "high", penalty: 15, mealPenalty: 12, note: "Flour improver banned in the EU and UK. Possible human carcinogen." },
  { codes: ["hydrogenated","partially hydrogenated"], name: "Hydrogenated Oils (Trans Fats)", severity: "high", penalty: 14, mealPenalty: 11, note: "Trans fats raise LDL cholesterol and lower HDL. Strongly linked to heart disease." },
];

function scanAdditives(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = [];
  for (const a of ADDITIVE_WATCHLIST) {
    for (const code of a.codes) { if (lower.includes(code)) { found.push(a); break; } }
  }
  return found;
}

const ALLERGENS = ["Gluten","Dairy","Eggs","Nuts","Peanuts","Soy","Fish","Shellfish","Sesame"];
const ALLERGEN_CODES = {
  Gluten: ["wheat","gluten","barley","rye","oat"],
  Dairy: ["milk","dairy","lactose","whey","casein","butter","cream","cheese"],
  Eggs: ["egg","albumin","mayonnaise"],
  Nuts: ["almond","cashew","walnut","pecan","hazelnut","pistachio","macadamia","brazil nut"],
  Peanuts: ["peanut","groundnut","arachis"],
  Soy: ["soy","soya","tofu","edamame","miso","tempeh"],
  Fish: ["fish","cod","salmon","tuna","anchovy","sardine","halibut"],
  Shellfish: ["shrimp","crab","lobster","prawn","scallop","oyster","clam","mussel"],
  Sesame: ["sesame","tahini"],
};
function checkAllergens(text, userAllergens) {
  if (!text || !userAllergens?.length) return [];
  const lower = text.toLowerCase();
  return userAllergens.filter(a => ALLERGEN_CODES[a]?.some(code => lower.includes(code)));
}

const USDA_IDS = { kcal: 1008, protein: 1003, fat: 1004, carbs: 1005, fiber: 1079, sugar: 2000, satFat: 1258, sodium: 1093, vitC: 1162, vitD: 1114, calcium: 1087, iron: 1089, potassium: 1092, omega3: 1404 };
function extractUsdaNutrients(foodNutrients) {
  const m = {};
  for (const n of (foodNutrients || [])) { const id = n.nutrientId || n.nutrient?.id; m[id] = n.value ?? n.amount ?? 0; }
  const sodiumMg = m[USDA_IDS.sodium] || 0;
  return {
    "energy-kcal_100g": m[USDA_IDS.kcal] || 0, proteins_100g: m[USDA_IDS.protein] || 0,
    fat_100g: m[USDA_IDS.fat] || 0, carbohydrates_100g: m[USDA_IDS.carbs] || 0,
    fiber_100g: m[USDA_IDS.fiber] || 0, sugars_100g: m[USDA_IDS.sugar] || 0,
    "saturated-fat_100g": m[USDA_IDS.satFat] || 0, salt_100g: (sodiumMg * 2.5) / 1000,
    _sodium_mg: sodiumMg, _vitC: m[USDA_IDS.vitC] || 0, _vitD: m[USDA_IDS.vitD] || 0,
    _calcium: m[USDA_IDS.calcium] || 0, _iron: m[USDA_IDS.iron] || 0,
    _potassium: m[USDA_IDS.potassium] || 0, _omega3: m[USDA_IDS.omega3] || 0,
  };
}
function normaliseUsda(food) {
  return {
    product_name: food.description, brands: food.brandOwner || food.brandName || "",
    ingredients_text: food.ingredients || "", nutriments: extractUsdaNutrients(food.foodNutrients),
    nutriscore_grade: "", labels_tags: [], image_small_url: null, _source: "USDA", _fdcId: food.fdcId,
  };
}

function estimatePrice(product, mode) {
  const name = (product.product_name || "").toLowerCase();
  const brands = (product.brands || "").toLowerCase();
  const n = product.nutriments || {};
  const kcal = n["energy-kcal_100g"] || 200;
  const protein = n.proteins_100g || 0;
  let base = mode === "meal" ? 4.5 : 2.5;
  if (mode === "ingredient") {
    if (name.includes("salmon") || name.includes("tuna") || name.includes("fish")) base = 5.5;
    else if (name.includes("chicken") || name.includes("turkey") || name.includes("beef")) base = 4.5;
    else if (name.includes("yogurt") || name.includes("yoghurt")) base = 2.2;
    else if (name.includes("almond") || name.includes("cashew") || name.includes("nut")) base = 4.5;
    else if (name.includes("egg")) base = 3.2;
    else if (name.includes("pasta") || name.includes("rice") || name.includes("oat")) base = 1.8;
    else if (name.includes("olive oil") || name.includes("coconut oil")) base = 5.0;
  } else {
    if (name.includes("lasagne") || name.includes("lasagna") || name.includes("curry") || name.includes("stew")) base = 5.5;
    else if (name.includes("soup")) base = 3.2;
    else if (name.includes("pizza")) base = 6.0;
    else if (name.includes("protein bar") || name.includes("energy bar")) base = 3.5;
    else if (name.includes("cereal") || name.includes("granola")) base = 3.8;
    else if (name.includes("bread") || name.includes("loaf")) base = 2.8;
    else if (name.includes("frozen")) base = 4.8;
  }
  const premiumBrands = ["whole foods","organic valley","annie's","amy's","earth's best","365","nature's path"];
  const budgetBrands = ["great value","store brand","generic","kirkland","member's mark"];
  if (premiumBrands.some(b => brands.includes(b)) || brands.includes("organic")) base *= 1.4;
  else if (budgetBrands.some(b => brands.includes(b))) base *= 0.75;
  if (protein > 20) base *= 1.15;
  if (kcal > 450) base *= 1.1;
  const variation = 0.85 + Math.random() * 0.3;
  return `$${(base * variation).toFixed(2)}`;
}

function calcHealthScore(product, profile = {}, mode = "ingredient") {
  const n = product.nutriments || {};
  let score = 60;
  const breakdown = [];
  const protein = n.proteins_100g || 0;
  const fibre = n.fiber_100g || n.fibre_100g || 0;
  const sugar = n.sugars_100g || 0;
  const satFat = n["saturated-fat_100g"] || 0;
  const salt = n.salt_100g || 0;
  const kcal = n["energy-kcal_100g"] || 0;

  if (mode === "ingredient") {
    const proc = calcProcessingLevel(product.ingredients_text);
    if (proc) {
      const procPts = proc.score === 3 ? 12 : proc.score === 2 ? 6 : proc.score === 1 ? 0 : -8;
      if (procPts !== 0) { score += procPts; breakdown.push({ label: `Processing (${proc.label})`, pts: procPts > 0 ? `+${procPts}` : `${procPts}`, positive: procPts > 0 }); }
    }
    let proteinPts = protein > 20 ? 15 : protein > 10 ? 8 : protein > 5 ? 4 : 0;
    if (profile.goal === "muscle_gain") proteinPts = Math.round(proteinPts * 1.5);
    if (profile.goal === "weight_loss" && protein > 15) proteinPts += 5;
    if (proteinPts > 0) { score += proteinPts; breakdown.push({ label: "Protein", pts: `+${proteinPts}`, positive: true }); }
    let fibrePts = fibre > 6 ? 12 : fibre > 3 ? 6 : fibre > 1 ? 2 : 0;
    if (profile.goal === "heart_health") fibrePts = Math.round(fibrePts * 1.3);
    if (fibrePts > 0) { score += fibrePts; breakdown.push({ label: "Fibre", pts: `+${fibrePts}`, positive: true }); }
    let sugarPts = sugar < 5 ? 8 : sugar < 15 ? 2 : sugar > 25 ? -8 : 0;
    if (profile.goal === "diabetes" && sugar > 5) sugarPts = Math.min(sugarPts - 4, -6);
    if (sugarPts !== 0) { score += sugarPts; breakdown.push({ label: "Sugar", pts: sugarPts > 0 ? `+${sugarPts}` : `${sugarPts}`, positive: sugarPts > 0 }); }
    let satFatPts = satFat < 1.5 ? 8 : satFat < 3 ? 3 : satFat > 10 ? -8 : satFat > 6 ? -4 : 0;
    if (profile.goal === "heart_health" && satFat > 3) satFatPts -= 4;
    if (satFatPts !== 0) { score += satFatPts; breakdown.push({ label: "Saturated Fat", pts: satFatPts > 0 ? `+${satFatPts}` : `${satFatPts}`, positive: satFatPts > 0 }); }
    let saltPts = salt < 0.3 ? 5 : salt > 1.5 ? -8 : salt > 0.8 ? -3 : 0;
    if (profile.goal === "heart_health" && salt > 0.6) saltPts -= 3;
    if (saltPts !== 0) { score += saltPts; breakdown.push({ label: "Salt", pts: saltPts > 0 ? `+${saltPts}` : `${saltPts}`, positive: saltPts > 0 }); }
    const flagged = scanAdditives(product.ingredients_text);
    for (const a of flagged) { score -= a.penalty; breakdown.push({ label: `Additive: ${a.name}`, pts: `-${a.penalty}`, positive: false }); }
  } else {
    const completeness = calcMealCompleteness(n);
    const compPts = completeness.pts * 4;
    if (compPts > 0) { score += compPts; breakdown.push({ label: `Meal Balance (${completeness.label})`, pts: `+${compPts}`, positive: true }); }
    let proteinPts = protein > 15 ? 12 : protein > 8 ? 6 : protein > 4 ? 2 : -4;
    if (profile.goal === "muscle_gain") proteinPts = Math.round(proteinPts * 1.4);
    if (proteinPts !== 0) { score += proteinPts; breakdown.push({ label: "Protein", pts: proteinPts > 0 ? `+${proteinPts}` : `${proteinPts}`, positive: proteinPts > 0 }); }
    let fibrePts = fibre > 5 ? 10 : fibre > 3 ? 5 : fibre > 1 ? 2 : -3;
    if (profile.goal === "heart_health") fibrePts = Math.round(fibrePts * 1.3);
    if (fibrePts !== 0) { score += fibrePts; breakdown.push({ label: "Fibre", pts: fibrePts > 0 ? `+${fibrePts}` : `${fibrePts}`, positive: fibrePts > 0 }); }
    let sugarPts = sugar < 5 ? 8 : sugar < 10 ? 2 : sugar > 15 ? -10 : sugar > 10 ? -5 : 0;
    if (profile.goal === "diabetes" && sugar > 5) sugarPts = Math.min(sugarPts - 6, -10);
    if (sugarPts !== 0) { score += sugarPts; breakdown.push({ label: "Sugar", pts: sugarPts > 0 ? `+${sugarPts}` : `${sugarPts}`, positive: sugarPts > 0 }); }
    const sodiumMg = n._sodium_mg || (salt * 400);
    let sodiumPts = sodiumMg < 300 ? 8 : sodiumMg < 600 ? 3 : sodiumMg > 1200 ? -12 : sodiumMg > 800 ? -6 : 0;
    if (profile.goal === "heart_health" && sodiumMg > 500) sodiumPts -= 5;
    if (sodiumPts !== 0) { score += sodiumPts; breakdown.push({ label: `Sodium (${Math.round(sodiumMg)}mg)`, pts: sodiumPts > 0 ? `+${sodiumPts}` : `${sodiumPts}`, positive: sodiumPts > 0 }); }
    let satFatPts = satFat < 2 ? 6 : satFat < 4 ? 2 : satFat > 8 ? -10 : satFat > 5 ? -5 : 0;
    if (profile.goal === "heart_health" && satFat > 3) satFatPts -= 5;
    if (satFatPts !== 0) { score += satFatPts; breakdown.push({ label: "Saturated Fat", pts: satFatPts > 0 ? `+${satFatPts}` : `${satFatPts}`, positive: satFatPts > 0 }); }
    let kcalPts = kcal >= 250 && kcal <= 550 ? 5 : kcal > 700 ? -8 : kcal < 150 ? -3 : 0;
    if (profile.goal === "weight_loss" && kcal > 400) kcalPts -= 5;
    if (profile.goal === "athletic" && kcal >= 400 && kcal <= 700) kcalPts += 4;
    if (kcalPts !== 0) { score += kcalPts; breakdown.push({ label: "Calories", pts: kcalPts > 0 ? `+${kcalPts}` : `${kcalPts}`, positive: kcalPts > 0 }); }
    const flagged = scanAdditives(product.ingredients_text);
    for (const a of flagged) { const penalty = a.mealPenalty ?? Math.round(a.penalty * 0.75); score -= penalty; breakdown.push({ label: `Additive: ${a.name}`, pts: `-${penalty}`, positive: false }); }
  }

  const ns = (product.nutriscore_grade || "").toLowerCase();
  if (ns === "a") { score += 10; breakdown.push({ label: "Nutri-Score A", pts: "+10", positive: true }); }
  else if (ns === "b") { score += 5; breakdown.push({ label: "Nutri-Score B", pts: "+5", positive: true }); }
  else if (ns === "d") { score -= 5; breakdown.push({ label: "Nutri-Score D", pts: "-5", positive: false }); }
  else if (ns === "e") { score -= 10; breakdown.push({ label: "Nutri-Score E", pts: "-10", positive: false }); }

  if (profile.goal === "pregnancy") {
    const iron = n._iron || 0;
    if (iron > 3) { score += 8; breakdown.push({ label: "Iron (pregnancy)", pts: "+8", positive: true }); }
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), breakdown };
}

function scoreColor(s) { return s >= 75 ? "#2d6a4f" : s >= 55 ? "#74c69d" : s >= 35 ? "#f4a261" : "#e63946"; }
function scoreLabel(s) { return s >= 75 ? "Excellent" : s >= 55 ? "Good" : s >= 35 ? "Fair" : "Poor"; }
function severityColor(s) { return s === "high" ? "#e63946" : s === "medium" ? "#f4a261" : "#999"; }

const NON_LATIN_RE = /[^\u0000-\u024F\u1E00-\u1EFF]/;
const FOREIGN_WORD_RE = /\b(de|du|des|le|la|les|aux|avec|sans|pour|el|los|las|del|con|sin|para|der|die|das|mit|ohne|für|und|von|il|lo|gli|della|per|senza|com|sem|do|da|dos|das|ao|av|ed)\b/i;
function isEnglishProduct(p) {
  const name = p.product_name || "";
  if (!name) return false;
  if (NON_LATIN_RE.test(name)) return false;
  if (p.product_name_en) return true;
  if (p.lang && p.lang !== "en") return false;
  if (FOREIGN_WORD_RE.test(name)) return false;
  return true;
}

async function fetchOFF(query) {
  const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=40&lc=en&fields=product_name,product_name_en,brands,ingredients_text,ingredients_text_en,nutriments,nutriscore_grade,labels_tags,image_small_url,countries_tags,lang`);
  const data = await res.json();
  return (data.products || [])
    .map(p => ({
      ...p,
      product_name: p.product_name_en || p.product_name,
      ingredients_text: p.ingredients_text_en || p.ingredients_text,
      _source: "Open Food Facts",
    }))
    .filter(p => p.product_name && isEnglishProduct(p));
}
async function fetchOFFBarcode(barcode) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
  const data = await res.json();
  if (data.status === 1 && data.product?.product_name) return { ...data.product, _source: "Open Food Facts" };
  return null;
}
async function fetchUSDA(query) {
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&dataType=Branded,Survey (FNDDS)&pageSize=15&api_key=${USDA_API_KEY}`);
  const data = await res.json();
  return (data.foods || []).map(normaliseUsda);
}
function mergeResults(off, usda) {
  const seen = new Set(); const merged = [];
  for (const p of off) { const key = p.product_name.toLowerCase().trim(); if (!seen.has(key)) { seen.add(key); merged.push(p); } }
  for (const p of usda) {
    const key = p.product_name.toLowerCase().trim();
    const existing = merged.find(o => o.product_name.toLowerCase().trim() === key);
    if (existing) {
      const n = existing.nutriments || {}; const u = p.nutriments || {};
      ["proteins_100g","fiber_100g","sugars_100g","saturated-fat_100g","salt_100g","energy-kcal_100g","_vitC","_vitD","_calcium","_iron","_potassium","_omega3","carbohydrates_100g","fat_100g","_sodium_mg"].forEach(f => { if (!n[f] && u[f]) { existing.nutriments[f] = u[f]; existing._usdaPatched = true; } });
    } else if (!seen.has(key)) { seen.add(key); merged.push(p); }
  }
  return merged;
}

const GOALS = [
  { id: "general", label: "General Health", icon: "🌿" },
  { id: "weight_loss", label: "Weight Loss", icon: "⚖️" },
  { id: "muscle_gain", label: "Muscle Gain", icon: "💪" },
  { id: "heart_health", label: "Heart Health", icon: "❤️" },
  { id: "diabetes", label: "Diabetes", icon: "🩺" },
  { id: "pregnancy", label: "Pregnancy", icon: "🤱" },
  { id: "athletic", label: "Athletic Performance", icon: "🏃" },
];
const FILTERS = [
  { id: "high_protein", label: "High Protein" },
  { id: "low_sugar", label: "Low Sugar" },
  { id: "high_fibre", label: "High Fibre" },
  { id: "vegan", label: "Vegan" },
  { id: "no_additives", label: "⚠️ No Additives" },
];
const TABS = ["Search", "Saved", "Compare", "Profile"];

function NutriFind() {
  const [tab, setTab] = useState("Search");
  const [searchMode, setSearchMode] = useState("ingredient");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [searched, setSearched] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [activeFilters, setActiveFilters] = useState([]);
  const [aiTip, setAiTip] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [coverage, setCoverage] = useState({ off: 0, usda: 0, patched: 0 });
  const [profile, setProfile] = useState(() => lsGet(LS_PROFILE, { goal: "general", allergens: [], dietary: [] }));
  const [saved, setSaved] = useState(() => lsGet(LS_SAVED, []));
  const [compareList, setCompareList] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerMsg, setScannerMsg] = useState("");
  const videoRef = useRef(null);
  const scanIntervalRef = useRef(null);

  useEffect(() => { lsSet(LS_PROFILE, profile); }, [profile]);
  useEffect(() => { lsSet(LS_SAVED, saved); }, [saved]);

  const toggleFilter = id => setActiveFilters(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  const toggleSave = (product) => { setSaved(prev => { const key = product.product_name + product._source; return prev.find(p => p.product_name + p._source === key) ? prev.filter(p => p.product_name + p._source !== key) : [...prev, product]; }); };
  const toggleCompare = (product) => { setCompareList(prev => { const key = product.product_name + product._source; if (prev.find(p => p.product_name + p._source === key)) return prev.filter(p => p.product_name + p._source !== key); if (prev.length >= 3) return [...prev.slice(1), product]; return [...prev, product]; }); };
  const isSaved = (product) => saved.some(p => p.product_name + p._source === product.product_name + product._source);
  const isCompared = (product) => compareList.some(p => p.product_name + p._source === product.product_name + product._source);

  const fetchAiTip = useCallback(async (q, mode) => {
    setAiLoading(true); setAiTip("");
    // AI tip endpoint is intentionally a no-op in the static build (no server functions on Netlify static hosting).
    setTimeout(() => setAiLoading(false), 200);
  }, [profile.goal]);

  const processProducts = useCallback((products, modeOverride) => {
    const mode = modeOverride || searchMode;
    return products.map(p => {
      const effectiveMode = detectMode(p) || mode;
      const { score, breakdown } = calcHealthScore(p, profile, effectiveMode);
      return {
        ...p,
        _score: score, _breakdown: breakdown,
        _price: estimatePrice(p, effectiveMode),
        _additives: scanAdditives(p.ingredients_text),
        _allergenWarnings: checkAllergens(p.ingredients_text, profile.allergens),
        _effectiveMode: effectiveMode,
        _processingLevel: calcProcessingLevel(p.ingredients_text),
        _mealCompleteness: effectiveMode === "meal" ? calcMealCompleteness(p.nutriments || {}) : null,
      };
    }).sort((a, b) => b._score - a._score);
  }, [profile, searchMode]);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setSearched(true); setResults([]); setExpanded(null);
    fetchAiTip(query, searchMode);
    let off = [], usda = [];
    try { setLoadingMsg("Searching Open Food Facts…"); off = await fetchOFF(query); } catch { off = []; }
    try { setLoadingMsg("Searching USDA FoodData Central…"); usda = await fetchUSDA(query); } catch { usda = []; }
    setLoadingMsg("Merging & scoring results…");
    const merged = mergeResults(off, usda);
    setCoverage({ off: off.length, usda: usda.length, patched: merged.filter(p => p._usdaPatched).length });
    setResults(processProducts(merged));
    setLoading(false); setLoadingMsg("");
  };

  const startScanner = async () => {
    setShowScanner(true); setScannerMsg("Starting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      setScannerMsg("Point camera at a barcode");
      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              clearInterval(scanIntervalRef.current);
              const code = barcodes[0].rawValue;
              setScannerMsg(`Found: ${code} — looking up…`);
              const product = await fetchOFFBarcode(code);
              stopScanner();
              if (product) {
                const processed = processProducts([product]);
                setResults(prev => [...processed, ...prev.filter(p => p.product_name !== product.product_name)]);
                setSearched(true); setTab("Search");
              } else setScannerMsg("Product not found. Try searching manually.");
            }
          } catch {}
        }, 500);
      } else setScannerMsg("Barcode scanning not supported on this browser. Try Chrome on Android.");
    } catch { setScannerMsg("Camera access denied. Please allow camera access and try again."); }
  };
  const stopScanner = () => {
    clearInterval(scanIntervalRef.current);
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    setShowScanner(false); setScannerMsg("");
  };

  const filtered = results.filter(p => {
    const n = p.nutriments || {};
    if (activeFilters.includes("high_protein") && (n.proteins_100g || 0) < 10) return false;
    if (activeFilters.includes("low_sugar") && (n.sugars_100g || 0) > 5) return false;
    if (activeFilters.includes("high_fibre") && (n.fiber_100g || n.fibre_100g || 0) < 3) return false;
    if (activeFilters.includes("vegan") && !(p.labels_tags || []).some(t => t.includes("vegan"))) return false;
    if (activeFilters.includes("no_additives") && p._additives.length > 0) return false;
    return true;
  });

  const top = filtered[0]; const rest = filtered.slice(1);
  const currentGoalIcon = GOALS.find(g => g.id === profile.goal)?.icon || "🌿";
  const currentMode = SEARCH_MODES.find(m => m.id === searchMode);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0e8", paddingBottom: 80 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Sans+3:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .nt{font-family:'Playfair Display',serif}
        .nb{font-family:'Source Sans 3',sans-serif}
        .card{background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.07);transition:box-shadow .2s}
        .card:hover{box-shadow:0 4px 20px rgba(0,0,0,.13)}
        .fbtn{cursor:pointer;border:1.5px solid #2d6a4f;border-radius:20px;padding:5px 14px;font-size:.8rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#2d6a4f;transition:all .15s}
        .fbtn.on{background:#2d6a4f;color:#fff}
        .fbtn:hover{background:#2d6a4f;color:#fff}
        .ring{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;font-weight:700;font-size:1.1rem;color:#fff;font-family:'Source Sans 3',sans-serif;flex-shrink:0}
        .xbtn{background:none;border:none;cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:.85rem;color:#2d6a4f;text-decoration:underline;padding:0}
        .sbadge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:8px;font-size:.7rem;font-family:'Source Sans 3',sans-serif;font-weight:600}
        .dot{display:inline-block;animation:pulse 1.2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
        .tabnav{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e8e4dc;display:flex;z-index:100}
        .tabitem{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 4px;cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:.7rem;color:#aaa;border:none;background:none;transition:color .15s}
        .tabitem.active{color:#2d6a4f;font-weight:700}
        .iconbtn{background:none;border:1.5px solid currentColor;border-radius:8px;padding:4px 10px;cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:.75rem;transition:all .15s}
        .goalchip{cursor:pointer;border:1.5px solid #ddd;border-radius:20px;padding:6px 14px;font-size:.82rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#555;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
        .goalchip.on{border-color:#2d6a4f;background:#e9f5ee;color:#2d6a4f;font-weight:600}
        .allerchip{cursor:pointer;border:1.5px solid #ddd;border-radius:20px;padding:5px 12px;font-size:.8rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#555;transition:all .15s}
        .allerchip.on{border-color:#e63946;background:#fdecea;color:#e63946;font-weight:600}
        .scanner-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
        .modebtn{cursor:pointer;border:2px solid transparent;border-radius:12px;padding:10px 18px;font-family:'Source Sans 3',sans-serif;background:rgba(255,255,255,.1);color:#d8f3dc;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:130px}
        .modebtn.on{border-color:#d4a017;background:rgba(212,160,23,.2);color:#fff}
        .modebtn:hover{background:rgba(255,255,255,.2)}
        .breakdown-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-family:'Source Sans 3',sans-serif;font-size:.82rem;border-bottom:1px solid #f5f0e8}
        .micro-pill{display:inline-flex;flex-direction:column;align-items:center;background:#f5f0e8;border-radius:8px;padding:4px 10px;font-family:'Source Sans 3',sans-serif}
        input:focus,button:focus{outline:2px solid #2d6a4f}
      `}</style>

      {showScanner && (
        <div className="scanner-overlay">
          <div className="nb" style={{ color: "#fff", fontSize: "1rem", fontWeight: 600 }}>📷 Barcode Scanner</div>
          <video ref={videoRef} style={{ width: "min(340px,90vw)", borderRadius: 12, background: "#000" }} playsInline muted />
          <div className="nb" style={{ color: "#95d5b2", fontSize: ".9rem", textAlign: "center", maxWidth: 300 }}>{scannerMsg}</div>
          <button onClick={stopScanner} style={{ background: "#e63946", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontFamily: "'Source Sans 3',sans-serif", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
        </div>
      )}

      <div style={{ background: "linear-gradient(135deg,#1b4332 0%,#2d6a4f 100%)", padding: "36px 20px 28px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 className="nt" style={{ fontSize: "clamp(1.8rem,6vw,2.8rem)", color: "#d8f3dc", fontWeight: 900, letterSpacing: "-0.5px" }}>NutriFind</h1>
          <span style={{ fontSize: "1.4rem" }}>{currentGoalIcon}</span>
        </div>
        <p className="nb" style={{ color: "#95d5b2", fontSize: ".82rem", marginBottom: 16 }}>Open Food Facts + USDA · Additive-aware · Personalised scoring</p>

        {tab === "Search" && (
          <>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              {SEARCH_MODES.map(m => (
                <button key={m.id} className={`modebtn${searchMode === m.id ? " on" : ""}`} onClick={() => setSearchMode(m.id)}>
                  <span style={{ fontSize: "1.5rem" }}>{m.icon}</span>
                  <span className="nb" style={{ fontSize: ".82rem", fontWeight: 700 }}>{m.label}</span>
                  <span className="nb" style={{ fontSize: ".68rem", opacity: .75, lineHeight: 1.3, textAlign: "center" }}>{m.desc}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", maxWidth: 520, margin: "0 auto", gap: 8 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()}
                placeholder={searchMode === "ingredient" ? "e.g. chicken breast, oats, spinach…" : "e.g. lasagne, protein bar, canned soup…"}
                style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", fontSize: "1rem", background: "#fff", fontFamily: "'Source Sans 3',sans-serif" }} />
              <button onClick={search} style={{ background: "#d4a017", color: "#1a1a1a", border: "none", borderRadius: 10, padding: "12px 18px", fontWeight: 700, fontSize: ".9rem", cursor: "pointer", fontFamily: "'Source Sans 3',sans-serif", whiteSpace: "nowrap" }}>Search</button>
              <button onClick={startScanner} style={{ background: "rgba(255,255,255,.15)", color: "#fff", border: "1px solid rgba(255,255,255,.3)", borderRadius: 10, padding: "12px 14px", cursor: "pointer", fontSize: "1.2rem" }} title="Scan barcode">📷</button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginTop: 10 }}>
              {searchMode === "ingredient"
                ? ["Oats", "Chicken Breast", "Spinach", "Salmon", "Almonds", "Greek Yogurt"].map(q => (
                    <button key={q} onClick={() => setQuery(q)} style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", color: "#d8f3dc", borderRadius: 16, padding: "3px 12px", fontSize: ".8rem", cursor: "pointer", fontFamily: "'Source Sans 3',sans-serif" }}>{q}</button>
                  ))
                : ["Chicken Soup", "Granola Bar", "Frozen Lasagne", "Canned Tuna", "Protein Bar", "Instant Noodles"].map(q => (
                    <button key={q} onClick={() => setQuery(q)} style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.25)", color: "#d8f3dc", borderRadius: 16, padding: "3px 12px", fontSize: ".8rem", cursor: "pointer", fontFamily: "'Source Sans 3',sans-serif" }}>{q}</button>
                  ))
              }
            </div>
          </>
        )}
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 20px" }}>

        {tab === "Search" && (
          <>
            {(aiLoading || aiTip) && (
              <div style={{ background: "#e9f5ee", border: "1px solid #b7e4c7", borderRadius: 12, padding: "14px 18px", marginTop: 18 }}>
                <div className="nb" style={{ fontSize: ".72rem", color: "#2d6a4f", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>
                  {currentMode?.icon} {currentMode?.label} Tip · {GOALS.find(g => g.id === profile.goal)?.label}
                </div>
                {aiLoading ? <div className="nb" style={{ color: "#555", fontSize: ".9rem" }}>Analysing<span className="dot">…</span></div>
                  : <p className="nb" style={{ color: "#333", fontSize: ".9rem", lineHeight: 1.55 }}>{aiTip}</p>}
              </div>
            )}

            {!loading && searched && results.length > 0 && (
              <div style={{ display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
                <span className="sbadge" style={{ background: "#e8f4fd", color: "#1a6fa8" }}>📦 {coverage.off} Open Food Facts</span>
                <span className="sbadge" style={{ background: "#f0f8e8", color: "#3a7d27" }}>🌾 {coverage.usda} USDA</span>
                {coverage.patched > 0 && <span className="sbadge" style={{ background: "#f5f0ff", color: "#6a3fa8" }}>✨ {coverage.patched} enriched</span>}
                <span className="sbadge" style={{ background: searchMode === "ingredient" ? "#e9f5ee" : "#fff3cd", color: searchMode === "ingredient" ? "#2d6a4f" : "#856404" }}>
                  {currentMode?.icon} Scoring as {currentMode?.label}
                </span>
              </div>
            )}

            {searched && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
                {FILTERS.map(f => <button key={f.id} className={`fbtn${activeFilters.includes(f.id) ? " on" : ""}`} onClick={() => toggleFilter(f.id)}>{f.label}</button>)}
                {compareList.length > 0 && (
                  <button className="fbtn on" onClick={() => setTab("Compare")} style={{ background: "#d4a017", borderColor: "#d4a017" }}>⚖️ Compare ({compareList.length})</button>
                )}
              </div>
            )}

            {loading && (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div className="nb" style={{ color: "#2d6a4f", fontSize: "1rem", fontWeight: 600 }}>{loadingMsg} <span className="dot">●</span></div>
                <div className="nb" style={{ color: "#aaa", fontSize: ".8rem", marginTop: 6 }}>Querying both food databases simultaneously</div>
              </div>
            )}

            {!loading && searched && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <div className="nb" style={{ color: "#888" }}>No products found. Try removing filters or broadening your search.</div>
              </div>
            )}

            {!loading && top && (
              <div style={{ marginTop: 20 }}>
                <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#2d6a4f", marginBottom: 8 }}>★ Top Pick</div>
                <ProductCard product={top} isTop expanded={expanded} setExpanded={setExpanded} isSaved={isSaved(top)} toggleSave={toggleSave} isCompared={isCompared(top)} toggleCompare={toggleCompare} />
              </div>
            )}
            {!loading && rest.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#888", marginBottom: 10 }}>Other Options</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {rest.map((p, i) => <ProductCard key={i} product={p} expanded={expanded} setExpanded={setExpanded} isSaved={isSaved(p)} toggleSave={toggleSave} isCompared={isCompared(p)} toggleCompare={toggleCompare} />)}
                </div>
              </div>
            )}
          </>
        )}

        {tab === "Saved" && (
          <div style={{ marginTop: 20 }}>
            <div className="nt" style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 16 }}>Saved Items</div>
            {saved.length === 0
              ? <div style={{ textAlign: "center", padding: "60px 0" }}><div style={{ fontSize: "2.5rem", marginBottom: 12 }}>🔖</div><div className="nb" style={{ color: "#888" }}>No saved items yet. Search for food and tap Save on any product.</div></div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{processProducts(saved).map((p, i) => <ProductCard key={i} product={p} expanded={expanded} setExpanded={setExpanded} isSaved toggleSave={toggleSave} isCompared={isCompared(p)} toggleCompare={toggleCompare} />)}</div>}
          </div>
        )}

        {tab === "Compare" && (
          <div style={{ marginTop: 20 }}>
            <div className="nt" style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 4 }}>Compare Products</div>
            <div className="nb" style={{ fontSize: ".82rem", color: "#888", marginBottom: 16 }}>Add up to 3 products from search results to compare side by side.</div>
            {compareList.length === 0
              ? <div style={{ textAlign: "center", padding: "60px 0" }}><div style={{ fontSize: "2.5rem", marginBottom: 12 }}>⚖️</div><div className="nb" style={{ color: "#888" }}>No products selected. Tap Compare on any product card.</div></div>
              : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 300 }}>
                    <thead>
                      <tr>
                        <td style={{ padding: "8px 4px", fontFamily: "'Source Sans 3',sans-serif", fontSize: ".72rem", color: "#aaa", textTransform: "uppercase", letterSpacing: ".06em" }}>Per 100g</td>
                        {compareList.map((p, i) => (
                          <td key={i} style={{ padding: "8px 8px", verticalAlign: "top" }}>
                            <div className="nb" style={{ fontSize: ".8rem", fontWeight: 700, lineHeight: 1.3 }}>{p.product_name.length > 28 ? p.product_name.slice(0, 26) + "…" : p.product_name}</div>
                            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: "50%", background: scoreColor(p._score), color: "#fff", fontWeight: 700, fontSize: ".85rem", fontFamily: "'Source Sans 3',sans-serif", marginTop: 5 }}>{p._score}</div>
                            <div className="nb" style={{ fontSize: ".68rem", color: "#aaa", marginTop: 2 }}>{p._effectiveMode === "ingredient" ? "🥦 Ingredient" : "🍱 Meal"}</div>
                            <button onClick={() => toggleCompare(p)} style={{ display: "block", marginTop: 3, background: "none", border: "none", cursor: "pointer", color: "#e63946", fontSize: ".72rem", fontFamily: "'Source Sans 3',sans-serif" }}>Remove</button>
                          </td>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Est. Price", fn: p => p._price },
                        { label: "Calories", fn: p => p.nutriments?.["energy-kcal_100g"] ? `${Math.round(p.nutriments["energy-kcal_100g"])} kcal` : "—" },
                        { label: "Protein", fn: p => p.nutriments?.proteins_100g ? `${Number(p.nutriments.proteins_100g).toFixed(1)}g` : "—" },
                        { label: "Fibre", fn: p => (p.nutriments?.fiber_100g || p.nutriments?.fibre_100g) ? `${Number(p.nutriments.fiber_100g || p.nutriments.fibre_100g).toFixed(1)}g` : "—" },
                        { label: "Sugar", fn: p => p.nutriments?.sugars_100g != null ? `${Number(p.nutriments.sugars_100g).toFixed(1)}g` : "—" },
                        { label: "Sat Fat", fn: p => p.nutriments?.["saturated-fat_100g"] != null ? `${Number(p.nutriments["saturated-fat_100g"]).toFixed(1)}g` : "—" },
                        { label: "Salt", fn: p => p.nutriments?.salt_100g != null ? `${Number(p.nutriments.salt_100g).toFixed(2)}g` : "—" },
                        { label: "Sodium", fn: p => p.nutriments?._sodium_mg ? `${Math.round(p.nutriments._sodium_mg)}mg` : "—" },
                        { label: "Vitamin C", fn: p => p.nutriments?._vitC ? `${Number(p.nutriments._vitC).toFixed(0)}mg` : "—" },
                        { label: "Iron", fn: p => p.nutriments?._iron ? `${Number(p.nutriments._iron).toFixed(1)}mg` : "—" },
                        { label: "Processing", fn: p => p._processingLevel?.label || "—" },
                        { label: "Meal Balance", fn: p => p._mealCompleteness?.label || "—" },
                        { label: "Additives", fn: p => p._additives?.length > 0 ? `⚠️ ${p._additives.length}` : "✓ Clean" },
                        { label: "Source", fn: p => p._source },
                      ].map((row, ri) => (
                        <tr key={ri} style={{ background: ri % 2 === 0 ? "#f9f7f3" : "#fff" }}>
                          <td style={{ padding: "7px 4px", fontFamily: "'Source Sans 3',sans-serif", fontSize: ".75rem", color: "#888", whiteSpace: "nowrap" }}>{row.label}</td>
                          {compareList.map((p, ci) => <td key={ci} style={{ padding: "7px 8px", fontFamily: "'Source Sans 3',sans-serif", fontSize: ".83rem", fontWeight: 600 }}>{row.fn(p)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {tab === "Profile" && (
          <div style={{ marginTop: 20 }}>
            <div className="nt" style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 4 }}>Your Health Profile</div>
            <div className="nb" style={{ fontSize: ".85rem", color: "#666", marginBottom: 20, lineHeight: 1.5 }}>Personalises health scores. Saved automatically to your device.</div>

            <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#2d6a4f", marginBottom: 10 }}>Health Goal</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
              {GOALS.map(g => <button key={g.id} className={`goalchip${profile.goal === g.id ? " on" : ""}`} onClick={() => setProfile(prev => ({ ...prev, goal: g.id }))}>{g.icon} {g.label}</button>)}
            </div>

            <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#e63946", marginBottom: 10 }}>Allergens to Flag</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
              {ALLERGENS.map(a => <button key={a} className={`allerchip${(profile.allergens || []).includes(a) ? " on" : ""}`} onClick={() => setProfile(prev => ({ ...prev, allergens: (prev.allergens || []).includes(a) ? prev.allergens.filter(x => x !== a) : [...(prev.allergens || []), a] }))}>{a}</button>)}
            </div>

            <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#888", marginBottom: 10 }}>Dietary Preferences</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
              {["Vegan","Vegetarian","Gluten-Free","Dairy-Free","Keto","Paleo","Halal","Kosher"].map(d => <button key={d} className={`fbtn${(profile.dietary || []).includes(d) ? " on" : ""}`} onClick={() => setProfile(prev => ({ ...prev, dietary: (prev.dietary || []).includes(d) ? prev.dietary.filter(x => x !== d) : [...(prev.dietary || []), d] }))}>{d}</button>)}
            </div>

            <div className="card" style={{ padding: "16px 18px", background: "#e9f5ee", border: "1px solid #b7e4c7" }}>
              <div className="nb" style={{ fontSize: ".82rem", color: "#2d6a4f", lineHeight: 1.6 }}>
                <strong>Profile active:</strong> Scoring calibrated for <strong>{GOALS.find(g => g.id === profile.goal)?.label}</strong>.
                {(profile.allergens || []).length > 0 && <span> Allergen warnings on: <strong>{profile.allergens.join(", ")}</strong>.</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      <nav className="tabnav">
        {TABS.map(t => (
          <button key={t} className={`tabitem${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            <span style={{ fontSize: "1.2rem", marginBottom: 2 }}>
              {t === "Search" ? "🔍" : t === "Saved" ? `🔖${saved.length > 0 ? ` ${saved.length}` : ""}` : t === "Compare" ? `⚖️${compareList.length > 0 ? ` ${compareList.length}` : ""}` : "👤"}
            </span>
            {t}
          </button>
        ))}
      </nav>
    </div>
  );
}

function ProductCard({ product, isTop, expanded, setExpanded, isSaved, toggleSave, isCompared, toggleCompare }) {
  const uid = product.product_name + product._source;
  const isOpen = expanded === uid;
  const score = product._score;
  const additives = product._additives || [];
  const breakdown = product._breakdown || [];
  const allergenWarnings = product._allergenWarnings || [];
  const n = product.nutriments || {};
  const mode = product._effectiveMode || "ingredient";
  const proc = product._processingLevel;
  const completeness = product._mealCompleteness;

  const stats = [
    { label: "Kcal", val: n["energy-kcal_100g"] ? Math.round(n["energy-kcal_100g"]) : "—" },
    { label: "Protein", val: n.proteins_100g ? `${Number(n.proteins_100g).toFixed(1)}g` : "—" },
    { label: "Fibre", val: (n.fiber_100g || n.fibre_100g) ? `${Number(n.fiber_100g || n.fibre_100g).toFixed(1)}g` : "—" },
    { label: "Sugar", val: n.sugars_100g != null ? `${Number(n.sugars_100g).toFixed(1)}g` : "—" },
    { label: "Sat Fat", val: n["saturated-fat_100g"] != null ? `${Number(n["saturated-fat_100g"]).toFixed(1)}g` : "—" },
    { label: mode === "meal" ? "Sodium" : "Salt", val: mode === "meal" && n._sodium_mg ? `${Math.round(n._sodium_mg)}mg` : n.salt_100g != null ? `${Number(n.salt_100g).toFixed(2)}g` : "—" },
  ];

  const micronutrients = [
    { label: "Vit C", val: n._vitC ? `${Number(n._vitC).toFixed(0)}mg` : null },
    { label: "Vit D", val: n._vitD ? `${Number(n._vitD).toFixed(1)}μg` : null },
    { label: "Calcium", val: n._calcium ? `${Math.round(n._calcium)}mg` : null },
    { label: "Iron", val: n._iron ? `${Number(n._iron).toFixed(1)}mg` : null },
    { label: "K⁺", val: n._potassium ? `${Math.round(n._potassium)}mg` : null },
    { label: "Ω-3", val: n._omega3 ? `${Number(n._omega3).toFixed(2)}g` : null },
  ].filter(m => m.val);

  const srcStyle = product._source === "USDA" ? { bg: "#f0f8e8", color: "#3a7d27" } : { bg: "#e8f4fd", color: "#1a6fa8" };

  return (
    <div className="card" style={{ padding: "14px 16px", border: isTop ? "2px solid #2d6a4f" : "1px solid #e8e4dc" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="nb" style={{ fontSize: ".68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: mode === "ingredient" ? "#e9f5ee" : "#fff3cd", color: mode === "ingredient" ? "#2d6a4f" : "#856404" }}>
          {mode === "ingredient" ? "🥦 Scored as Ingredient" : "🍱 Scored as Prepared Meal"}
        </span>
        {proc && mode === "ingredient" && (
          <span className="nb" style={{ fontSize: ".68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: proc.color + "18", color: proc.color }}>{proc.label}</span>
        )}
        {completeness && mode === "meal" && (
          <span className="nb" style={{ fontSize: ".68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: completeness.color + "18", color: completeness.color }}>Balance: {completeness.label}</span>
        )}
      </div>

      {allergenWarnings.length > 0 && (
        <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
          <span className="nb" style={{ fontSize: ".78rem", color: "#856404", fontWeight: 700 }}>🚨 Contains your allergens: {allergenWarnings.join(", ")}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {product.image_small_url && <img src={product.image_small_url} alt="" style={{ width: 50, height: 50, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div className="nt" style={{ fontWeight: 700, fontSize: ".95rem", lineHeight: 1.3, color: "#1a1a1a" }}>{product.product_name}</div>
              {product.brands && <div className="nb" style={{ fontSize: ".75rem", color: "#888", marginTop: 2 }}>{product.brands}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
              <div className="ring" style={{ background: scoreColor(score), width: 46, height: 46, fontSize: "1rem" }}>{score}</div>
              <div className="nb" style={{ fontSize: ".68rem", color: scoreColor(score), fontWeight: 600 }}>{scoreLabel(score)}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
            <span className="nb" style={{ fontSize: ".83rem", fontWeight: 700, color: "#2d6a4f" }}>est. {product._price}</span>
            <span className="sbadge" style={{ background: srcStyle.bg, color: srcStyle.color }}>{product._source === "USDA" ? "🌾" : "📦"} {product._source}{product._usdaPatched ? " +" : ""}</span>
            {additives.length > 0
              ? <span className="nb" style={{ fontSize: ".75rem", color: "#e63946", fontWeight: 600, background: "#fdecea", padding: "2px 7px", borderRadius: 8 }}>⚠️ {additives.length} additive{additives.length > 1 ? "s" : ""}</span>
              : product.ingredients_text && <span className="nb" style={{ fontSize: ".75rem", color: "#2d6a4f", fontWeight: 600, background: "#e9f5ee", padding: "2px 7px", borderRadius: 8 }}>✓ Clean</span>}
            <button className="iconbtn" onClick={() => toggleSave(product)} style={{ color: isSaved ? "#d4a017" : "#aaa", marginLeft: "auto" }}>🔖 {isSaved ? "Saved" : "Save"}</button>
            <button className="iconbtn" onClick={() => toggleCompare(product)} style={{ color: isCompared ? "#2d6a4f" : "#aaa" }}>⚖️ {isCompared ? "Added" : "Compare"}</button>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", marginTop: 12, borderTop: "1px solid #f0ebe0", paddingTop: 10, justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        {stats.map(s => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span className="nb" style={{ fontSize: ".88rem", fontWeight: 700, color: "#1a1a1a" }}>{s.val}</span>
            <span className="nb" style={{ fontSize: ".65rem", color: "#aaa", marginTop: 1 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {micronutrients.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {micronutrients.map(m => (
            <div key={m.label} className="micro-pill">
              <span className="nb" style={{ fontSize: ".75rem", fontWeight: 700, color: "#2d6a4f" }}>{m.val}</span>
              <span className="nb" style={{ fontSize: ".62rem", color: "#aaa" }}>{m.label}</span>
            </div>
          ))}
        </div>
      )}

      {(product.ingredients_text || breakdown.length > 0) && (
        <button className="xbtn" style={{ marginTop: 8 }} onClick={() => setExpanded(isOpen ? null : uid)}>
          {isOpen ? "Hide details ▲" : "Score breakdown & ingredients ▼"}
        </button>
      )}

      {isOpen && (
        <div style={{ marginTop: 10, borderTop: "1px solid #f0ebe0", paddingTop: 10 }}>
          {breakdown.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "#555", marginBottom: 6 }}>📊 Score Breakdown</div>
              <div style={{ background: "#f9f7f3", borderRadius: 8, padding: "8px 10px" }}>
                {breakdown.map((b, i) => (
                  <div key={i} className="breakdown-row">
                    <span style={{ color: "#555" }}>{b.label}</span>
                    <span style={{ fontWeight: 700, color: b.positive ? "#2d6a4f" : "#e63946" }}>{b.pts}</span>
                  </div>
                ))}
                <div className="breakdown-row" style={{ borderBottom: "none", marginTop: 4, paddingTop: 4, borderTop: "2px solid #e8e4dc" }}>
                  <span style={{ fontWeight: 700 }}>Final Score</span>
                  <span style={{ fontWeight: 900, color: scoreColor(score), fontSize: "1rem" }}>{score}</span>
                </div>
              </div>
            </div>
          )}

          {additives.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "#e63946", marginBottom: 6 }}>⚠️ Flagged Additives</div>
              {additives.map((a, i) => (
                <div key={i} style={{ background: "#fdf3f3", border: `1px solid ${severityColor(a.severity)}22`, borderRadius: 8, padding: "8px 10px", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span className="nb" style={{ fontWeight: 700, fontSize: ".83rem", color: severityColor(a.severity) }}>{a.name}</span>
                    <span style={{ display: "inline-flex", padding: "2px 7px", borderRadius: 10, fontSize: ".7rem", fontFamily: "'Source Sans 3',sans-serif", background: severityColor(a.severity) + "22", color: severityColor(a.severity), border: `1px solid ${severityColor(a.severity)}44` }}>
                      {a.severity} risk · -{mode === "meal" ? (a.mealPenalty ?? Math.round(a.penalty * .75)) : a.penalty} pts
                    </span>
                  </div>
                  <p className="nb" style={{ fontSize: ".78rem", color: "#555", marginTop: 3, lineHeight: 1.4 }}>{a.note}</p>
                </div>
              ))}
            </div>
          )}

          {product.ingredients_text && (
            <>
              <div className="nb" style={{ fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "#888", marginBottom: 5 }}>Ingredients</div>
              <p className="nb" style={{ fontSize: ".8rem", color: "#555", lineHeight: 1.55 }}>{product.ingredients_text}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

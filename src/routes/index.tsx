// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";

const USDA_API_KEY = "DEMO_KEY";
const LS_PROFILE = "nutrifind_profile";
const LS_SAVED = "nutrifind_saved";
const LS_SHOPPING = "nutrifind_shopping";
function lsGet(key, fb) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ─── ENGLISH FILTER ───────────────────────────────────────────────────────────
const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF]/;
function isEnglish(product) {
  const name = product.product_name || "";
  if (NON_LATIN.test(name)) return false;
  // Filter out products with no English-recognisable words
  const words = name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0].length < 2)) return false;
  return true;
}

// ─── NAME TRANSLATION ────────────────────────────────────────────────────────
// Detects likely non-English product names using common foreign word patterns
const FOREIGN_PATTERNS = [
  /\b(de|du|des|le|la|les|au|aux|avec|pour|sans)\b/i,  // French
  /\b(el|la|los|las|del|con|sin|para|con)\b/i,           // Spanish
  /\b(der|die|das|mit|ohne|für|und|von)\b/i,             // German
  /\b(il|lo|gli|le|del|della|con|per|senza)\b/i,         // Italian
  /\b(com|sem|para|do|da|dos|das|ao)\b/i,                // Portuguese
];
function looksNonEnglish(name) {
  if (!name) return false;
  return FOREIGN_PATTERNS.some(p => p.test(name));
}

// Batch-translate a list of product names in one API call
async function translateProductNames(products) {
  const toTranslate = products.filter(p => looksNonEnglish(p.product_name));
  if (toTranslate.length === 0) return products;

  try {
    const nameList = toTranslate.map((p, i) => `${i + 1}. ${p.product_name}`).join("\n");
    const res = await fetch("/.netlify/functions/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: "You are a food product translator. Translate the following product names into clear, natural English. Keep brand names as-is. Keep it concise — just the translated name, no explanations. Return ONLY a JSON array of translated strings in the same order, no other text, no markdown. Example: [\"Whole Grain Bread\", \"Natural Greek Yogurt\"]",
        messages: [{ role: "user", content: `Translate these product names to English:\n${nameList}` }],
      }),
    });
    const data = await res.json();
    const text = (data.content?.[0]?.text || "[]").replace(/```json|```/g, "").trim();
    const translated = JSON.parse(text);

    // Map translations back onto the products
    let idx = 0;
    return products.map(p => {
      if (looksNonEnglish(p.product_name)) {
        const translatedName = translated[idx] || p.product_name;
        idx++;
        return {
          ...p,
          product_name: translatedName,
          _originalName: p.product_name, // keep original for reference
          _translated: translatedName !== p.product_name,
        };
      }
      return p;
    });
  } catch {
    return products; // silently fall back to original names if translation fails
  }
}

// ─── STORE GUIDANCE ───────────────────────────────────────────────────────────
const STORE_GUIDANCE = {
  protein: { stores: ["Whole Foods", "Trader Joe's", "Kroger", "Costco"], tip: "Best value in bulk at Costco or warehouse stores" },
  vegetables: { stores: ["Farmer's Market", "Whole Foods", "Aldi", "Kroger"], tip: "Frozen is just as nutritious and cheaper" },
  grains: { stores: ["Whole Foods", "Trader Joe's", "Aldi", "any supermarket"], tip: "Own-brand whole grain options at Aldi offer great value" },
  dairy: { stores: ["Kroger", "Trader Joe's", "Costco", "Aldi"], tip: "Own-brand versions are nutritionally identical to premium brands" },
  oils: { stores: ["Costco", "Trader Joe's", "Whole Foods"], tip: "Buy in bulk at Costco for the best price per ml" },
  nuts: { stores: ["Costco", "Trader Joe's", "Whole Foods"], tip: "Buying raw and unsalted is cheaper and healthier" },
  herbs: { stores: ["Farmer's Market", "ethnic grocery stores", "Aldi"], tip: "Ethnic grocery stores often stock fresh herbs at a fraction of supermarket prices" },
  fish: { stores: ["Whole Foods", "Costco", "ethnic grocery stores"], tip: "Frozen wild-caught is nutritionally equivalent to fresh and much cheaper" },
  default: { stores: ["Kroger", "Trader Joe's", "Whole Foods", "Aldi"], tip: "Compare own-brand options for the best value" },
};
function getStoreGuidance(ingredientName) {
  const n = ingredientName.toLowerCase();
  if (/chicken|beef|pork|turkey|meat|fish|salmon|tuna|shrimp|tofu|egg/.test(n)) return STORE_GUIDANCE.protein;
  if (/spinach|kale|broccoli|carrot|onion|pepper|tomato|lettuce|celery|mushroom|vegetable/.test(n)) return STORE_GUIDANCE.vegetables;
  if (/rice|pasta|oat|bread|flour|quinoa|grain|wheat|barley/.test(n)) return STORE_GUIDANCE.grains;
  if (/milk|cheese|yogurt|yoghurt|butter|cream|dairy/.test(n)) return STORE_GUIDANCE.dairy;
  if (/oil|olive|coconut|avocado/.test(n)) return STORE_GUIDANCE.oils;
  if (/almond|cashew|walnut|nut|seed|peanut/.test(n)) return STORE_GUIDANCE.nuts;
  if (/herb|basil|parsley|cilantro|thyme|rosemary|garlic|ginger/.test(n)) return STORE_GUIDANCE.herbs;
  if (/salmon|tuna|cod|haddock|fish|seafood/.test(n)) return STORE_GUIDANCE.fish;
  return STORE_GUIDANCE.default;
}

// ─── SEARCH MODE ──────────────────────────────────────────────────────────────
const SEARCH_MODES = [
  { id: "ingredient", label: "Ingredient", icon: "🥦", desc: "Search raw or whole foods" },
  { id: "meal", label: "Packaged Meal", icon: "🍱", desc: "Search packaged or ready-made" },
  { id: "planner", label: "Cook My Own", icon: "👨‍🍳", desc: "Pick a dish — get the best ingredients" },
];

function detectMode(product) {
  const name = (product.product_name || "").toLowerCase();
  const ingredients = (product.ingredients_text || "").toLowerCase();
  const ingredientCount = ingredients ? ingredients.split(",").length : 0;
  const mealKw = ["lasagne","lasagna","soup","stew","curry","pizza","ready meal","frozen meal","dinner","entree","casserole","mac and cheese","sandwich","wrap","burger","nugget"];
  const ingKw = ["raw","fresh","whole","organic","plain","natural","unprocessed"];
  if (mealKw.some(k => name.includes(k))) return "meal";
  if (ingKw.some(k => name.includes(k))) return "ingredient";
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
  const protein = n.proteins_100g || 0, carbs = n.carbohydrates_100g || 0;
  const fat = n.fat_100g || 0, fibre = n.fiber_100g || n.fibre_100g || 0;
  let pts = 0;
  if (protein >= 8) pts++; if (carbs >= 15 && carbs <= 60) pts++;
  if (fat >= 3 && fat <= 20) pts++; if (fibre >= 2) pts++;
  const labels = ["Incomplete","Minimal","Moderate","Good","Complete"];
  const colors = ["#e63946","#f4a261","#f4a261","#74c69d","#2d6a4f"];
  return { label: labels[pts], color: colors[pts], pts };
}

// ─── ADDITIVE WATCHLIST ───────────────────────────────────────────────────────
const ADDITIVE_WATCHLIST = [
  { codes: ["e250","sodium nitrite","e251","sodium nitrate"], name: "Sodium Nitrite/Nitrate", severity: "high", penalty: 15, mealPenalty: 10, note: "Linked to increased colorectal cancer risk at high intake." },
  { codes: ["e320","bha","butylated hydroxyanisole"], name: "BHA (E320)", severity: "high", penalty: 12, mealPenalty: 9, note: "Classified as possibly carcinogenic by IARC." },
  { codes: ["e321","bht","butylated hydroxytoluene"], name: "BHT (E321)", severity: "medium", penalty: 8, mealPenalty: 6, note: "Controversial synthetic preservative." },
  { codes: ["e211","sodium benzoate"], name: "Sodium Benzoate (E211)", severity: "medium", penalty: 8, mealPenalty: 6, note: "Can react with vitamin C to form benzene." },
  { codes: ["e621","monosodium glutamate","msg"], name: "MSG (E621)", severity: "low", penalty: 3, mealPenalty: 2, note: "Generally safe; some individuals report sensitivity." },
  { codes: ["e407","carrageenan"], name: "Carrageenan (E407)", severity: "medium", penalty: 7, mealPenalty: 5, note: "Some evidence links it to gut inflammation." },
  { codes: ["e951","aspartame"], name: "Aspartame (E951)", severity: "medium", penalty: 6, mealPenalty: 5, note: "Classified as possibly carcinogenic by WHO in 2023." },
  { codes: ["e950","acesulfame-k","acesulfame potassium"], name: "Acesulfame-K (E950)", severity: "low", penalty: 4, mealPenalty: 3, note: "Artificial sweetener with limited long-term safety data." },
  { codes: ["e102","tartrazine"], name: "Tartrazine (E102)", severity: "medium", penalty: 7, mealPenalty: 5, note: "Yellow food dye linked to hyperactivity." },
  { codes: ["e110","sunset yellow"], name: "Sunset Yellow (E110)", severity: "medium", penalty: 7, mealPenalty: 5, note: "Artificial dye. Requires warning label in the EU." },
  { codes: ["e129","allura red"], name: "Allura Red (E129)", severity: "medium", penalty: 6, mealPenalty: 5, note: "Red dye linked to hyperactivity in children." },
  { codes: ["high fructose corn syrup","hfcs","glucose-fructose syrup"], name: "High-Fructose Corn Syrup", severity: "high", penalty: 12, mealPenalty: 10, note: "Linked to obesity, insulin resistance, and fatty liver disease." },
  { codes: ["e282","calcium propionate"], name: "Calcium Propionate (E282)", severity: "low", penalty: 3, mealPenalty: 2, note: "Bread preservative; some links to behavioural issues in children." },
  { codes: ["potassium bromate","e924"], name: "Potassium Bromate (E924)", severity: "high", penalty: 15, mealPenalty: 12, note: "Possible human carcinogen. Banned in EU and UK." },
  { codes: ["hydrogenated","partially hydrogenated"], name: "Hydrogenated Oils (Trans Fats)", severity: "high", penalty: 14, mealPenalty: 11, note: "Strongly linked to heart disease." },
];
function scanAdditives(text) {
  if (!text) return [];
  const lower = text.toLowerCase(); const found = [];
  for (const a of ADDITIVE_WATCHLIST) { for (const c of a.codes) { if (lower.includes(c)) { found.push(a); break; } } }
  return found;
}

const ALLERGENS = ["Gluten","Dairy","Eggs","Nuts","Peanuts","Soy","Fish","Shellfish","Sesame"];
const ALLERGEN_CODES = {
  Gluten: ["wheat","gluten","barley","rye","oat"], Dairy: ["milk","dairy","lactose","whey","casein","butter","cream","cheese"],
  Eggs: ["egg","albumin","mayonnaise"], Nuts: ["almond","cashew","walnut","pecan","hazelnut","pistachio","macadamia","brazil nut"],
  Peanuts: ["peanut","groundnut","arachis"], Soy: ["soy","soya","tofu","edamame","miso","tempeh"],
  Fish: ["fish","cod","salmon","tuna","anchovy","sardine","halibut"], Shellfish: ["shrimp","crab","lobster","prawn","scallop","oyster","clam","mussel"],
  Sesame: ["sesame","tahini"],
};
function checkAllergens(text, ua) {
  if (!text || !ua?.length) return [];
  const lower = text.toLowerCase();
  return ua.filter(a => ALLERGEN_CODES[a]?.some(c => lower.includes(c)));
}

const USDA_IDS = { kcal:1008, protein:1003, fat:1004, carbs:1005, fiber:1079, sugar:2000, satFat:1258, sodium:1093, vitC:1162, vitD:1114, calcium:1087, iron:1089, potassium:1092, omega3:1404 };
function extractUsdaNutrients(fn) {
  const m = {};
  for (const n of (fn||[])) { const id = n.nutrientId||n.nutrient?.id; m[id] = n.value??n.amount??0; }
  const sod = m[USDA_IDS.sodium]||0;
  return { "energy-kcal_100g":m[USDA_IDS.kcal]||0, proteins_100g:m[USDA_IDS.protein]||0, fat_100g:m[USDA_IDS.fat]||0, carbohydrates_100g:m[USDA_IDS.carbs]||0, fiber_100g:m[USDA_IDS.fiber]||0, sugars_100g:m[USDA_IDS.sugar]||0, "saturated-fat_100g":m[USDA_IDS.satFat]||0, salt_100g:(sod*2.5)/1000, _sodium_mg:sod, _vitC:m[USDA_IDS.vitC]||0, _vitD:m[USDA_IDS.vitD]||0, _calcium:m[USDA_IDS.calcium]||0, _iron:m[USDA_IDS.iron]||0, _potassium:m[USDA_IDS.potassium]||0, _omega3:m[USDA_IDS.omega3]||0 };
}
function normaliseUsda(food) {
  return { product_name:food.description, brands:food.brandOwner||food.brandName||"", ingredients_text:food.ingredients||"", nutriments:extractUsdaNutrients(food.foodNutrients), nutriscore_grade:"", labels_tags:[], image_small_url:null, _source:"USDA", _fdcId:food.fdcId };
}

function estimatePrice(product, mode) {
  const name = (product.product_name||"").toLowerCase();
  const brands = (product.brands||"").toLowerCase();
  const n = product.nutriments||{};
  const protein = n.proteins_100g||0;
  let base = mode==="meal" ? 4.5 : 2.5;
  if (mode==="ingredient") {
    if (/salmon|tuna|fish/.test(name)) base=5.5;
    else if (/chicken|turkey|beef|meat/.test(name)) base=4.5;
    else if (/yogurt|yoghurt/.test(name)) base=2.2;
    else if (/almond|cashew|nut/.test(name)) base=4.5;
    else if (/egg/.test(name)) base=3.2;
    else if (/pasta|rice|oat/.test(name)) base=1.8;
    else if (/olive oil|coconut oil/.test(name)) base=5.0;
    else if (/spinach|kale|broccoli|vegetable/.test(name)) base=2.0;
  } else {
    if (/lasagne|lasagna|curry|stew/.test(name)) base=5.5;
    else if (/soup/.test(name)) base=3.2;
    else if (/pizza/.test(name)) base=6.0;
    else if (/protein bar|energy bar/.test(name)) base=3.5;
    else if (/cereal|granola/.test(name)) base=3.8;
    else if (/bread|loaf/.test(name)) base=2.8;
  }
  if (/organic valley|annie's|amy's|whole foods|nature's path/.test(brands)||brands.includes("organic")) base*=1.4;
  else if (/great value|kirkland|member's mark/.test(brands)) base*=0.75;
  if (protein>20) base*=1.15;
  return `$${(base*(0.85+Math.random()*0.3)).toFixed(2)}`;
}

// ─── HEALTH SCORE ─────────────────────────────────────────────────────────────
function calcHealthScore(product, profile={}, mode="ingredient") {
  const n = product.nutriments||{}; let score=60; const breakdown=[];
  const protein=n.proteins_100g||0, fibre=n.fiber_100g||n.fibre_100g||0;
  const sugar=n.sugars_100g||0, satFat=n["saturated-fat_100g"]||0;
  const salt=n.salt_100g||0, kcal=n["energy-kcal_100g"]||0;

  if (mode==="ingredient") {
    const proc=calcProcessingLevel(product.ingredients_text);
    if (proc) { const pp=proc.score===3?12:proc.score===2?6:proc.score===1?0:-8; if(pp!==0){score+=pp;breakdown.push({label:`Processing (${proc.label})`,pts:pp>0?`+${pp}`:`${pp}`,positive:pp>0});} }
    let pp=protein>20?15:protein>10?8:protein>5?4:0; if(profile.goal==="muscle_gain")pp=Math.round(pp*1.5); if(profile.goal==="weight_loss"&&protein>15)pp+=5; if(pp>0){score+=pp;breakdown.push({label:"Protein",pts:`+${pp}`,positive:true});}
    let fp=fibre>6?12:fibre>3?6:fibre>1?2:0; if(profile.goal==="heart_health")fp=Math.round(fp*1.3); if(fp>0){score+=fp;breakdown.push({label:"Fibre",pts:`+${fp}`,positive:true});}
    let sp=sugar<5?8:sugar<15?2:sugar>25?-8:0; if(profile.goal==="diabetes"&&sugar>5)sp=Math.min(sp-4,-6); if(sp!==0){score+=sp;breakdown.push({label:"Sugar",pts:sp>0?`+${sp}`:`${sp}`,positive:sp>0});}
    let sfp=satFat<1.5?8:satFat<3?3:satFat>10?-8:satFat>6?-4:0; if(profile.goal==="heart_health"&&satFat>3)sfp-=4; if(sfp!==0){score+=sfp;breakdown.push({label:"Sat Fat",pts:sfp>0?`+${sfp}`:`${sfp}`,positive:sfp>0});}
    let slp=salt<0.3?5:salt>1.5?-8:salt>0.8?-3:0; if(profile.goal==="heart_health"&&salt>0.6)slp-=3; if(slp!==0){score+=slp;breakdown.push({label:"Salt",pts:slp>0?`+${slp}`:`${slp}`,positive:slp>0});}
    const flagged=scanAdditives(product.ingredients_text); for(const a of flagged){score-=a.penalty;breakdown.push({label:`Additive: ${a.name}`,pts:`-${a.penalty}`,positive:false});}
  } else {
    const comp=calcMealCompleteness(n); const cp=comp.pts*4; if(cp>0){score+=cp;breakdown.push({label:`Meal Balance (${comp.label})`,pts:`+${cp}`,positive:true});}
    let pp=protein>15?12:protein>8?6:protein>4?2:-4; if(profile.goal==="muscle_gain")pp=Math.round(pp*1.4); if(pp!==0){score+=pp;breakdown.push({label:"Protein",pts:pp>0?`+${pp}`:`${pp}`,positive:pp>0});}
    let fp=fibre>5?10:fibre>3?5:fibre>1?2:-3; if(profile.goal==="heart_health")fp=Math.round(fp*1.3); if(fp!==0){score+=fp;breakdown.push({label:"Fibre",pts:fp>0?`+${fp}`:`${fp}`,positive:fp>0});}
    let sp=sugar<5?8:sugar<10?2:sugar>15?-10:sugar>10?-5:0; if(profile.goal==="diabetes"&&sugar>5)sp=Math.min(sp-6,-10); if(sp!==0){score+=sp;breakdown.push({label:"Sugar",pts:sp>0?`+${sp}`:`${sp}`,positive:sp>0});}
    const sodMg=n._sodium_mg||(salt*400); let sodp=sodMg<300?8:sodMg<600?3:sodMg>1200?-12:sodMg>800?-6:0; if(profile.goal==="heart_health"&&sodMg>500)sodp-=5; if(sodp!==0){score+=sodp;breakdown.push({label:`Sodium (${Math.round(sodMg)}mg)`,pts:sodp>0?`+${sodp}`:`${sodp}`,positive:sodp>0});}
    let sfp=satFat<2?6:satFat<4?2:satFat>8?-10:satFat>5?-5:0; if(profile.goal==="heart_health"&&satFat>3)sfp-=5; if(sfp!==0){score+=sfp;breakdown.push({label:"Sat Fat",pts:sfp>0?`+${sfp}`:`${sfp}`,positive:sfp>0});}
    let kp=kcal>=250&&kcal<=550?5:kcal>700?-8:kcal<150?-3:0; if(profile.goal==="weight_loss"&&kcal>400)kp-=5; if(profile.goal==="athletic"&&kcal>=400&&kcal<=700)kp+=4; if(kp!==0){score+=kp;breakdown.push({label:"Calories",pts:kp>0?`+${kp}`:`${kp}`,positive:kp>0});}
    const flagged=scanAdditives(product.ingredients_text); for(const a of flagged){const pen=a.mealPenalty??Math.round(a.penalty*0.75);score-=pen;breakdown.push({label:`Additive: ${a.name}`,pts:`-${pen}`,positive:false});}
  }
  const ns=(product.nutriscore_grade||"").toLowerCase();
  if(ns==="a"){score+=10;breakdown.push({label:"Nutri-Score A",pts:"+10",positive:true});}
  else if(ns==="b"){score+=5;breakdown.push({label:"Nutri-Score B",pts:"+5",positive:true});}
  else if(ns==="d"){score-=5;breakdown.push({label:"Nutri-Score D",pts:"-5",positive:false});}
  else if(ns==="e"){score-=10;breakdown.push({label:"Nutri-Score E",pts:"-10",positive:false});}
  if(profile.goal==="pregnancy"&&(n._iron||0)>3){score+=8;breakdown.push({label:"Iron (pregnancy)",pts:"+8",positive:true});}
  return { score:Math.max(0,Math.min(100,Math.round(score))), breakdown };
}

function scoreColor(s){return s>=75?"#2d6a4f":s>=55?"#74c69d":s>=35?"#f4a261":"#e63946";}
function scoreLabel(s){return s>=75?"Excellent":s>=55?"Good":s>=35?"Fair":"Poor";}
function severityColor(s){return s==="high"?"#e63946":s==="medium"?"#f4a261":"#999";}

async function fetchOFF(query) {
  const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=30&lc=en&fields=product_name,brands,ingredients_text,nutriments,nutriscore_grade,labels_tags,image_small_url,lang`);
  const data = await res.json();
  return (data.products||[])
    .filter(p => p.product_name && isEnglish(p))
    .map(p => ({...p, _source:"Open Food Facts"}));
}
async function fetchOFFBarcode(barcode) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
  const data = await res.json();
  if (data.status===1&&data.product?.product_name&&isEnglish(data.product)) return {...data.product, _source:"Open Food Facts"};
  return null;
}
async function fetchUSDA(query) {
  const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&dataType=Branded,Survey (FNDDS)&pageSize=15&api_key=${USDA_API_KEY}`);
  const data = await res.json();
  return (data.foods||[]).map(normaliseUsda);
}
function mergeResults(off, usda) {
  const seen=new Set(); const merged=[];
  for(const p of off){const key=p.product_name.toLowerCase().trim();if(!seen.has(key)){seen.add(key);merged.push(p);}}
  for(const p of usda){
    const key=p.product_name.toLowerCase().trim();
    const ex=merged.find(o=>o.product_name.toLowerCase().trim()===key);
    if(ex){const n=ex.nutriments||{};const u=p.nutriments||{};["proteins_100g","fiber_100g","sugars_100g","saturated-fat_100g","salt_100g","energy-kcal_100g","_vitC","_vitD","_calcium","_iron","_potassium","_omega3","carbohydrates_100g","fat_100g","_sodium_mg"].forEach(f=>{if(!n[f]&&u[f]){ex.nutriments[f]=u[f];ex._usdaPatched=true;}});}
    else if(!seen.has(key)){seen.add(key);merged.push(p);}
  }
  return merged;
}

const GOALS=[{id:"general",label:"General Health",icon:"🌿"},{id:"weight_loss",label:"Weight Loss",icon:"⚖️"},{id:"muscle_gain",label:"Muscle Gain",icon:"💪"},{id:"heart_health",label:"Heart Health",icon:"❤️"},{id:"diabetes",label:"Diabetes",icon:"🩺"},{id:"pregnancy",label:"Pregnancy",icon:"🤱"},{id:"athletic",label:"Athletic Performance",icon:"🏃"}];
const FILTERS=[{id:"high_protein",label:"High Protein"},{id:"low_sugar",label:"Low Sugar"},{id:"high_fibre",label:"High Fibre"},{id:"vegan",label:"Vegan"},{id:"no_additives",label:"⚠️ No Additives"}];
const TABS=["Search","Planner","Saved","Compare","Profile"];

// ─── POPULAR DISHES ───────────────────────────────────────────────────────────
const POPULAR_DISHES = ["Chicken Stir Fry","Spaghetti Bolognese","Salmon & Vegetables","Chicken Curry","Greek Salad","Egg Fried Rice","Beef Tacos","Vegetable Soup","Overnight Oats","Grilled Chicken Salad","Tuna Pasta","Lentil Soup","Chicken Fajitas","Buddha Bowl","Shakshuka"];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
function NutriFind() {
  const [tab, setTab]=useState("Search");
  const [searchMode, setSearchMode]=useState("ingredient");
  const [query, setQuery]=useState("");
  const [results, setResults]=useState([]);
  const [loading, setLoading]=useState(false);
  const [loadingMsg, setLoadingMsg]=useState("");
  const [searched, setSearched]=useState(false);
  const [expanded, setExpanded]=useState(null);
  const [activeFilters, setActiveFilters]=useState([]);
  const [aiTip, setAiTip]=useState("");
  const [aiLoading, setAiLoading]=useState(false);
  const [coverage, setCoverage]=useState({off:0,usda:0,patched:0});
  const [profile, setProfile]=useState(()=>lsGet(LS_PROFILE,{goal:"general",allergens:[],dietary:[]}));
  const [saved, setSaved]=useState(()=>lsGet(LS_SAVED,[]));
  const [compareList, setCompareList]=useState([]);
  const [shoppingList, setShoppingList]=useState(()=>lsGet(LS_SHOPPING,[]));
  const [showScanner, setShowScanner]=useState(false);
  const [scannerMsg, setScannerMsg]=useState("");
  // Planner state
  const [plannerDish, setPlannerDish]=useState("");
  const [plannerLoading, setPlannerLoading]=useState(false);
  const [plannerResult, setPlannerResult]=useState(null);
  const videoRef=useRef(null);
  const scanIntervalRef=useRef(null);

  useEffect(()=>{lsSet(LS_PROFILE,profile);},[profile]);
  useEffect(()=>{lsSet(LS_SAVED,saved);},[saved]);
  useEffect(()=>{lsSet(LS_SHOPPING,shoppingList);},[shoppingList]);

  const toggleFilter=id=>setActiveFilters(prev=>prev.includes(id)?prev.filter(f=>f!==id):[...prev,id]);
  const toggleSave=(product)=>{setSaved(prev=>{const key=product.product_name+product._source;return prev.find(p=>p.product_name+p._source===key)?prev.filter(p=>p.product_name+p._source!==key):[...prev,product];});};
  const toggleCompare=(product)=>{setCompareList(prev=>{const key=product.product_name+product._source;if(prev.find(p=>p.product_name+p._source===key))return prev.filter(p=>p.product_name+p._source!==key);if(prev.length>=3)return [...prev.slice(1),product];return [...prev,product];});};
  const isSaved=(product)=>saved.some(p=>p.product_name+p._source===product.product_name+product._source);
  const isCompared=(product)=>compareList.some(p=>p.product_name+p._source===product.product_name+product._source);

  const addToShoppingList=(item)=>{
    setShoppingList(prev=>{
      const exists=prev.find(i=>i.name===item.name);
      if(exists)return prev;
      return [...prev,{...item,checked:false,id:Date.now()+Math.random()}];
    });
  };
  const toggleShoppingItem=(id)=>setShoppingList(prev=>prev.map(i=>i.id===id?{...i,checked:!i.checked}:i));
  const removeShoppingItem=(id)=>setShoppingList(prev=>prev.filter(i=>i.id!==id));
  const clearChecked=()=>setShoppingList(prev=>prev.filter(i=>!i.checked));

  const fetchAiTip=useCallback(async(q,mode)=>{
    setAiLoading(true);setAiTip("");
    try {
      const goalLabel=GOALS.find(g=>g.id===profile.goal)?.label||"general health";
      const modeLabel=mode==="ingredient"?"a raw ingredient":mode==="meal"?"a packaged/prepared meal":"an ingredient for home cooking";
      const res=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:`You are a concise nutritionist. The user is searching for ${modeLabel} with a health goal of: ${goalLabel}. Give a 2-3 sentence practical tip tailored to their goal about what to look for and avoid. No bullet points, plain prose only.`,messages:[{role:"user",content:`What should I look for when buying: ${q}`}]})});
      const data=await res.json();setAiTip(data.content?.[0]?.text||"");
    } catch{setAiTip("");}
    setAiLoading(false);
  },[profile.goal]);

  // ─── MEAL PLANNER ─────────────────────────────────────────────────────────
  const planMeal=async(dishName)=>{
    const dish=dishName||plannerDish;
    if(!dish.trim())return;
    setPlannerLoading(true);setPlannerResult(null);
    try {
      const goalLabel=GOALS.find(g=>g.id===profile.goal)?.label||"general health";
      const allergenNote=(profile.allergens||[]).length>0?`The user is allergic to: ${profile.allergens.join(", ")}.`:"";

      // Step 1: Ask AI for ingredient list
      const res=await fetch("/.netlify/functions/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:`You are a nutritionist and chef. The user wants to cook a dish at home. Their health goal is ${goalLabel}. ${allergenNote} Return ONLY a JSON object with this exact structure, no other text, no markdown:\n{"dish":"<dish name>","servings":4,"ingredients":[{"name":"<simple ingredient name>","amount":"<amount>","unit":"<unit>","category":"<protein|vegetable|grain|dairy|fat|herb|other>","healthNote":"<one sentence why this is good>","substitution":"<one healthier or cheaper alternative if relevant, or null>"}],"cookingTip":"<one sentence tip for making this dish healthier>","totalEstimatedCost":"<estimated cost range in USD for all ingredients>"}`,messages:[{role:"user",content:`Break down the ingredients for: ${dish}. Optimise for ${goalLabel}. Keep ingredient names simple and searchable (e.g. "chicken breast" not "free-range organic chicken breast fillet").`}]})});
      const data=await res.json();
      const text=data.content?.[0]?.text||"{}";
      let parsed;
      try { parsed=JSON.parse(text.replace(/```json|```/g,"").trim()); }
      catch { parsed=null; }

      if(!parsed||!parsed.ingredients){setPlannerLoading(false);setPlannerResult({error:"Couldn't parse meal plan. Please try again."});return;}

      // Step 2: Search for best product for each ingredient
      const enriched=await Promise.all(parsed.ingredients.map(async(ing)=>{
        try {
          const [off,usda]=await Promise.all([fetchOFF(ing.name).catch(()=>[]),fetchUSDA(ing.name).catch(()=>[])]);
          const merged=mergeResults(off,usda);
          const products=merged.slice(0,5).map(p=>{
            const{score,breakdown}=calcHealthScore(p,profile,"ingredient");
            return{...p,_score:score,_breakdown:breakdown,_price:estimatePrice(p,"ingredient"),_additives:scanAdditives(p.ingredients_text)};
          }).sort((a,b)=>b._score-a._score);
          const best=products[0]||null;
          const store=getStoreGuidance(ing.name);
          return{...ing,bestProduct:best,storeGuidance:store,alternatives:products.slice(1,3)};
        } catch{return{...ing,bestProduct:null,storeGuidance:getStoreGuidance(ing.name),alternatives:[]};}
      }));

      setPlannerResult({...parsed,ingredients:enriched});
    } catch(e){setPlannerResult({error:"Something went wrong. Please try again."});}
    setPlannerLoading(false);
  };

  const processProducts=useCallback((products,modeOverride)=>{
    const mode=modeOverride||searchMode;
    return products.map(p=>{
      const effMode=detectMode(p)||mode;
      const{score,breakdown}=calcHealthScore(p,profile,effMode);
      return{...p,_score:score,_breakdown:breakdown,_price:estimatePrice(p,effMode),_additives:scanAdditives(p.ingredients_text),_allergenWarnings:checkAllergens(p.ingredients_text,profile.allergens),_effectiveMode:effMode,_processingLevel:calcProcessingLevel(p.ingredients_text),_mealCompleteness:effMode==="meal"?calcMealCompleteness(p.nutriments||{}):null};
    }).sort((a,b)=>b._score-a._score);
  },[profile,searchMode]);

  const search=async()=>{
    if(!query.trim())return;
    setLoading(true);setSearched(true);setResults([]);setExpanded(null);
    fetchAiTip(query,searchMode);
    let off=[],usda=[];
    try{setLoadingMsg("Searching Open Food Facts…");off=await fetchOFF(query);}catch{off=[];}
    try{setLoadingMsg("Searching USDA FoodData Central…");usda=await fetchUSDA(query);}catch{usda=[];}
    setLoadingMsg("Merging results…");
    const merged=mergeResults(off,usda);
    setCoverage({off:off.length,usda:usda.length,patched:merged.filter(p=>p._usdaPatched).length});
    // Translate any non-English product names before scoring
    setLoadingMsg("Translating product names to English…");
    const translated=await translateProductNames(merged);
    setResults(processProducts(translated));
    setLoading(false);setLoadingMsg("");
  };

  const startScanner=async()=>{
    setShowScanner(true);setScannerMsg("Starting camera…");
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
      if(videoRef.current){videoRef.current.srcObject=stream;videoRef.current.play();}
      setScannerMsg("Point camera at a barcode");
      if("BarcodeDetector" in window){
        const detector=new window.BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]});
        scanIntervalRef.current=setInterval(async()=>{
          if(!videoRef.current)return;
          try{const barcodes=await detector.detect(videoRef.current);if(barcodes.length>0){clearInterval(scanIntervalRef.current);const code=barcodes[0].rawValue;setScannerMsg(`Found: ${code} — looking up…`);const product=await fetchOFFBarcode(code);stopScanner();if(product){const processed=processProducts([product]);setResults(prev=>[...processed,...prev.filter(p=>p.product_name!==product.product_name)]);setSearched(true);setTab("Search");}else setScannerMsg("Product not found. Try searching manually.");}
          }catch{}
        },500);
      }else setScannerMsg("Barcode scanning not supported on this browser.");
    }catch{setScannerMsg("Camera access denied.");}
  };
  const stopScanner=()=>{
    clearInterval(scanIntervalRef.current);
    if(videoRef.current?.srcObject)videoRef.current.srcObject.getTracks().forEach(t=>t.stop());
    setShowScanner(false);setScannerMsg("");
  };

  const filtered=results.filter(p=>{
    const n=p.nutriments||{};
    if(activeFilters.includes("high_protein")&&(n.proteins_100g||0)<10)return false;
    if(activeFilters.includes("low_sugar")&&(n.sugars_100g||0)>5)return false;
    if(activeFilters.includes("high_fibre")&&(n.fiber_100g||n.fibre_100g||0)<3)return false;
    if(activeFilters.includes("vegan")&&!(p.labels_tags||[]).some(t=>t.includes("vegan")))return false;
    if(activeFilters.includes("no_additives")&&p._additives.length>0)return false;
    return true;
  });
  const top=filtered[0];const rest=filtered.slice(1);
  const goalIcon=GOALS.find(g=>g.id===profile.goal)?.icon||"🌿";
  const currentMode=SEARCH_MODES.find(m=>m.id===searchMode);

  return (
    <div style={{minHeight:"100vh",background:"#f5f0e8",paddingBottom:80}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Source+Sans+3:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .nt{font-family:'Playfair Display',serif} .nb{font-family:'Source Sans 3',sans-serif}
        .card{background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.07);transition:box-shadow .2s}
        .card:hover{box-shadow:0 4px 20px rgba(0,0,0,.13)}
        .fbtn{cursor:pointer;border:1.5px solid #2d6a4f;border-radius:20px;padding:5px 14px;font-size:.8rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#2d6a4f;transition:all .15s}
        .fbtn.on{background:#2d6a4f;color:#fff} .fbtn:hover{background:#2d6a4f;color:#fff}
        .ring{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;font-weight:700;font-size:1rem;color:#fff;font-family:'Source Sans 3',sans-serif;flex-shrink:0}
        .xbtn{background:none;border:none;cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:.82rem;color:#2d6a4f;text-decoration:underline;padding:0}
        .sbadge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:8px;font-size:.7rem;font-family:'Source Sans 3',sans-serif;font-weight:600}
        .dot{display:inline-block;animation:pulse 1.2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
        .tabnav{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e8e4dc;display:flex;z-index:100}
        .tabitem{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 2px;cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:.65rem;color:#aaa;border:none;background:none;transition:color .15s}
        .tabitem.active{color:#2d6a4f;font-weight:700}
        .iconbtn{background:none;border:1.5px solid currentColor;border-radius:8px;padding:3px 9px;cursor:pointer;font-family:'Source Sans 3',sans-serif;font-size:.72rem;transition:all .15s}
        .goalchip{cursor:pointer;border:1.5px solid #ddd;border-radius:20px;padding:6px 14px;font-size:.82rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#555;transition:all .15s;display:inline-flex;align-items:center;gap:5px}
        .goalchip.on{border-color:#2d6a4f;background:#e9f5ee;color:#2d6a4f;font-weight:600}
        .allerchip{cursor:pointer;border:1.5px solid #ddd;border-radius:20px;padding:5px 12px;font-size:.8rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#555;transition:all .15s}
        .allerchip.on{border-color:#e63946;background:#fdecea;color:#e63946;font-weight:600}
        .scanner-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
        .modebtn{cursor:pointer;border:2px solid transparent;border-radius:12px;padding:8px 14px;font-family:'Source Sans 3',sans-serif;background:rgba(255,255,255,.1);color:#d8f3dc;transition:all .2s;display:flex;flex-direction:column;align-items:center;gap:2px;flex:1}
        .modebtn.on{border-color:#d4a017;background:rgba(212,160,23,.25);color:#fff}
        .modebtn:hover{background:rgba(255,255,255,.2)}
        .breakdown-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-family:'Source Sans 3',sans-serif;font-size:.8rem;border-bottom:1px solid #f5f0e8}
        .micro-pill{display:inline-flex;flex-direction:column;align-items:center;background:#f5f0e8;border-radius:8px;padding:4px 9px;font-family:'Source Sans 3',sans-serif}
        .dish-chip{cursor:pointer;border:1px solid #d4a017;border-radius:20px;padding:5px 13px;font-size:.8rem;font-family:'Source Sans 3',sans-serif;background:#fff;color:#856404;transition:all .15s;white-space:nowrap}
        .dish-chip:hover{background:#d4a017;color:#fff}
        .ing-card{background:#f9f7f3;border:1px solid #e8e4dc;border-radius:12px;padding:14px;margin-bottom:10px}
        .shop-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0ebe0}
        input:focus,button:focus{outline:2px solid #2d6a4f}
      `}</style>

      {showScanner&&(
        <div className="scanner-overlay">
          <div className="nb" style={{color:"#fff",fontSize:"1rem",fontWeight:600}}>📷 Barcode Scanner</div>
          <video ref={videoRef} style={{width:"min(340px,90vw)",borderRadius:12,background:"#000"}} playsInline muted/>
          <div className="nb" style={{color:"#95d5b2",fontSize:".9rem",textAlign:"center",maxWidth:300}}>{scannerMsg}</div>
          <button onClick={stopScanner} style={{background:"#e63946",color:"#fff",border:"none",borderRadius:10,padding:"10px 24px",fontFamily:"'Source Sans 3',sans-serif",fontWeight:700,cursor:"pointer"}}>Cancel</button>
        </div>
      )}

      {/* Hero */}
      <div style={{background:"linear-gradient(135deg,#1b4332 0%,#2d6a4f 100%)",padding:"32px 16px 24px",textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:10,marginBottom:4}}>
          <h1 className="nt" style={{fontSize:"clamp(1.8rem,6vw,2.8rem)",color:"#d8f3dc",fontWeight:900,letterSpacing:"-0.5px"}}>NutriFind</h1>
          <span style={{fontSize:"1.3rem"}}>{goalIcon}</span>
        </div>
        <p className="nb" style={{color:"#95d5b2",fontSize:".8rem",marginBottom:14}}>English results · Dual database · Additive-aware · Personalised</p>

        {tab==="Search"&&(
          <>
            <div style={{display:"flex",gap:8,marginBottom:14,maxWidth:520,margin:"0 auto 14px"}}>
              {SEARCH_MODES.map(m=>(
                <button key={m.id} className={`modebtn${searchMode===m.id?" on":""}`} onClick={()=>setSearchMode(m.id)}>
                  <span style={{fontSize:"1.3rem"}}>{m.icon}</span>
                  <span className="nb" style={{fontSize:".75rem",fontWeight:700}}>{m.label}</span>
                </button>
              ))}
            </div>
            <div style={{display:"flex",maxWidth:520,margin:"0 auto",gap:8}}>
              <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()}
                placeholder={searchMode==="ingredient"?"e.g. chicken breast, oats, spinach…":searchMode==="meal"?"e.g. lasagne, protein bar, soup…":"e.g. chicken stir fry, spaghetti…"}
                style={{flex:1,padding:"12px 16px",borderRadius:10,border:"none",fontSize:"1rem",background:"#fff",fontFamily:"'Source Sans 3',sans-serif"}}/>
              <button onClick={search} style={{background:"#d4a017",color:"#1a1a1a",border:"none",borderRadius:10,padding:"12px 16px",fontWeight:700,fontSize:".9rem",cursor:"pointer",fontFamily:"'Source Sans 3',sans-serif",whiteSpace:"nowrap"}}>Search</button>
              <button onClick={startScanner} style={{background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)",borderRadius:10,padding:"12px 13px",cursor:"pointer",fontSize:"1.1rem"}} title="Scan barcode">📷</button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:10}}>
              {(searchMode==="ingredient"?["Oats","Chicken Breast","Spinach","Salmon","Almonds","Greek Yogurt"]:searchMode==="meal"?["Chicken Soup","Granola Bar","Frozen Lasagne","Protein Bar","Instant Noodles"]:[]).map(q=>(
                <button key={q} onClick={()=>setQuery(q)} style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.25)",color:"#d8f3dc",borderRadius:16,padding:"3px 11px",fontSize:".78rem",cursor:"pointer",fontFamily:"'Source Sans 3',sans-serif"}}>{q}</button>
              ))}
            </div>
          </>
        )}

        {tab==="Planner"&&(
          <div style={{maxWidth:520,margin:"0 auto"}}>
            <p className="nb" style={{color:"#95d5b2",fontSize:".85rem",marginBottom:12}}>Type a dish and we'll find the healthiest ingredients and where to buy them</p>
            <div style={{display:"flex",gap:8}}>
              <input value={plannerDish} onChange={e=>setPlannerDish(e.target.value)} onKeyDown={e=>e.key==="Enter"&&planMeal()}
                placeholder="e.g. Chicken Stir Fry, Spaghetti Bolognese…"
                style={{flex:1,padding:"12px 16px",borderRadius:10,border:"none",fontSize:"1rem",background:"#fff",fontFamily:"'Source Sans 3',sans-serif"}}/>
              <button onClick={()=>planMeal()} style={{background:"#d4a017",color:"#1a1a1a",border:"none",borderRadius:10,padding:"12px 16px",fontWeight:700,fontSize:".9rem",cursor:"pointer",fontFamily:"'Source Sans 3',sans-serif"}}>Plan</button>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center",marginTop:10,overflowX:"auto",paddingBottom:4}}>
              {POPULAR_DISHES.slice(0,8).map(d=>(
                <button key={d} className="dish-chip" onClick={()=>{setPlannerDish(d);planMeal(d);}}>{d}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{maxWidth:640,margin:"0 auto",padding:"0 14px 20px"}}>

        {/* ── SEARCH TAB ── */}
        {tab==="Search"&&(
          <>
            {(aiLoading||aiTip)&&(
              <div style={{background:"#e9f5ee",border:"1px solid #b7e4c7",borderRadius:12,padding:"12px 16px",marginTop:16}}>
                <div className="nb" style={{fontSize:".7rem",color:"#2d6a4f",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{currentMode?.icon} {currentMode?.label} Tip · {GOALS.find(g=>g.id===profile.goal)?.label}</div>
                {aiLoading?<div className="nb" style={{color:"#555",fontSize:".88rem"}}>Analysing<span className="dot">…</span></div>:<p className="nb" style={{color:"#333",fontSize:".88rem",lineHeight:1.55}}>{aiTip}</p>}
              </div>
            )}
            {!loading&&searched&&results.length>0&&(
              <div style={{display:"flex",gap:6,marginTop:12,flexWrap:"wrap"}}>
                <span className="sbadge" style={{background:"#e8f4fd",color:"#1a6fa8"}}>📦 {coverage.off} Open Food Facts</span>
                <span className="sbadge" style={{background:"#f0f8e8",color:"#3a7d27"}}>🌾 {coverage.usda} USDA</span>
                {coverage.patched>0&&<span className="sbadge" style={{background:"#f5f0ff",color:"#6a3fa8"}}>✨ {coverage.patched} enriched</span>}
                <span className="sbadge" style={{background:"#e8f4fd",color:"#1a6fa8"}}>🌐 English names</span>
              </div>
            )}
            {searched&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>
                {FILTERS.map(f=><button key={f.id} className={`fbtn${activeFilters.includes(f.id)?" on":""}`} onClick={()=>toggleFilter(f.id)}>{f.label}</button>)}
                {compareList.length>0&&<button className="fbtn on" onClick={()=>setTab("Compare")} style={{background:"#d4a017",borderColor:"#d4a017"}}>⚖️ Compare ({compareList.length})</button>}
              </div>
            )}
            {loading&&<div style={{textAlign:"center",padding:"60px 0"}}><div className="nb" style={{color:"#2d6a4f",fontSize:"1rem",fontWeight:600}}>{loadingMsg} <span className="dot">●</span></div><div className="nb" style={{color:"#aaa",fontSize:".78rem",marginTop:6}}>Non-English names are automatically translated</div></div>}
            {!loading&&searched&&filtered.length===0&&<div style={{textAlign:"center",padding:"60px 0"}}><div className="nb" style={{color:"#888"}}>No products found. Try removing filters or broadening your search.</div></div>}
            {!loading&&top&&(
              <div style={{marginTop:18}}>
                <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",color:"#2d6a4f",marginBottom:7}}>★ Top Pick</div>
                <ProductCard product={top} isTop expanded={expanded} setExpanded={setExpanded} isSaved={isSaved(top)} toggleSave={toggleSave} isCompared={isCompared(top)} toggleCompare={toggleCompare}/>
              </div>
            )}
            {!loading&&rest.length>0&&(
              <div style={{marginTop:18}}>
                <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".1em",color:"#888",marginBottom:8}}>Other Options</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>{rest.map((p,i)=><ProductCard key={i} product={p} expanded={expanded} setExpanded={setExpanded} isSaved={isSaved(p)} toggleSave={toggleSave} isCompared={isCompared(p)} toggleCompare={toggleCompare}/>)}</div>
              </div>
            )}
          </>
        )}

        {/* ── PLANNER TAB ── */}
        {tab==="Planner"&&(
          <div style={{marginTop:20}}>
            {plannerLoading&&(
              <div style={{textAlign:"center",padding:"60px 0"}}>
                <div style={{fontSize:"2.5rem",marginBottom:12}}>👨‍🍳</div>
                <div className="nb" style={{color:"#2d6a4f",fontSize:"1rem",fontWeight:600}}>Building your meal plan<span className="dot">…</span></div>
                <div className="nb" style={{color:"#aaa",fontSize:".8rem",marginTop:6}}>Finding healthiest ingredients & where to buy them</div>
              </div>
            )}

            {plannerResult?.error&&<div style={{textAlign:"center",padding:"40px 0"}}><div className="nb" style={{color:"#e63946"}}>{plannerResult.error}</div></div>}

            {plannerResult&&!plannerResult.error&&(
              <>
                {/* Dish header */}
                <div className="card" style={{padding:"16px 18px",marginBottom:16,background:"linear-gradient(135deg,#1b4332,#2d6a4f)",border:"none"}}>
                  <div className="nt" style={{fontSize:"1.3rem",fontWeight:700,color:"#d8f3dc"}}>{plannerResult.dish}</div>
                  <div style={{display:"flex",gap:12,marginTop:8,flexWrap:"wrap"}}>
                    <span className="nb" style={{color:"#95d5b2",fontSize:".82rem"}}>👥 Serves {plannerResult.servings}</span>
                    <span className="nb" style={{color:"#95d5b2",fontSize:".82rem"}}>💰 Est. {plannerResult.totalEstimatedCost}</span>
                  </div>
                  {plannerResult.cookingTip&&<div style={{marginTop:10,background:"rgba(255,255,255,.1)",borderRadius:8,padding:"8px 12px"}}><p className="nb" style={{color:"#d8f3dc",fontSize:".82rem",lineHeight:1.5}}>💡 {plannerResult.cookingTip}</p></div>}
                  <button onClick={()=>{plannerResult.ingredients.forEach(ing=>{if(ing.bestProduct){addToShoppingList({name:ing.name,amount:ing.amount,unit:ing.unit,product:ing.bestProduct.product_name,price:ing.bestProduct._price,stores:ing.storeGuidance?.stores||[]});}else addToShoppingList({name:ing.name,amount:ing.amount,unit:ing.unit,product:null,price:null,stores:ing.storeGuidance?.stores||[]});});setTab("Saved");}}
                    style={{marginTop:12,background:"#d4a017",color:"#1a1a1a",border:"none",borderRadius:8,padding:"8px 16px",fontWeight:700,fontSize:".85rem",cursor:"pointer",fontFamily:"'Source Sans 3',sans-serif",width:"100%"}}>
                    Add All to Shopping List 🛒
                  </button>
                </div>

                {/* Ingredients */}
                {plannerResult.ingredients.map((ing,i)=>(
                  <div key={i} className="ing-card">
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
                      <div>
                        <div className="nt" style={{fontSize:"1rem",fontWeight:700,color:"#1a1a1a"}}>{ing.name}</div>
                        <div className="nb" style={{fontSize:".8rem",color:"#888",marginTop:2}}>{ing.amount} {ing.unit}</div>
                      </div>
                      <span className="nb" style={{fontSize:".72rem",padding:"3px 9px",borderRadius:8,background:ing.category==="protein"?"#e8f4fd":ing.category==="vegetable"?"#e9f5ee":ing.category==="grain"?"#fff3cd":"#f5f0e8",color:ing.category==="protein"?"#1a6fa8":ing.category==="vegetable"?"#2d6a4f":ing.category==="grain"?"#856404":"#555",fontWeight:600}}>
                        {ing.category}
                      </span>
                    </div>

                    {ing.healthNote&&<p className="nb" style={{fontSize:".8rem",color:"#2d6a4f",marginBottom:8,fontStyle:"italic"}}>✓ {ing.healthNote}</p>}

                    {/* Best product found */}
                    {ing.bestProduct?(
                      <div style={{background:"#fff",border:"1px solid #e8e4dc",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                          <div style={{minWidth:0}}>
                            <div className="nb" style={{fontSize:".78rem",fontWeight:700,color:"#2d6a4f"}}>Best Match Found</div>
                            <div className="nb" style={{fontSize:".85rem",fontWeight:600,color:"#1a1a1a",marginTop:2}}>{ing.bestProduct.product_name}</div>
                            {ing.bestProduct.brands&&<div className="nb" style={{fontSize:".72rem",color:"#aaa"}}>{ing.bestProduct.brands}</div>}
                          </div>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
                            <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:38,height:38,borderRadius:"50%",background:scoreColor(ing.bestProduct._score),color:"#fff",fontWeight:700,fontSize:".9rem",fontFamily:"'Source Sans 3',sans-serif"}}>{ing.bestProduct._score}</div>
                            <div className="nb" style={{fontSize:".65rem",fontWeight:700,color:"#2d6a4f"}}>{ing.bestProduct._price}</div>
                          </div>
                        </div>
                        <button onClick={()=>addToShoppingList({name:ing.name,amount:ing.amount,unit:ing.unit,product:ing.bestProduct.product_name,price:ing.bestProduct._price,stores:ing.storeGuidance?.stores||[]})}
                          style={{marginTop:8,width:"100%",background:"#e9f5ee",color:"#2d6a4f",border:"1px solid #b7e4c7",borderRadius:7,padding:"6px",fontWeight:700,fontSize:".78rem",cursor:"pointer",fontFamily:"'Source Sans 3',sans-serif"}}>
                          + Add to Shopping List
                        </button>
                      </div>
                    ):(
                      <div style={{background:"#f9f7f3",border:"1px solid #e8e4dc",borderRadius:10,padding:"10px 12px",marginBottom:8}}>
                        <div className="nb" style={{fontSize:".8rem",color:"#888"}}>No exact match found in databases — search manually for "{ing.name}"</div>
                      </div>
                    )}

                    {/* Store guidance */}
                    {ing.storeGuidance&&(
                      <div style={{background:"#fff8e6",border:"1px solid #ffd97d",borderRadius:8,padding:"8px 10px"}}>
                        <div className="nb" style={{fontSize:".72rem",fontWeight:700,color:"#856404",marginBottom:3}}>🏪 Where to Buy</div>
                        <div className="nb" style={{fontSize:".78rem",color:"#856404"}}>{ing.storeGuidance.stores.join(" · ")}</div>
                        <div className="nb" style={{fontSize:".75rem",color:"#a0722a",marginTop:3,fontStyle:"italic"}}>{ing.storeGuidance.tip}</div>
                      </div>
                    )}

                    {ing.substitution&&<div className="nb" style={{fontSize:".75rem",color:"#888",marginTop:6,fontStyle:"italic"}}>💡 Swap: {ing.substitution}</div>}
                  </div>
                ))}
              </>
            )}

            {!plannerLoading&&!plannerResult&&(
              <div style={{textAlign:"center",padding:"40px 0"}}>
                <div style={{fontSize:"3rem",marginBottom:12}}>👨‍🍳</div>
                <div className="nt" style={{fontSize:"1.2rem",fontWeight:700,marginBottom:8}}>Cook Your Own Meal</div>
                <div className="nb" style={{color:"#888",fontSize:".88rem",lineHeight:1.6,maxWidth:400,margin:"0 auto"}}>Type any dish above and NutriFind will break it into ingredients, find the healthiest versions, estimate costs, and tell you the best stores to shop at.</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",marginTop:20}}>
                  {POPULAR_DISHES.map(d=><button key={d} className="dish-chip" onClick={()=>{setPlannerDish(d);planMeal(d);}}>{d}</button>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SAVED TAB (now includes shopping list) ── */}
        {tab==="Saved"&&(
          <div style={{marginTop:20}}>
            {/* Shopping list */}
            <div className="nt" style={{fontSize:"1.2rem",fontWeight:700,marginBottom:4}}>🛒 Shopping List</div>
            <div className="nb" style={{fontSize:".8rem",color:"#888",marginBottom:12}}>Added from meal planner. Check items off as you shop.</div>
            {shoppingList.length>0?(
              <>
                {shoppingList.map(item=>(
                  <div key={item.id} className="shop-item">
                    <input type="checkbox" checked={item.checked} onChange={()=>toggleShoppingItem(item.id)} style={{width:18,height:18,cursor:"pointer",accentColor:"#2d6a4f",flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="nb" style={{fontSize:".88rem",fontWeight:600,textDecoration:item.checked?"line-through":"none",color:item.checked?"#aaa":"#1a1a1a"}}>{item.name} <span style={{fontWeight:400,color:"#aaa"}}>— {item.amount} {item.unit}</span></div>
                      {item.product&&<div className="nb" style={{fontSize:".75rem",color:"#888",marginTop:1}}>Best pick: {item.product} {item.price&&`· ${item.price}`}</div>}
                      {item.stores?.length>0&&<div className="nb" style={{fontSize:".72rem",color:"#d4a017",marginTop:1}}>🏪 {item.stores.slice(0,2).join(" · ")}</div>}
                    </div>
                    <button onClick={()=>removeShoppingItem(item.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",fontSize:"1.1rem",padding:"0 4px"}}>✕</button>
                  </div>
                ))}
                {shoppingList.some(i=>i.checked)&&<button onClick={clearChecked} style={{marginTop:12,background:"none",border:"1px solid #ddd",borderRadius:8,padding:"6px 14px",fontFamily:"'Source Sans 3',sans-serif",fontSize:".8rem",color:"#888",cursor:"pointer"}}>Clear checked items</button>}
              </>
            ):(
              <div style={{textAlign:"center",padding:"30px 0",marginBottom:24}}>
                <div className="nb" style={{color:"#aaa",fontSize:".85rem"}}>No shopping list yet. Use the Cook My Own Meal planner to build one.</div>
              </div>
            )}

            {/* Saved products */}
            <div className="nt" style={{fontSize:"1.2rem",fontWeight:700,marginTop:28,marginBottom:12}}>🔖 Saved Products</div>
            {saved.length===0
              ?<div style={{textAlign:"center",padding:"30px 0"}}><div className="nb" style={{color:"#888",fontSize:".85rem"}}>No saved products yet. Search and tap Save on any product.</div></div>
              :<div style={{display:"flex",flexDirection:"column",gap:10}}>{processProducts(saved).map((p,i)=><ProductCard key={i} product={p} expanded={expanded} setExpanded={setExpanded} isSaved toggleSave={toggleSave} isCompared={isCompared(p)} toggleCompare={toggleCompare}/>)}</div>}
          </div>
        )}

        {/* ── COMPARE TAB ── */}
        {tab==="Compare"&&(
          <div style={{marginTop:20}}>
            <div className="nt" style={{fontSize:"1.3rem",fontWeight:700,marginBottom:4}}>Compare Products</div>
            <div className="nb" style={{fontSize:".8rem",color:"#888",marginBottom:14}}>Add up to 3 products from search results.</div>
            {compareList.length===0
              ?<div style={{textAlign:"center",padding:"60px 0"}}><div style={{fontSize:"2.5rem",marginBottom:12}}>⚖️</div><div className="nb" style={{color:"#888"}}>Tap Compare on any product card to add it here.</div></div>
              :<div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:300}}>
                  <thead>
                    <tr>
                      <td style={{padding:"7px 4px",fontFamily:"'Source Sans 3',sans-serif",fontSize:".7rem",color:"#aaa",textTransform:"uppercase",letterSpacing:".06em"}}>Per 100g</td>
                      {compareList.map((p,i)=>(
                        <td key={i} style={{padding:"7px 8px",verticalAlign:"top"}}>
                          <div className="nb" style={{fontSize:".78rem",fontWeight:700,lineHeight:1.3}}>{p.product_name.length>26?p.product_name.slice(0,24)+"…":p.product_name}</div>
                          <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:"50%",background:scoreColor(p._score),color:"#fff",fontWeight:700,fontSize:".85rem",fontFamily:"'Source Sans 3',sans-serif",marginTop:4}}>{p._score}</div>
                          <button onClick={()=>toggleCompare(p)} style={{display:"block",marginTop:3,background:"none",border:"none",cursor:"pointer",color:"#e63946",fontSize:".7rem",fontFamily:"'Source Sans 3',sans-serif"}}>Remove</button>
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {label:"Est. Price",fn:p=>p._price},
                      {label:"Calories",fn:p=>p.nutriments?.["energy-kcal_100g"]?`${Math.round(p.nutriments["energy-kcal_100g"])} kcal`:"—"},
                      {label:"Protein",fn:p=>p.nutriments?.proteins_100g?`${Number(p.nutriments.proteins_100g).toFixed(1)}g`:"—"},
                      {label:"Fibre",fn:p=>(p.nutriments?.fiber_100g||p.nutriments?.fibre_100g)?`${Number(p.nutriments.fiber_100g||p.nutriments.fibre_100g).toFixed(1)}g`:"—"},
                      {label:"Sugar",fn:p=>p.nutriments?.sugars_100g!=null?`${Number(p.nutriments.sugars_100g).toFixed(1)}g`:"—"},
                      {label:"Sat Fat",fn:p=>p.nutriments?.["saturated-fat_100g"]!=null?`${Number(p.nutriments["saturated-fat_100g"]).toFixed(1)}g`:"—"},
                      {label:"Sodium",fn:p=>p.nutriments?._sodium_mg?`${Math.round(p.nutriments._sodium_mg)}mg`:"—"},
                      {label:"Vit C",fn:p=>p.nutriments?._vitC?`${Number(p.nutriments._vitC).toFixed(0)}mg`:"—"},
                      {label:"Iron",fn:p=>p.nutriments?._iron?`${Number(p.nutriments._iron).toFixed(1)}mg`:"—"},
                      {label:"Processing",fn:p=>p._processingLevel?.label||"—"},
                      {label:"Meal Balance",fn:p=>p._mealCompleteness?.label||"—"},
                      {label:"Additives",fn:p=>p._additives?.length>0?`⚠️ ${p._additives.length}`:"✓ Clean"},
                      {label:"Source",fn:p=>p._source},
                    ].map((row,ri)=>(
                      <tr key={ri} style={{background:ri%2===0?"#f9f7f3":"#fff"}}>
                        <td style={{padding:"6px 4px",fontFamily:"'Source Sans 3',sans-serif",fontSize:".72rem",color:"#888",whiteSpace:"nowrap"}}>{row.label}</td>
                        {compareList.map((p,ci)=><td key={ci} style={{padding:"6px 8px",fontFamily:"'Source Sans 3',sans-serif",fontSize:".82rem",fontWeight:600}}>{row.fn(p)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
          </div>
        )}

        {/* ── PROFILE TAB ── */}
        {tab==="Profile"&&(
          <div style={{marginTop:20}}>
            <div className="nt" style={{fontSize:"1.3rem",fontWeight:700,marginBottom:4}}>Your Health Profile</div>
            <div className="nb" style={{fontSize:".83rem",color:"#666",marginBottom:18,lineHeight:1.5}}>Personalises scores, AI tips, and meal plans. Saved automatically.</div>
            <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"#2d6a4f",marginBottom:9}}>Health Goal</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:22}}>{GOALS.map(g=><button key={g.id} className={`goalchip${profile.goal===g.id?" on":""}`} onClick={()=>setProfile(prev=>({...prev,goal:g.id}))}>{g.icon} {g.label}</button>)}</div>
            <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"#e63946",marginBottom:9}}>Allergens to Flag</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:22}}>{ALLERGENS.map(a=><button key={a} className={`allerchip${(profile.allergens||[]).includes(a)?" on":""}`} onClick={()=>setProfile(prev=>({...prev,allergens:(prev.allergens||[]).includes(a)?prev.allergens.filter(x=>x!==a):[...(prev.allergens||[]),a]}))}>{a}</button>)}</div>
            <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"#888",marginBottom:9}}>Dietary Preferences</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:22}}>{["Vegan","Vegetarian","Gluten-Free","Dairy-Free","Keto","Paleo","Halal","Kosher"].map(d=><button key={d} className={`fbtn${(profile.dietary||[]).includes(d)?" on":""}`} onClick={()=>setProfile(prev=>({...prev,dietary:(prev.dietary||[]).includes(d)?prev.dietary.filter(x=>x!==d):[...(prev.dietary||[]),d]}))}>{d}</button>)}</div>
            <div className="card" style={{padding:"14px 16px",background:"#e9f5ee",border:"1px solid #b7e4c7"}}>
              <div className="nb" style={{fontSize:".82rem",color:"#2d6a4f",lineHeight:1.6}}>
                <strong>Profile active:</strong> Scoring calibrated for <strong>{GOALS.find(g=>g.id===profile.goal)?.label}</strong>.{(profile.allergens||[]).length>0&&<span> Allergens flagged: <strong>{profile.allergens.join(", ")}</strong>.</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      <nav className="tabnav">
        {TABS.map(t=>(
          <button key={t} className={`tabitem${tab===t?" active":""}`} onClick={()=>setTab(t)}>
            <span style={{fontSize:"1.1rem",marginBottom:1}}>
              {t==="Search"?"🔍":t==="Planner"?"👨‍🍳":t==="Saved"?`🛒${shoppingList.length>0?` ${shoppingList.length}`:""}`:t==="Compare"?`⚖️${compareList.length>0?` ${compareList.length}`:""}`:""}{t==="Profile"?"👤":""}
            </span>
            {t}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── PRODUCT CARD ─────────────────────────────────────────────────────────────
function ProductCard({product,isTop,expanded,setExpanded,isSaved,toggleSave,isCompared,toggleCompare}){
  const uid=product.product_name+product._source;
  const isOpen=expanded===uid;
  const score=product._score;
  const additives=product._additives||[];
  const breakdown=product._breakdown||[];
  const allergenWarnings=product._allergenWarnings||[];
  const n=product.nutriments||{};
  const mode=product._effectiveMode||"ingredient";
  const proc=product._processingLevel;
  const completeness=product._mealCompleteness;

  const stats=[
    {label:"Kcal",val:n["energy-kcal_100g"]?Math.round(n["energy-kcal_100g"]):"—"},
    {label:"Protein",val:n.proteins_100g?`${Number(n.proteins_100g).toFixed(1)}g`:"—"},
    {label:"Fibre",val:(n.fiber_100g||n.fibre_100g)?`${Number(n.fiber_100g||n.fibre_100g).toFixed(1)}g`:"—"},
    {label:"Sugar",val:n.sugars_100g!=null?`${Number(n.sugars_100g).toFixed(1)}g`:"—"},
    {label:"Sat Fat",val:n["saturated-fat_100g"]!=null?`${Number(n["saturated-fat_100g"]).toFixed(1)}g`:"—"},
    {label:mode==="meal"?"Sodium":"Salt",val:mode==="meal"&&n._sodium_mg?`${Math.round(n._sodium_mg)}mg`:n.salt_100g!=null?`${Number(n.salt_100g).toFixed(2)}g`:"—"},
  ];
  const micros=[
    {label:"Vit C",val:n._vitC?`${Number(n._vitC).toFixed(0)}mg`:null},
    {label:"Vit D",val:n._vitD?`${Number(n._vitD).toFixed(1)}μg`:null},
    {label:"Calcium",val:n._calcium?`${Math.round(n._calcium)}mg`:null},
    {label:"Iron",val:n._iron?`${Number(n._iron).toFixed(1)}mg`:null},
    {label:"K⁺",val:n._potassium?`${Math.round(n._potassium)}mg`:null},
    {label:"Ω-3",val:n._omega3?`${Number(n._omega3).toFixed(2)}g`:null},
  ].filter(m=>m.val);
  const srcStyle=product._source==="USDA"?{bg:"#f0f8e8",color:"#3a7d27"}:{bg:"#e8f4fd",color:"#1a6fa8"};

  return(
    <div className="card" style={{padding:"13px 15px",border:isTop?"2px solid #2d6a4f":"1px solid #e8e4dc"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}>
        <span className="nb" style={{fontSize:".65rem",fontWeight:700,padding:"2px 7px",borderRadius:7,background:mode==="ingredient"?"#e9f5ee":"#fff3cd",color:mode==="ingredient"?"#2d6a4f":"#856404"}}>
          {mode==="ingredient"?"🥦 Ingredient":"🍱 Prepared Meal"}
        </span>
        {proc&&mode==="ingredient"&&<span className="nb" style={{fontSize:".65rem",fontWeight:700,padding:"2px 7px",borderRadius:7,background:proc.color+"18",color:proc.color}}>{proc.label}</span>}
        {completeness&&mode==="meal"&&<span className="nb" style={{fontSize:".65rem",fontWeight:700,padding:"2px 7px",borderRadius:7,background:completeness.color+"18",color:completeness.color}}>Balance: {completeness.label}</span>}
      </div>
      {allergenWarnings.length>0&&<div style={{background:"#fff3cd",border:"1px solid #ffc107",borderRadius:8,padding:"5px 10px",marginBottom:8}}><span className="nb" style={{fontSize:".75rem",color:"#856404",fontWeight:700}}>🚨 Allergens: {allergenWarnings.join(", ")}</span></div>}
      <div style={{display:"flex",gap:11,alignItems:"flex-start"}}>
        {product.image_small_url&&<img src={product.image_small_url} alt="" style={{width:48,height:48,borderRadius:8,objectFit:"cover",flexShrink:0}}/>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div style={{minWidth:0}}>
              <div className="nt" style={{fontWeight:700,fontSize:".92rem",lineHeight:1.3,color:"#1a1a1a"}}>{product.product_name}</div>
              {product._translated&&<div className="nb" style={{fontSize:".65rem",color:"#888",marginTop:1,fontStyle:"italic"}}>🌐 Translated from: {product._originalName}</div>}
              {product.brands&&<div className="nb" style={{fontSize:".72rem",color:"#888",marginTop:1}}>{product.brands}</div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:2,flexShrink:0}}>
              <div className="ring" style={{background:scoreColor(score)}}>{score}</div>
              <div className="nb" style={{fontSize:".65rem",color:scoreColor(score),fontWeight:600}}>{scoreLabel(score)}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6,flexWrap:"wrap"}}>
            <span className="nb" style={{fontSize:".82rem",fontWeight:700,color:"#2d6a4f"}}>est. {product._price}</span>
            <span className="sbadge" style={{background:srcStyle.bg,color:srcStyle.color}}>{product._source==="USDA"?"🌾":"📦"} {product._source}{product._usdaPatched?" +":""}</span>
            {additives.length>0?<span className="nb" style={{fontSize:".72rem",color:"#e63946",fontWeight:600,background:"#fdecea",padding:"2px 7px",borderRadius:7}}>⚠️ {additives.length} additive{additives.length>1?"s":""}</span>:product.ingredients_text&&<span className="nb" style={{fontSize:".72rem",color:"#2d6a4f",fontWeight:600,background:"#e9f5ee",padding:"2px 7px",borderRadius:7}}>✓ Clean</span>}
            <button className="iconbtn" onClick={()=>toggleSave(product)} style={{color:isSaved?"#d4a017":"#ccc",marginLeft:"auto"}}>🔖 {isSaved?"Saved":"Save"}</button>
            <button className="iconbtn" onClick={()=>toggleCompare(product)} style={{color:isCompared?"#2d6a4f":"#ccc"}}>⚖️ {isCompared?"Added":"Compare"}</button>
          </div>
        </div>
      </div>
      <div style={{display:"flex",marginTop:10,borderTop:"1px solid #f0ebe0",paddingTop:9,justifyContent:"space-between"}}>
        {stats.map(s=>(
          <div key={s.label} style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
            <span className="nb" style={{fontSize:".85rem",fontWeight:700,color:"#1a1a1a"}}>{s.val}</span>
            <span className="nb" style={{fontSize:".62rem",color:"#aaa",marginTop:1}}>{s.label}</span>
          </div>
        ))}
      </div>
      {micros.length>0&&<div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:7}}>{micros.map(m=><div key={m.label} className="micro-pill"><span className="nb" style={{fontSize:".73rem",fontWeight:700,color:"#2d6a4f"}}>{m.val}</span><span className="nb" style={{fontSize:".6rem",color:"#aaa"}}>{m.label}</span></div>)}</div>}
      {(product.ingredients_text||breakdown.length>0)&&<button className="xbtn" style={{marginTop:7}} onClick={()=>setExpanded(isOpen?null:uid)}>{isOpen?"Hide details ▲":"Score breakdown & ingredients ▼"}</button>}
      {isOpen&&(
        <div style={{marginTop:9,borderTop:"1px solid #f0ebe0",paddingTop:9}}>
          {breakdown.length>0&&(
            <div style={{marginBottom:12}}>
              <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#555",marginBottom:5}}>📊 Score Breakdown</div>
              <div style={{background:"#f9f7f3",borderRadius:8,padding:"7px 10px"}}>
                {breakdown.map((b,i)=><div key={i} className="breakdown-row"><span style={{color:"#555"}}>{b.label}</span><span style={{fontWeight:700,color:b.positive?"#2d6a4f":"#e63946"}}>{b.pts}</span></div>)}
                <div className="breakdown-row" style={{borderBottom:"none",marginTop:4,paddingTop:4,borderTop:"2px solid #e8e4dc"}}><span style={{fontWeight:700}}>Final Score</span><span style={{fontWeight:900,color:scoreColor(score),fontSize:"1rem"}}>{score}</span></div>
              </div>
            </div>
          )}
          {additives.length>0&&(
            <div style={{marginBottom:10}}>
              <div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#e63946",marginBottom:5}}>⚠️ Flagged Additives</div>
              {additives.map((a,i)=>(
                <div key={i} style={{background:"#fdf3f3",border:`1px solid ${severityColor(a.severity)}22`,borderRadius:8,padding:"7px 10px",marginBottom:5}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                    <span className="nb" style={{fontWeight:700,fontSize:".8rem",color:severityColor(a.severity)}}>{a.name}</span>
                    <span style={{display:"inline-flex",padding:"2px 7px",borderRadius:10,fontSize:".68rem",fontFamily:"'Source Sans 3',sans-serif",background:severityColor(a.severity)+"22",color:severityColor(a.severity),border:`1px solid ${severityColor(a.severity)}44`}}>{a.severity} risk · -{mode==="meal"?(a.mealPenalty??Math.round(a.penalty*.75)):a.penalty} pts</span>
                  </div>
                  <p className="nb" style={{fontSize:".75rem",color:"#555",marginTop:3,lineHeight:1.4}}>{a.note}</p>
                </div>
              ))}
            </div>
          )}
          {product.ingredients_text&&<><div className="nb" style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#888",marginBottom:4}}>Ingredients</div><p className="nb" style={{fontSize:".78rem",color:"#555",lineHeight:1.55}}>{product.ingredients_text}</p></>}
        </div>
      )}
    </div>
  );
}


export const Route = createFileRoute("/")({ component: NutriFind });

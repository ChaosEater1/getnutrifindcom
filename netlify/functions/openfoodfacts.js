// Netlify function: proxies requests to world.openfoodfacts.org to avoid browser CORS issues.
// Usage: /.netlify/functions/openfoodfacts?path=/cgi/search.pl&search_terms=...
exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: cors, body: "Method Not Allowed" };

  const params = { ...(event.queryStringParameters || {}) };
  const path = params.path || "";
  delete params.path;
  if (!/^\/(cgi\/search\.pl|api\/v[0-9]+\/product\/[0-9A-Za-z]+\.json)$/.test(path)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: "Invalid path" }),
    };
  }

  const url = `https://world.openfoodfacts.org${path}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "NutriFind/1.0 (https://getnutrifind.com)", Accept: "application/json" },
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json", ...cors },
      body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: err.message || "Upstream error" }),
    };
  }
};

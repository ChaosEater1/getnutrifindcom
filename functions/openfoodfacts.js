// Cloudflare Pages Function (served at /openfoodfacts): proxies GET requests to world.openfoodfacts.org.
// Usage: /openfoodfacts?path=/cgi/search.pl&search_terms=...
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const onRequestOptions = () => new Response(null, { status: 204, headers: cors });

export const onRequestGet = async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const path = params.get("path") || "";
  params.delete("path");
  if (!/^\/(cgi\/search\.pl|api\/v[0-9]+\/product\/[0-9A-Za-z]+\.json)$/.test(path)) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors },
    });
  }
  try {
    const res = await fetch(`https://world.openfoodfacts.org${path}?${params.toString()}`, {
      headers: { "User-Agent": "NutriFind/1.0 (https://getnutrifind.com)", Accept: "application/json" },
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Upstream error" }), {
      status: 502, headers: { "Content-Type": "application/json", ...cors },
    });
  }
};

// Cloudflare Pages Function (served at /claude): accepts Claude-style body, proxies to Google Gemini,
// and returns a Claude-shaped response { content: [{ text }] }.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });

export const onRequestOptions = () => new Response(null, { status: 204, headers: cors });

export const onRequestPost = async ({ request, env }) => {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const { system, messages = [], max_tokens } = payload;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  const geminiBody = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { ...(max_tokens ? { maxOutputTokens: max_tokens } : {}) },
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data?.error?.message || "Gemini error", details: data }, res.status);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return json({ content: [{ type: "text", text }] });
  } catch (err) {
    return json({ error: err.message || "Upstream error" }, 502);
  }
};

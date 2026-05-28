// Netlify function: accepts Claude-style request body and proxies to Google Gemini.
// Returns a Claude-shaped response { content: [{ text }] } so the frontend stays unchanged.
exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { system, messages = [], max_tokens } = payload;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));

  const geminiBody = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      ...(max_tokens ? { maxOutputTokens: max_tokens } : {}),
    },
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json", ...cors },
        body: JSON.stringify({ error: data?.error?.message || "Gemini error", details: data }),
      };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ content: [{ type: "text", text }] }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", ...cors },
      body: JSON.stringify({ error: err.message || "Upstream error" }),
    };
  }
};

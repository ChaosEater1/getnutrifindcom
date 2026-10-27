import appEntry from "@tanstack/react-start/server-entry";

type Env = {
  GEMINI_API_KEY?: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });

const corsOnly = () => new Response(null, { status: 204, headers: cors });

async function handleClaude(request: Request, env: Env = {}) {
  if (request.method === "OPTIONS") return corsOnly();
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

  let payload: {
    system?: string;
    messages?: Array<{ role?: string; content?: unknown }>;
    max_tokens?: number;
  };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { system, messages = [], max_tokens } = payload;
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      {
        text:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content ?? ""),
      },
    ],
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            ...(max_tokens ? { maxOutputTokens: max_tokens } : {}),
          },
        }),
      },
    );
    const data = (await response.json()) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    if (!response.ok) {
      return json(
        { error: data.error?.message || "Gemini error", details: data },
        response.status,
      );
    }

    const text =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    return json({ content: [{ type: "text", text }] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Upstream error" }, 502);
  }
}

async function handleOpenFoodFacts(request: Request) {
  if (request.method === "OPTIONS") return corsOnly();
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const params = new URL(request.url).searchParams;
  const path = params.get("path") || "";
  params.delete("path");

  if (!/^\/(cgi\/search\.pl|api\/v[0-9]+\/product\/[0-9A-Za-z]+\.json)$/.test(path)) {
    return json({ error: "Invalid path" }, 400);
  }

  try {
    const response = await fetch(
      `https://world.openfoodfacts.org${path}?${params.toString()}`,
      {
        headers: {
          "User-Agent": "NutriFind/1.0 (https://getnutrifind.com)",
          Accept: "application/json",
        },
      },
    );

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        ...cors,
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Upstream error" }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;

    if (path === "/claude") return handleClaude(request, env);
    if (path === "/openfoodfacts") return handleOpenFoodFacts(request);

    return appEntry.fetch(request);
  },
};

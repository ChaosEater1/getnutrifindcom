import { createServerFn } from "@tanstack/react-start";

export const fetchNutritionTip = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const data = input as { query?: string };
    if (!data?.query || typeof data.query !== "string") {
      throw new Error("query is required");
    }
    return { query: data.query.trim().slice(0, 120) };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { tip: "", error: "AI not configured" };
    }

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are a concise nutritionist. Give a 2-3 sentence tip about what to look for (and avoid) when buying this food. Mention any common harmful additives or preservatives to watch for in this category. Keep it practical and direct. No bullet points, no headings, just plain prose.",
            },
            { role: "user", content: `What should I look for when buying: ${data.query}` },
          ],
        }),
      });

      if (res.status === 429) return { tip: "", error: "Rate limit reached, try again shortly." };
      if (res.status === 402) return { tip: "", error: "AI credits exhausted." };
      if (!res.ok) return { tip: "", error: "AI request failed" };

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const tip = json.choices?.[0]?.message?.content?.trim() || "";
      return { tip, error: null as string | null };
    } catch (e) {
      return { tip: "", error: e instanceof Error ? e.message : "Unknown error" };
    }
  });

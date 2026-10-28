import { afterEach, expect, mock, spyOn, test } from "bun:test";

mock.module("@tanstack/react-start/server-entry", () => ({ default: { fetch: () => new Response("app") } }));
const { default: worker } = await import("./worker");
const request = (body = '{"messages":[{"role":"user","content":"yogurt"}]}') =>
  new Request("https://example.test/claude", { method: "POST", body });

afterEach(() => mock.restore());

test("missing Worker binding returns configuration error and stack", async () => {
  spyOn(console, "error").mockImplementation(() => {});
  spyOn(console, "info").mockImplementation(() => {});
  const response = await worker.fetch(request(), {});
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body.stage).toBe("configuration");
  expect(body.error).toContain("GEMINI_API_KEY not configured");
  expect(body.stack).toContain("Error:");
});

test("Gemini receives the env binding and returns compatible content", async () => {
  spyOn(console, "info").mockImplementation(() => {});
  let bindingUsed = false;
  spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    bindingUsed = new Headers(init?.headers).get("x-goog-api-key") === "test-binding";
    expect(String(url)).not.toContain("?key=");
    return Response.json({ candidates: [{ content: { parts: [{ text: "A nutrition tip" }] } }] });
  });
  const response = await worker.fetch(request(), { GEMINI_API_KEY: "test-binding" });
  expect(bindingUsed).toBe(true);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ content: [{ type: "text", text: "A nutrition tip" }] });
});

test("upstream exceptions return diagnostics without leaking the binding", async () => {
  spyOn(console, "info").mockImplementation(() => {});
  const logs = spyOn(console, "error").mockImplementation(() => {});
  spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network failure test-binding"); });
  const response = await worker.fetch(request(), { GEMINI_API_KEY: "test-binding" });
  const body = await response.json();
  expect(response.status).toBe(502);
  expect(body.error).toBe("network failure [REDACTED]");
  expect(body.stack).toContain("Error:");
  expect(JSON.stringify(body).includes("test-binding")).toBe(false);
  expect(JSON.stringify(logs.mock.calls).includes("test-binding")).toBe(false);
});

test("invalid request JSON returns parsing diagnostics", async () => {
  spyOn(console, "info").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
  const response = await worker.fetch(request("{"), { GEMINI_API_KEY: "test-binding" });
  expect(response.status).toBe(400);
  expect((await response.json()).stage).toBe("request parsing");
});
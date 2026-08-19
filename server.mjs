import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { TutuMcpClient } from "./src/mcp-client.mjs";
import { createDemoRoutes, enrichRoutes, extractMcpContext, normalizeMcpResult, validateSearchInput } from "./src/product.mjs";
import { publicRegistry } from "./src/accessibility-registry.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const MCP_URL = process.env.TUTU_MCP_URL || "https://mcp.tutu.ru/mcp";
const FALLBACK_MODE = process.env.FALLBACK_MODE || "demo";
const mcp = new TutuMcpClient({ url: MCP_URL });
let lastMcpCheck = { ok: false, checkedAt: null, tools: [], error: "Ещё не проверено" };

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  try {
    setSecurityHeaders(response);
    if (request.method === "GET" && request.url === "/api/health") return json(response, 200, await health());
    if (request.method === "GET" && request.url === "/api/mcp/tools") return json(response, 200, await inspectMcp());
    if (request.method === "GET" && request.url === "/api/accessibility/registry") return json(response, 200, publicRegistry());
    if (request.method === "POST" && request.url === "/api/search") {
      const body = await readJsonBody(request);
      const validation = validateSearchInput(body);
      if (!validation.valid) return json(response, 400, { error: "Проверьте поля", fields: validation.errors });

      try {
        const mcpResult = await mcp.search(validation.value);
        const routes = await enrichRoutes(normalizeMcpResult(mcpResult, validation.value), validation.value, mcp);
        const context = extractMcpContext(mcpResult, validation.value);
        if (routes.length) {
          return json(response, 200, {
            mode: "live",
            source: "Данные Туту и официальный реестр доступности",
            tool: mcpResult.tool,
            searchedAt: new Date().toISOString(),
            context,
            registry: { version: publicRegistry().version, facilities: publicRegistry().facilities.length },
            routes: routes.map(publicRoute)
          });
        }
        return json(response, 200, {
          mode: "empty",
          source: "Данные Туту",
          searchedAt: new Date().toISOString(),
          context,
          reason: "no_offers",
          message: "На выбранную дату подходящих вариантов не найдено"
        });
      } catch (error) {
        if (/railway_id|requires railway|geo lookup/i.test(error.message)) {
          return json(response, 200, {
            mode: "empty",
            source: "Данные Туту",
            searchedAt: new Date().toISOString(),
            context: { resolvedFrom: validation.value.from, resolvedTo: normalizeKnownCity(validation.value.to), unavailable: [{ mode: "railway", reason: "no_route" }] },
            reason: "transport_unavailable",
            message: "Для выбранного города не найден железнодорожный маршрут. Попробуйте поиск по всем видам транспорта.",
            suggestedMode: "any"
          });
        }
        if (FALLBACK_MODE !== "demo") throw error;
        return json(response, 200, {
          mode: "demo",
          source: "Демонстрационные данные",
          searchedAt: new Date().toISOString(),
          warning: "Туту MCP сейчас недоступен или формат ответа ещё не поддержан. Эти результаты не являются реальными предложениями.",
          diagnostic: process.env.NODE_ENV === "production" ? undefined : error.message,
          routes: createDemoRoutes(validation.value)
        });
      }
    }
    if (request.method === "GET") return serveStatic(request.url, response);
    json(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(JSON.stringify({ path: request.url, message: error.message, durationMs: Date.now() - startedAt }));
    json(response, 500, { error: "Внутренняя ошибка", requestId: crypto.randomUUID() });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Туту.Можно запущен: http://localhost:${PORT}`);
  inspectMcp().catch(() => {});
});

async function inspectMcp() {
  try {
    const tools = await mcp.listTools({ refresh: true });
    lastMcpCheck = {
      ok: true,
      checkedAt: new Date().toISOString(),
      tools: tools.map(({ name, description }) => ({ name, description })),
      error: null
    };
  } catch (error) {
    lastMcpCheck = { ok: false, checkedAt: new Date().toISOString(), tools: [], error: error.message };
  }
  return lastMcpCheck;
}

function normalizeKnownCity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["питер", "спб", "санкт петербург"].includes(normalized)) return "Санкт-Петербург";
  return value;
}

function publicRoute(route) {
  const { detailsRef, baseEvidence, ...safeRoute } = route;
  return safeRoute;
}

async function health() {
  return {
    status: "ok",
    service: "tutu-mozhno",
    timestamp: new Date().toISOString(),
    mcp: lastMcpCheck
  };
}

async function serveStatic(rawUrl, response) {
  const pathname = decodeURIComponent((rawUrl || "/").split("?")[0]);
  const route = pathname === "/" ? "/index.html" : pathname === "/docs" ? "/docs.html" : pathname === "/registry" ? "/registry.html" : pathname;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeType(filePath), "Cache-Control": "no-cache" });
    response.end(content);
  } catch {
    json(response, 404, { error: "Страница не найдена" });
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 100_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function mimeType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  }[extname(path)] || "application/octet-stream";
}

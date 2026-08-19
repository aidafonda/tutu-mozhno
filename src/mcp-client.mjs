const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "McpError";
    this.details = details;
  }
}

export class TutuMcpClient {
  constructor({ url, fetchImpl = fetch, timeoutMs = 18_000 } = {}) {
    if (!url) throw new Error("TUTU_MCP_URL is required");
    this.url = url;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.requestId = 0;
    this.initialized = false;
    this.toolsCache = null;
  }

  async request(method, params = {}, { notification = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const payload = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: ++this.requestId, method, params };

    try {
      const response = await this.fetch(this.url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) this.sessionId = sessionId;

      if (!response.ok) {
        const body = await response.text();
        throw new McpError(`MCP returned HTTP ${response.status}`, {
          status: response.status,
          body: body.slice(0, 1000)
        });
      }

      if (notification || response.status === 202) return null;
      const result = parseMcpResponse(await response.text());
      if (result?.error) {
        throw new McpError(result.error.message || "MCP request failed", result.error);
      }
      return result?.result ?? result;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new McpError("Tutu MCP request timed out", { timeoutMs: this.timeoutMs });
      }
      if (error instanceof McpError) throw error;
      throw new McpError("Tutu MCP is unavailable", { cause: error.message });
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "tutu-mozhno", version: "0.1.0" }
    });
    await this.request("notifications/initialized", {}, { notification: true });
    this.initialized = true;
  }

  async listTools({ refresh = false } = {}) {
    await this.initialize();
    if (this.toolsCache && !refresh) return this.toolsCache;
    const result = await this.request("tools/list");
    this.toolsCache = result?.tools || [];
    return this.toolsCache;
  }

  async callTool(name, args) {
    await this.initialize();
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError) {
      const message = result.content?.find((item) => item.type === "text")?.text || `Tool ${name} failed`;
      throw new McpError(message, { tool: name });
    }
    return result;
  }

  async search(input) {
    const tools = await this.listTools();
    const exactName = { train: "search_rail", plane: "search_avia", bus: "search_bus", any: "search_multitransport" }[input.mode];
    const exactTool = tools.find((tool) => tool.name === exactName);
    // A rail request must never silently turn into an etrain/bus/avia request.
    // Cross-mode fallback is a user decision and lives in the UI.
    const candidates = exactTool ? [exactTool] : rankSearchTools(tools, input.mode).slice(0, 4);
    if (!candidates.length) {
      throw new McpError("В MCP не найден подходящий инструмент поиска", {
        availableTools: tools.map((tool) => tool.name)
      });
    }

    const attempts = [];
    for (const tool of candidates) {
      const args = buildToolArguments(tool.inputSchema || {}, input);
      try {
        const result = await this.callTool(tool.name, args);
        return { tool: tool.name, args, result, toolsCount: tools.length };
      } catch (error) {
        if (exactTool) throw error;
        attempts.push({ tool: tool.name, message: error.message });
      }
    }

    throw new McpError("Инструменты MCP не приняли параметры поиска", { attempts });
  }

}

export function parseMcpResponse(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const messages = trimmed
    .split(/\r?\n\r?\n/)
    .flatMap((event) => event.split(/\r?\n/))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return messages.find((message) => message.result || message.error) || messages.at(-1) || null;
}

export function rankSearchTools(tools, mode = "train") {
  const modeWords = {
    train: ["train", "rail", "поезд", "жд"],
    plane: ["flight", "avia", "air", "самол", "авиа"],
    bus: ["bus", "автобус"],
    any: ["multi", "route", "travel", "trip", "маршрут", "поиск"]
  };
  const positive = [...(modeWords[mode] || []), "search", "find", "offer", "поиск"];
  const negative = ["detail", "review", "seat", "schema", "link", "suggest", "autocomplete", "отзыв", "мест"];
  return tools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.description || ""}`.toLowerCase();
      let score = positive.reduce((sum, word) => sum + (haystack.includes(word) ? 4 : 0), 0);
      score -= negative.reduce((sum, word) => sum + (haystack.includes(word) ? 3 : 0), 0);
      if (JSON.stringify(tool.inputSchema || {}).match(/origin|from|departure|откуда/i)) score += 2;
      if (JSON.stringify(tool.inputSchema || {}).match(/destination|to|arrival|куда/i)) score += 2;
      return { ...tool, score };
    })
    .filter((tool) => tool.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildToolArguments(schema, input) {
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const result = {};

  for (const [key, property] of Object.entries(properties)) {
    const normalized = key.toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
    let value;

    // Do not send deprecated aliases together with their canonical fields.
    if (key === "from_city" && properties.origin) continue;
    if (key === "to_city" && properties.destination) continue;
    // A one-way search must not inherit the departure date as its return date.
    if (["returndate", "backdate", "arrivaldate"].includes(normalized)) continue;

    if (matches(normalized, ["from", "origin", "departurecity", "fromcity", "startcity", "откуда"])) value = input.from;
    else if (matches(normalized, ["to", "destination", "arrivalcity", "tocity", "endcity", "куда"])) value = input.to;
    else if (matches(normalized, ["date", "departuredate", "startdate", "traveldate", "датавыезда"])) value = input.date;
    else if (matches(normalized, ["adults", "adult", "passengers", "passengercount", "travelers"])) value = input.passengers || 1;
    else if (matches(normalized, ["transport", "mode", "transporttype"])) value = input.mode;
    else if (property.type === "object") {
      const nested = buildToolArguments(property, input);
      if (Object.keys(nested).length) value = nested;
    } else if (required.has(key) && property.enum?.length === 1) value = property.enum[0];

    if (value !== undefined && value !== "") result[key] = coerceValue(value, inferType(property));
  }

  if (properties.page) result.page = 1;
  if (properties.page_size) result.page_size = 5;
  if (properties.sort) result.sort = "duration_asc";
  if (properties.view) result.view = "compact";
  if (properties.optimize_for) result.optimize_for = "time";
  if (properties.modes && input.mode === "any") result.modes = ["avia", "railway", "bus"];
  return result;
}

function matches(key, words) {
  return words.some((word) => key === word || (word.length > 3 && key.includes(word)));
}

function coerceValue(value, type) {
  if (type === "integer" || type === "number") return Number(value);
  if (type === "array") return [value];
  return value;
}

function inferType(property) {
  if (property.type) return property.type;
  return property.anyOf?.find((option) => option.type && option.type !== "null")?.type;
}

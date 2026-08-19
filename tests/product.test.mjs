import test from "node:test";
import assert from "node:assert/strict";
import { buildToolArguments, parseMcpResponse, rankSearchTools } from "../src/mcp-client.mjs";
import { createDemoRoutes, extractMcpContext, normalizeMcpResult, validateSearchInput } from "../src/product.mjs";

test("validates a complete trip", () => {
  const result = validateSearchInput({ from: "Москва", to: "Казань", date: "2026-08-20", mode: "train" });
  assert.equal(result.valid, true);
  assert.equal(result.value.passengers, 1);
});

test("rejects an identical origin and destination", () => {
  const result = validateSearchInput({ from: "Москва", to: "москва", date: "2026-08-20" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.to);
});

test("builds arguments from a discovered MCP schema", () => {
  const schema = { properties: { departure_city: { type: "string" }, arrival_city: { type: "string" }, departure_date: { type: "string" }, adults: { type: "integer" } } };
  assert.deepEqual(buildToolArguments(schema, { from: "Москва", to: "Казань", date: "2026-08-20", passengers: 2 }), {
    departure_city: "Москва", arrival_city: "Казань", departure_date: "2026-08-20", adults: 2
  });
});

test("prefers canonical MCP fields and adds lean search defaults", () => {
  const schema = { properties: {
    origin: { anyOf: [{ type: "string" }, { type: "null" }] },
    from_city: { anyOf: [{ type: "string" }, { type: "null" }] },
    destination: { anyOf: [{ type: "string" }, { type: "null" }] },
    to_city: { anyOf: [{ type: "string" }, { type: "null" }] },
    departure_date: { anyOf: [{ type: "string" }, { type: "null" }] },
    page_size: { type: "integer" }, sort: { type: "string" }, view: { type: "string" }
  } };
  assert.deepEqual(buildToolArguments(schema, { from: "Москва", to: "Казань", date: "2026-08-20" }), {
    origin: "Москва", destination: "Казань", departure_date: "2026-08-20", page_size: 5, sort: "duration_asc", view: "compact"
  });
});

test("ranks search before detail tools", () => {
  const tools = [
    { name: "train_details", description: "Get train detail" },
    { name: "search_trains", description: "Search train offers", inputSchema: { properties: { from: {}, to: {} } } }
  ];
  assert.equal(rankSearchTools(tools, "train")[0].name, "search_trains");
});

test("does not mistake direct_only for destination", () => {
  const schema = { properties: {
    origin: { type: "string" }, destination: { type: "string" }, direct_only: { type: "boolean" }
  } };
  assert.deepEqual(buildToolArguments(schema, { from: "Москва", to: "Казань" }), {
    origin: "Москва", destination: "Казань"
  });
});

test("builds a multitransport request with supported mode names", () => {
  const schema = { properties: {
    origin: { type: "string" }, destination: { type: "string" }, departure_date: { type: "string" },
    modes: { type: "array" }, optimize_for: { type: "string" }, page_size: { type: "integer" }
  } };
  const args = buildToolArguments(schema, { from: "Салехард", to: "Питер", date: "2026-08-20", mode: "any" });
  assert.deepEqual(args.modes, ["avia", "railway", "bus"]);
  assert.equal(args.optimize_for, "time");
  assert.equal(args.page_size, 5);
});

test("parses an SSE MCP response", () => {
  const response = parseMcpResponse('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n');
  assert.deepEqual(response.result.tools, []);
});

test("labels demo evidence honestly", () => {
  const [route] = createDemoRoutes({ from: "Москва", to: "Казань", date: "2026-08-20", mode: "train", stepFree: true, assistance: true });
  assert.equal(route.source, "demo");
  assert.equal(route.accessibility.status, "verify");
  assert.match(route.evidence[0].note, /Демонстрационные/);
});

test("normalizes resolved city and live multitransport variants", () => {
  const payload = {
    variants: [{ offer_id: "1", transport: "avia", price: { amount: 29239, currency: "RUB" }, duration_min: 315, segments_count: 2, departure_at: "2026-08-20T18:20:00+05:00", arrival_at: "2026-08-21T09:30:00+03:00", carriers: ["Ямал", "Utair"], search_results_url: "https://avia.tutu.ru/example", legs: [{ from: "Салехард, SLY", to: "Санкт-Петербург — Пулково (LED)", segments: [] }] }],
    meta: { from: { name: "Салехард" }, to: { name: "Санкт-Петербург" }, unavailable: [{ mode: "railway", reason: "no_route" }] }
  };
  const response = { tool: "search_multitransport", result: { content: [{ type: "text", text: JSON.stringify(payload) }] } };
  const input = { from: "Салехард", to: "Питер", mode: "any", withPet: true };
  const routes = normalizeMcpResult(response, input);
  const context = extractMcpContext(response, input);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].productType, "avia");
  assert.match(routes[0].transport, /Ямал/);
  assert.match(routes[0].accessibility.risks.join(" "), /питомца/);
  assert.equal(context.resolvedTo, "Санкт-Петербург");
  assert.equal(context.unavailable[0].mode, "railway");
});

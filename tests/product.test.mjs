import test from "node:test";
import assert from "node:assert/strict";
import { buildToolArguments, parseMcpResponse, rankSearchTools } from "../src/mcp-client.mjs";
import { assessRoute, createDemoRoutes, enrichRoutes, extractMcpContext, normalizeMcpResult, validateSearchInput } from "../src/product.mjs";
import { findFacility, publicRegistry } from "../src/accessibility-registry.mjs";

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

test("rejects past, impossible and excessively distant dates on the server", () => {
  const options = { today: "2026-08-19", maxAdvanceDays: 365 };
  assert.match(validateSearchInput({ from: "Москва", to: "Казань", date: "2020-01-01" }, options).errors.date, /прошла/);
  assert.match(validateSearchInput({ from: "Москва", to: "Казань", date: "2026-02-31" }, options).errors.date, /корректную/);
  assert.match(validateSearchInput({ from: "Москва", to: "Казань", date: "2028-01-01" }, options).errors.date, /через год/);
});

test("builds arguments from a discovered MCP schema", () => {
  const schema = { properties: { departure_city: { type: "string" }, arrival_city: { type: "string" }, departure_date: { type: "string" }, adults: { type: "integer" } } };
  assert.deepEqual(buildToolArguments(schema, { from: "Москва", to: "Казань", date: "2026-08-20", passengers: 2 }), {
    departure_city: "Москва", arrival_city: "Казань", departure_date: "2026-08-20", adults: 2
  });
});

test("passes a child to MCP as a real passenger", () => {
  const schema = { properties: { adults: { type: "integer" }, children: { type: "integer" }, passengers: { type: "integer" } } };
  assert.deepEqual(buildToolArguments(schema, { adults: 1, children: 1, passengers: 2, withChild: true }), {
    adults: 1, children: 1, passengers: 2
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

test("does not reuse departure date as an avia return date", () => {
  const schema = { properties: {
    origin: { type: "string" }, destination: { type: "string" },
    departure_date: { type: "string" }, return_date: { type: ["string", "null"] }
  } };
  assert.deepEqual(buildToolArguments(schema, { from: "Москва", to: "Казань", date: "2026-08-20" }), {
    origin: "Москва", destination: "Казань", departure_date: "2026-08-20"
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
    variants: [{ offer_id: "1", transport: "avia", price: { amount: 29239, currency: "RUB" }, duration_min: 315, segments_count: 2, departure_at: "2026-08-20T18:20:00+05:00", arrival_at: "2026-08-21T09:30:00+03:00", carriers: ["Ямал", "Utair"], checkout_url: "https://mtp-deeplink.tutu.ru/unreliable", search_results_url: "https://avia.tutu.ru/example", legs: [{ from: "Салехард, SLY", to: "Санкт-Петербург — Пулково (LED)", segments: [] }] }],
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
  assert.equal(routes[0].bookingUrl, "https://avia.tutu.ru/example");
  assert.equal(context.resolvedTo, "Санкт-Петербург");
  assert.equal(context.unavailable[0].mode, "railway");
});

test("does not invent offers from MCP metadata", () => {
  const payload = { meta: { total_matched: 0, from: { name: "Сен-Пьер", offer_hint: "none" }, price_stats: { min: 0 } } };
  const response = { tool: "search_multitransport", result: { content: [{ type: "text", text: JSON.stringify(payload) }] } };
  assert.deepEqual(normalizeMcpResult(response, { from: "Абырвалг", to: "Москва", mode: "any", maxWalk: 300 }), []);
  assert.equal(extractMcpContext(response, { from: "Абырвалг", to: "Москва" }).resolvedFrom, "Абырвалг");
});

test("uses avia passenger and baggage facts without overstating accessibility", async () => {
  const payload = { variants: [{
    offer_id: "avia-1", transport: "avia", duration_min: 120, segments_count: 1,
    checkout_ref: { passengers_full: 1, passengers_child: 1 },
    variants: [{ conditions: { baggage: { pieces: 1, kg: 23 }, seat_selection: true } }],
    price: { amount: 10000 }, legs: [{ from: "Москва", to: "Сочи", segments: [] }]
  }] };
  const response = { tool: "search_avia", result: { content: [{ type: "text", text: JSON.stringify(payload) }] } };
  const [route] = await enrichRoutes(normalizeMcpResult(response, { from: "Москва", to: "Сочи", mode: "plane" }), {
    withChild: true, heavyLuggage: true, maxWalk: 2000
  }, { getOfferDetails: async () => null });
  assert.equal(route.offerFacts.passengersChild, 1);
  assert.equal(route.offerFacts.checkedBaggage.kg, 23);
  assert.equal(route.accessibility.coverage.partial, 2);
  assert.match(route.evidence.find((item) => item.label === "Тяжёлый багаж").note, /23 кг/);
});

test("enriches bus amenities but does not call a generic toilet accessible", async () => {
  const [route] = await enrichRoutes([{
    id: "bus-1", source: "mcp", productType: "bus", from: "Москва", to: "Тула", changes: 0,
    durationMinutes: 180, detailsRef: { offer_id: "bus-1" }, evidence: []
  }], { accessibleToilet: true, heavyLuggage: true, maxWalk: 2000 }, {
    getOfferDetails: async (type) => {
      assert.equal(type, "bus");
      return { amenities: [{ code: "toilet", enabled: true }, { code: "luggage_compartment", enabled: true }] };
    }
  });
  assert.equal(route.vehicleFacts.hasToilet, true);
  assert.equal(route.vehicleFacts.luggageCompartment, true);
  assert.equal(route.accessibility.status, "verify");
  assert.match(route.evidence.find((item) => item.label === "Доступный санузел").note, /не подтверждена/);
});

test("matches an exact station from the official pilot registry", () => {
  const station = findFacility("Москва — Ленинградский вокзал (2006004)", "rail_station");
  assert.equal(station?.name, "Ленинградский вокзал");
  assert.equal(station?.facts.stepFree.status, "partial");
  assert.match(station?.source.url, /leningradsky\.dzvr\.ru/);
  assert.equal(publicRegistry().facilities.length, 2);
});

test("never calls a route accessible while a selected condition is unknown", () => {
  const route = assessRoute({
    source: "mcp", productType: "railway", from: "Москва — Ленинградский вокзал (2006004)",
    to: "Санкт-Петербург — Московский вокзал (2004001)", changes: 0, evidence: []
  }, { stepFree: true, assistance: true, accessibleToilet: true, maxWalk: 300 });
  assert.equal(route.accessibility.status, "verify");
  assert.ok(route.accessibility.coverage.unknown > 0);
  assert.match(route.accessibility.weakestLink, /частично доступ/i);
  assert.ok(route.evidence.some((item) => item.source?.url));
});

test("enriches a rail offer with live vehicle details without treating a bio toilet as accessible", async () => {
  const routes = await enrichRoutes([{
    id: "1", source: "mcp", productType: "railway", from: "Москва — Ленинградский вокзал (2006004)",
    to: "Санкт-Петербург — Московский вокзал (2004001)", changes: 0, durationMinutes: 240,
    detailsRef: { offer_id: "1" }, evidence: []
  }], { accessibleToilet: true, maxWalk: 300 }, {
    getOfferDetails: async () => ({ service_classes: [{ amenities: [{ code: "BIO_TOILET" }, { code: "AIR_CONDITIONING" }] }] })
  });
  assert.equal(routes[0].vehicleFacts.hasBioToilet, true);
  assert.equal(routes[0].accessibility.status, "verify");
  assert.match(routes[0].accessibility.risks.join(" "), /не подтверждает/i);
});

test("ranks partial official evidence above completely unknown infrastructure", async () => {
  const routes = await enrichRoutes([
    { id: "unknown", source: "mcp", productType: "railway", from: "Москва — Восточный вокзал (2001025)", to: "Санкт-Петербург — Московский вокзал (2004001)", changes: 0, durationMinutes: 220, evidence: [] },
    { id: "partial", source: "mcp", productType: "railway", from: "Москва — Ленинградский вокзал (2006004)", to: "Санкт-Петербург — Московский вокзал (2004001)", changes: 0, durationMinutes: 250, evidence: [] }
  ], { stepFree: true, maxWalk: 300 }, { getOfferDetails: async () => null });
  assert.equal(routes[0].id, "partial");
});

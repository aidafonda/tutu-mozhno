export function validateSearchInput(input = {}) {
  const clean = {
    from: String(input.from || "").trim(),
    to: String(input.to || "").trim(),
    date: String(input.date || "").trim(),
    mode: ["train", "plane", "bus", "any"].includes(input.mode) ? input.mode : "train",
    maxWalk: Number(input.maxWalk || 300),
    stepFree: Boolean(input.stepFree),
    assistance: Boolean(input.assistance),
    accessibleToilet: Boolean(input.accessibleToilet),
    passengers: Math.max(1, Math.min(5, Number(input.passengers || 1)))
  };
  const errors = {};
  if (clean.from.length < 2) errors.from = "Укажите город отправления";
  if (clean.to.length < 2) errors.to = "Укажите город назначения";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.date)) errors.date = "Выберите дату";
  if (clean.from.toLowerCase() === clean.to.toLowerCase()) errors.to = "Города должны отличаться";
  return { value: clean, errors, valid: Object.keys(errors).length === 0 };
}

export function createDemoRoutes(input) {
  const baseDate = new Date(`${input.date}T08:00:00`);
  const route = (offset, durationHours, price, changes, variant) => ({
    id: `demo-${variant}`,
    source: "demo",
    transport: input.mode === "plane" ? "Самолёт" : input.mode === "bus" ? "Автобус" : "Поезд",
    from: input.from,
    to: input.to,
    departure: new Date(baseDate.getTime() + offset * 3_600_000).toISOString(),
    arrival: new Date(baseDate.getTime() + (offset + durationHours) * 3_600_000).toISOString(),
    durationMinutes: durationHours * 60,
    price,
    changes,
    bookingUrl: "https://www.tutu.ru/",
    evidence: [
      { label: "Расписание и цена", state: "demo", note: "Демонстрационные данные — не результат MCP" },
      { label: "Безбарьерный вход", state: "unknown", note: "Нужно подтверждение перевозчика" },
      { label: "Помощь при посадке", state: input.assistance ? "action" : "unknown", note: input.assistance ? "Запросить заранее" : "Не запрашивалась" }
    ]
  });

  return [
    route(0, 11, 4180, 0, "calm"),
    route(2, 8, 3650, 1, "transfer"),
    route(5, 10, 5290, 0, "late")
  ].map((item) => assessRoute(item, input));
}

export function assessRoute(route, input) {
  const risks = [];
  const actions = [];
  if (route.changes > 0) risks.push("Пересадка — нужно проверить расстояние и наличие лифта");
  if (input.stepFree) risks.push("Нет подтверждения маршрута без ступеней");
  if (input.accessibleToilet) risks.push("Наличие доступного санузла требует подтверждения");
  if (input.assistance) actions.push("Запросить сопровождение у перевозчика заранее");
  actions.push("Подтвердить доступность до оплаты");

  return {
    ...route,
    accessibility: {
      status: risks.length ? "verify" : "fits",
      label: risks.length ? "Нужно уточнить" : "Подходит",
      weakestLink: risks[0] || "Критических препятствий не найдено",
      risks,
      actions
    }
  };
}

export function normalizeMcpResult(mcpResponse, input) {
  const content = mcpResponse?.result?.content || mcpResponse?.content || [];
  const texts = content.filter((item) => item.type === "text").map((item) => item.text);
  const objects = [];
  for (const text of texts) {
    try {
      objects.push(JSON.parse(text));
    } catch {
      // Text remains useful as traceable evidence even when a tool does not return JSON.
    }
  }
  const exactOffers = objects.flatMap((object) => Array.isArray(object?.offers) ? object.offers : []);
  if (exactOffers.length) {
    return exactOffers.slice(0, 6).map((offer, index) => normalizeTutuOffer(offer, input, mcpResponse.tool, index));
  }
  const candidates = flattenObjects(objects).filter(looksLikeOffer).slice(0, 6);
  return candidates.map((offer, index) => assessRoute({
    id: `mcp-${index}`,
    source: "mcp",
    transport: labelForMode(input.mode),
    from: input.from,
    to: input.to,
    departure: firstValue(offer, ["departure", "departureTime", "departure_time", "startTime", "start_time"]),
    arrival: firstValue(offer, ["arrival", "arrivalTime", "arrival_time", "endTime", "end_time"]),
    durationMinutes: Number(firstValue(offer, ["durationMinutes", "duration_minutes", "duration"]) || 0),
    price: Number(firstValue(offer, ["price", "amount", "minPrice", "min_price", "cost"]) || 0),
    changes: Number(firstValue(offer, ["changes", "transfers", "stops"]) || 0),
    bookingUrl: findUrl(offer) || "https://www.tutu.ru/",
    evidence: [
      { label: "Предложение транспорта", state: "confirmed", note: `Получено через Туту MCP: ${mcpResponse.tool}` },
      { label: "Безбарьерный вход", state: "unknown", note: "В ответе MCP не подтверждено" },
      { label: "Помощь при посадке", state: input.assistance ? "action" : "unknown", note: input.assistance ? "Нужно запросить" : "Не запрашивалась" }
    ]
  }, input));
}

function normalizeTutuOffer(offer, input, tool, index) {
  const segment = offer.legs?.[0]?.segments?.[0] || {};
  const lastLeg = offer.legs?.at(-1);
  const lastSegment = lastLeg?.segments?.at(-1) || segment;
  const trainName = segment.vehicle_meta?.name;
  const voyageNumber = segment.voyage_no;
  const categories = Object.keys(offer.fares?.seat_categories || {}).map(categoryLabel);
  const review = offer.review_summary?.label;

  const route = {
    id: offer.offer_id || `mcp-${index}`,
    source: "mcp",
    transport: trainName ? `${trainName}${voyageNumber ? ` · ${voyageNumber}` : ""}` : voyageNumber ? `Поезд ${voyageNumber}` : labelForMode(input.mode),
    from: offer.legs?.[0]?.from || segment.from || input.from,
    to: lastLeg?.to || lastSegment.to || input.to,
    departure: offer.departure_at || segment.departure_at,
    arrival: offer.arrival_at || lastSegment.arrival_at,
    durationMinutes: Number(offer.duration_min || segment.duration_min || 0),
    price: Number(offer.price?.amount || 0),
    currency: offer.price?.currency || "RUB",
    changes: Math.max(0, Number(offer.segments_count || 1) - 1),
    bookingUrl: offer.checkout_url || offer.search_results_url || "https://www.tutu.ru/",
    searchResultsUrl: offer.search_results_url,
    evidence: [
      { label: "Билет и расписание", state: "confirmed", note: `Туту MCP · ${tool}` },
      { label: "Станции", state: "confirmed", note: `${offer.legs?.[0]?.from || segment.from || input.from} → ${lastLeg?.to || lastSegment.to || input.to}` },
      { label: "Безбарьерный путь", state: "unknown", note: "MCP не вернул подтверждение инфраструктуры" },
      ...(categories.length ? [{ label: "Вагоны в продаже", state: "confirmed", note: categories.join(", ") }] : []),
      ...(review ? [{ label: "Отзывы о поезде", state: "confirmed", note: review }] : []),
      { label: "Помощь при посадке", state: input.assistance ? "action" : "unknown", note: input.assistance ? "Запросить у перевозчика заранее" : "Не запрашивалась" }
    ]
  };
  return assessRoute(route, input);
}

function flattenObjects(value, result = []) {
  if (Array.isArray(value)) value.forEach((item) => flattenObjects(item, result));
  else if (value && typeof value === "object") {
    result.push(value);
    Object.values(value).forEach((item) => flattenObjects(item, result));
  }
  return result;
}

function looksLikeOffer(object) {
  const keys = Object.keys(object).join(" ").toLowerCase();
  return /(price|amount|cost|departure|arrival|offer|ticket)/.test(keys);
}

function firstValue(object, keys) {
  for (const key of keys) if (object[key] !== undefined) return object[key];
  return null;
}

function findUrl(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /url|link/i.test(key) && /^https?:\/\//.test(item)) return item;
    if (item && typeof item === "object") {
      const nested = findUrl(item);
      if (nested) return nested;
    }
  }
  return null;
}

function labelForMode(mode) {
  return { train: "Поезд", plane: "Самолёт", bus: "Автобус", any: "Маршрут" }[mode] || "Маршрут";
}

function categoryLabel(value) {
  return {
    SEDENTARY: "сидячий",
    RESERVED_SEAT: "плацкарт",
    COMPARTMENT: "купе",
    LUX: "СВ",
    SOFT: "мягкий",
    SHARED: "общий"
  }[value] || value;
}

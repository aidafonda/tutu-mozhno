import { findFacility } from "./accessibility-registry.mjs";

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
    withChild: Boolean(input.withChild),
    withPet: Boolean(input.withPet),
    heavyLuggage: Boolean(input.heavyLuggage),
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
    productType: input.mode === "plane" ? "avia" : input.mode === "bus" ? "bus" : "railway",
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
      { label: "Расписание и цена", state: "demo", note: "Демонстрационные данные — не актуальное предложение Туту" },
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
  const baseEvidence = route.baseEvidence || route.evidence || [];
  const checks = buildRequirementChecks(route, input);
  const evidence = [...baseEvidence, ...checks];
  const unknown = checks.filter((item) => item.state === "unknown");
  const partial = checks.filter((item) => item.state === "partial");
  const unresolved = [...partial, ...unknown];
  const requiredActions = checks.filter((item) => item.state === "action");
  const actions = unique(checks.map((item) => item.action).filter(Boolean));
  const confirmed = checks.filter((item) => item.state === "confirmed").length;
  const total = checks.length;
  const status = route.source === "demo" || unresolved.length ? "verify" : requiredActions.length ? "action" : "fits";
  const weakest = unresolved[0] || checks.find((item) => item.state === "action");

  return {
    ...route,
    baseEvidence,
    evidence,
    accessibility: {
      status,
      label: status === "fits" ? "Требования подтверждены" : status === "action" ? "Нужно действие" : "Есть неизвестные условия",
      weakestLink: weakest?.note || "Все выбранные условия подтверждены источниками",
      coverage: { confirmed, total, partial: partial.length, unknown: unknown.length, actions: requiredActions.length },
      risks: unresolved.map((item) => item.note),
      actions: actions.length ? actions : ["Перед оплатой ещё раз проверьте актуальность условий у перевозчика"]
    }
  };
}

function buildRequirementChecks(route, input) {
  const checks = [];
  const isRail = ["rail", "railway"].includes(route.productType);
  const origin = isRail ? findFacility(route.from, "rail_station") : null;
  const destination = isRail ? findFacility(route.to, "rail_station") : null;
  const sourceFor = (facility) => facility ? { ...facility.source, facility: facility.name } : null;

  if (input.stepFree) {
    if (route.changes > 0) {
      checks.push(evidence("Маршрут без ступеней", "unknown", "Пересадка есть, но переход между её точками не описан в данных.", null, "Уточнить доступность пересадки у перевозчика"));
    } else if (origin?.facts.stepFree && destination?.facts.stepFree) {
      const partial = [origin, destination].find((facility) => facility.facts.stepFree.status !== "confirmed");
      checks.push(evidence("Путь без ступеней", partial ? "partial" : "confirmed", partial
        ? `${partial.name}: ${partial.facts.stepFree.note}`
        : `Входы и пути движения подтверждены для ${origin.name} и ${destination.name}.`, sourceFor(partial || origin), partial ? "Заказать сопровождение и уточнить доступный вход" : null));
    } else {
      checks.push(evidence("Путь без ступеней", "unknown", "Для одного или обоих объектов нет официального паспорта в пилотном реестре.", null, "Проверить вокзалы или аэропорты до оплаты"));
    }
  }

  if (input.assistance) {
    const facility = origin?.facts.assistance ? origin : destination?.facts.assistance ? destination : null;
    checks.push(facility
      ? evidence("Сопровождение", "action", `${facility.facts.assistance.note} Рекомендуемый срок — не менее ${facility.facts.assistance.leadTimeHours} ч.`, sourceFor(facility), `Оформить заявку в ЦСМ РЖД не менее чем за ${facility.facts.assistance.leadTimeHours} ч: ${facility.facts.assistance.phone}`)
      : evidence("Сопровождение", "unknown", "MCP не сообщает, доступна ли помощь для выбранного рейса и объекта.", null, "Связаться с перевозчиком и получить подтверждение"));
  }

  if (input.accessibleToilet) {
    const confirmedFacilities = [origin, destination].filter((facility) => facility?.facts.accessibleToilet?.status === "confirmed");
    const vehicleNote = route.vehicleFacts?.hasBioToilet
      ? "В вагоне есть биотуалет, но MCP не подтверждает, что он доступен для кресла-коляски."
      : "Доступность санузла в транспорте не подтверждена.";
    checks.push(confirmedFacilities.length
      ? evidence("Доступный санузел", "partial", `Подтверждён на ${confirmedFacilities.map((item) => item.name).join(" и ")}. ${vehicleNote}`, sourceFor(confirmedFacilities[0]), "Уточнить доступный санузел в выбранном вагоне")
      : evidence("Доступный санузел", "unknown", vehicleNote, null, "Уточнить санузел у перевозчика"));
  }

  if (input.withChild) checks.push(evidence("Ребёнок и коляска", "unknown", route.changes ? "Есть пересадка; путь с коляской и время на переход не подтверждены." : "Маршрут прямой, но правила провоза коляски не представлены в MCP.", null, "Проверить детский тариф и правила провоза коляски"));
  if (input.withPet) checks.push(evidence("Поездка с питомцем", "unknown", "В проверенных данных MCP нет подтверждения правил для питомца по выбранному тарифу.", null, "Проверить переноску, документы и правила тарифа"));
  if (input.heavyLuggage) checks.push(evidence("Тяжёлый багаж", route.changes ? "unknown" : "partial", route.changes ? "Пересадка потребует переноса багажа; доступный переход не подтверждён." : "Пересадок нет, но помощь с багажом и допустимая норма требуют подтверждения.", null, "Проверить норму багажа и заказать помощь при необходимости"));
  if (Number(input.maxWalk) < 1000) checks.push(evidence(`Не более ${input.maxWalk} м пешком`, "unknown", "MCP и реестр не содержат полной длины пути внутри объектов и на пересадках.", null, "Уточнить расстояния внутри вокзала или аэропорта"));

  return checks;
}

function evidence(label, state, note, source = null, action = null) {
  return { label, state, note, source, action };
}

function unique(items) {
  return [...new Set(items)];
}

export async function enrichRoutes(routes, input, mcp) {
  const enriched = await Promise.all(routes.map(async (route) => {
    let details = null;
    const isRail = ["rail", "railway"].includes(route.productType);
    if (isRail && route.detailsRef) {
      try {
        details = await mcp.getOfferDetails("rail", route.detailsRef);
      } catch {
        details = null;
      }
    }
    const vehicleFacts = extractVehicleFacts(details);
    const vehicleEvidence = !isRail ? [] : vehicleFacts.detailsChecked ? [
      evidence("Оснащение вагона", "confirmed", vehicleFacts.amenities.length
        ? `Проверены детали класса обслуживания: ${vehicleFacts.hasBioToilet ? "биотуалет есть; " : ""}${vehicleFacts.hasAirConditioning ? "кондиционер есть" : "состав удобств ограничен"}.`
        : "Детали класса обслуживания получены, но список удобств пуст.")
    ] : [evidence("Оснащение вагона", "unknown", "Детали выбранного предложения получить не удалось.")];
    return assessRoute({ ...route, baseEvidence: [...(route.baseEvidence || []), ...vehicleEvidence], vehicleFacts }, input);
  }));
  return enriched.sort((left, right) => routeRiskScore(left) - routeRiskScore(right) || left.durationMinutes - right.durationMinutes);
}

function extractVehicleFacts(details) {
  if (!details) return { detailsChecked: false, amenities: [], hasBioToilet: false };
  const amenities = unique((details.service_classes || []).flatMap((item) => item.amenities || []).map((item) => item.code).filter(Boolean));
  return {
    detailsChecked: true,
    amenities,
    hasBioToilet: amenities.includes("BIO_TOILET"),
    hasAirConditioning: amenities.includes("AIR_CONDITIONING")
  };
}

function routeRiskScore(route) {
  const coverage = route.accessibility?.coverage || {};
  return (coverage.unknown || 0) * 20 + (coverage.partial || 0) * 8 + (coverage.actions || 0) * 3 + (route.changes || 0) * 2 - (coverage.confirmed || 0);
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
  const exactOffers = objects.flatMap((object) => [
    ...(Array.isArray(object?.offers) ? object.offers : []),
    ...(Array.isArray(object?.variants) ? object.variants : [])
  ]);
  if (exactOffers.length) {
    return exactOffers.slice(0, 6).map((offer, index) => normalizeTutuOffer(offer, input, mcpResponse.tool, index));
  }
  const candidates = flattenObjects(objects).filter(looksLikeOffer).slice(0, 6);
  return candidates.map((offer, index) => assessRoute({
    id: `mcp-${index}`,
    source: "mcp",
    productType: input.mode === "plane" ? "avia" : input.mode === "bus" ? "bus" : input.mode === "train" ? "railway" : "unknown",
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
      { label: "Предложение транспорта", state: "confirmed", note: "Подтверждено данными Туту" }
    ]
  }, input));
}

export function extractMcpContext(mcpResponse, input) {
  const content = mcpResponse?.result?.content || [];
  for (const item of content) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      const payload = JSON.parse(item.text);
      const meta = payload.meta || {};
      return {
        resolvedFrom: meta.from?.name || input.from,
        resolvedTo: meta.to?.name || input.to,
        fromRegion: meta.from?.region || null,
        toRegion: meta.to?.region || null,
        unavailable: meta.unavailable || [],
        totalMatched: meta.total_matched ?? payload.offers?.length ?? payload.variants?.length ?? 0,
        hasMore: Boolean(meta.has_more)
      };
    } catch {
      // Ignore non-JSON tool text.
    }
  }
  return { resolvedFrom: input.from, resolvedTo: input.to, unavailable: [], totalMatched: 0, hasMore: false };
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
    productType: offer.transport || (input.mode === "train" ? "railway" : input.mode),
    transport: offerLabel(offer, input, trainName, voyageNumber),
    from: offer.legs?.[0]?.from || segment.from || input.from,
    to: lastLeg?.to || lastSegment.to || input.to,
    departure: offer.departure_at || segment.departure_at,
    arrival: offer.arrival_at || lastSegment.arrival_at,
    durationMinutes: Number(offer.duration_min || segment.duration_min || 0),
    price: Number(offer.price?.amount || 0),
    currency: offer.price?.currency || "RUB",
    changes: Math.max(0, Number(offer.segments_count || 1) - 1),
    bookingUrl: preferredBookingUrl(offer),
    searchResultsUrl: offer.search_results_url,
    detailsRef: offer.details_ref || null,
    evidence: [
      { label: "Билет и расписание", state: "confirmed", note: "Подтверждено данными Туту" },
      { label: "Станции", state: "confirmed", note: `${offer.legs?.[0]?.from || segment.from || input.from} → ${lastLeg?.to || lastSegment.to || input.to}` },
      ...(categories.length ? [{ label: "Вагоны в продаже", state: "confirmed", note: categories.join(", ") }] : []),
      ...(review ? [{ label: "Отзывы о поезде", state: "confirmed", note: review }] : [])
    ]
  };
  return assessRoute(route, input);
}

function preferredBookingUrl(offer) {
  const checkoutUrl = offer.checkout_url;
  if (isReliableTutuUrl(checkoutUrl)) return checkoutUrl;
  if (/^https:\/\//.test(offer.search_results_url || "")) return offer.search_results_url;
  return "https://www.tutu.ru/";
}

function isReliableTutuUrl(value) {
  if (!/^https:\/\//.test(value || "")) return false;
  try {
    return new URL(value).hostname !== "mtp-deeplink.tutu.ru";
  } catch {
    return false;
  }
}

function offerLabel(offer, input, trainName, voyageNumber) {
  if (trainName) return `${trainName}${voyageNumber ? ` · ${voyageNumber}` : ""}`;
  if (offer.transport === "avia") return `Самолёт${offer.carriers?.length ? ` · ${offer.carriers.join(" + ")}` : ""}`;
  if (offer.transport === "bus") return `Автобус${offer.carriers?.length ? ` · ${offer.carriers.join(" + ")}` : ""}`;
  if (offer.transport === "etrain") return "Электричка";
  if (voyageNumber) return `Поезд ${voyageNumber}`;
  return labelForMode(input.mode);
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

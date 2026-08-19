export function validateSearchInput(input = {}, { today = new Date().toISOString().slice(0, 10), maxAdvanceDays = 365 } = {}) {
  const adults = Math.max(1, Math.min(5, Number(input.adults || input.passengers || 1)));
  const children = Boolean(input.childPassenger) ? Math.max(1, Math.min(4, Number(input.children || 1))) : 0;
  const clean = {
    from: String(input.from || "").trim(),
    to: String(input.to || "").trim(),
    date: String(input.date || "").trim(),
    mode: ["train", "plane", "bus", "any"].includes(input.mode) ? input.mode : "train",
    directOnly: Boolean(input.directOnly),
    childPassenger: Boolean(input.childPassenger),
    checkedBaggage: Boolean(input.checkedBaggage),
    onboardToilet: Boolean(input.onboardToilet),
    airConditioning: Boolean(input.airConditioning),
    seatSelection: Boolean(input.seatSelection),
    adults,
    children,
    passengers: Math.min(5, adults + children)
  };
  const errors = {};
  if (clean.from.length < 2) errors.from = "Укажите город отправления";
  if (clean.to.length < 2) errors.to = "Укажите город назначения";
  if (!isIsoDate(clean.date)) errors.date = "Выберите корректную дату";
  else if (clean.date < today) errors.date = "Дата поездки уже прошла";
  else if (clean.date > addDays(today, maxAdvanceDays)) errors.date = "Выберите дату не дальше чем через год";
  if (clean.from.toLowerCase() === clean.to.toLowerCase()) errors.to = "Города должны отличаться";
  if (clean.childPassenger && !["plane", "bus"].includes(clean.mode)) errors.requirements = "Детский пассажир подтверждается только для самолётов и автобусов";
  if (clean.checkedBaggage && !["plane", "bus"].includes(clean.mode)) errors.requirements = "Багаж подтверждается только для самолётов и автобусов";
  if ((clean.onboardToilet || clean.airConditioning) && !["train", "bus"].includes(clean.mode)) errors.requirements = "Оснащение транспорта подтверждается только для поездов и автобусов";
  if (clean.seatSelection && !["plane", "bus"].includes(clean.mode)) errors.requirements = "Выбор места подтверждается только для самолётов и автобусов";
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
      { label: "Расписание и цена", state: "demo", note: "Демонстрационные данные — не актуальное предложение Туту" }
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
  const missing = checks.filter((item) => item.state === "missing");
  const unresolved = [...partial, ...unknown];
  const requiredActions = checks.filter((item) => item.state === "action");
  const actions = unique(checks.map((item) => item.action).filter(Boolean));
  const confirmed = checks.filter((item) => item.state === "confirmed").length;
  const total = checks.length;
  const status = route.source === "demo" ? "verify" : missing.length ? "not-fit" : unresolved.length ? "verify" : requiredActions.length ? "action" : "fits";
  const weakest = missing[0] || unresolved[0] || checks.find((item) => item.state === "action");

  return {
    ...route,
    baseEvidence,
    evidence,
    accessibility: {
      status,
      label: status === "fits" ? (total ? "Все условия подтверждены" : "Маршрут найден") : status === "not-fit" ? "Не соответствует" : status === "action" ? "Нужно действие" : "Есть неизвестные условия",
      weakestLink: weakest?.note || (total ? "Все выбранные условия подтверждены данными предложения" : "Дополнительные условия не выбраны"),
      coverage: { confirmed, total, partial: partial.length, unknown: unknown.length, missing: missing.length, actions: requiredActions.length },
      unmet: [...missing, ...unresolved, ...requiredActions].map((item) => item.label),
      risks: [...missing, ...unresolved].map((item) => item.note),
      actions: actions.length ? actions : ["Перед оплатой ещё раз проверьте актуальность условий у перевозчика"]
    }
  };
}

function buildRequirementChecks(route, input) {
  const checks = [];
  const hasDetails = Boolean(route.vehicleFacts?.detailsChecked);
  if (input.directOnly) checks.push(evidence("Без пересадок", route.changes === 0 ? "confirmed" : "missing", route.changes === 0 ? "Прямой маршрут подтверждён предложением Туту." : `В маршруте пересадок: ${route.changes}.`));
  if (input.childPassenger) {
    const included = Number(route.offerFacts?.passengersChild || 0) > 0;
    checks.push(evidence("Ребёнок включён в поиск", included ? "confirmed" : "missing", included ? "Цена и предложение рассчитаны для 1 взрослого и 1 ребёнка." : "Состав пассажиров с ребёнком не подтверждён в предложении."));
  }
  if (input.checkedBaggage) {
    const baggage = route.offerFacts?.checkedBaggage;
    const busLuggage = route.vehicleFacts?.luggageCompartment || route.vehicleFacts?.luggageAvailable;
    checks.push(evidence("Провоз багажа", baggage || busLuggage ? "confirmed" : hasDetails || route.productType === "avia" ? "missing" : "unknown", baggage
      ? `В доступном тарифе указан сдаваемый багаж${baggage.kg ? ` до ${baggage.kg} кг` : ""}${baggage.pieces ? `, мест: ${baggage.pieces}` : ""}.`
      : busLuggage ? "В деталях рейса указана возможность провоза багажа." : "Провоз багажа не подтверждён данными предложения."));
  }
  if (input.onboardToilet) {
    const present = route.vehicleFacts?.hasBioToilet || route.vehicleFacts?.hasToilet;
    checks.push(evidence("Туалет в транспорте", present ? "confirmed" : hasDetails ? "missing" : "unknown", present ? "Туалет указан в оснащении выбранного предложения." : "Туалет не указан в оснащении предложения."));
  }
  if (input.airConditioning) {
    const present = route.vehicleFacts?.hasAirConditioning;
    checks.push(evidence("Кондиционер", present ? "confirmed" : hasDetails ? "missing" : "unknown", present ? "Кондиционер указан в оснащении предложения." : "Кондиционер не указан в оснащении предложения."));
  }
  if (input.seatSelection) {
    const available = route.offerFacts?.seatSelectionAvailable || route.vehicleFacts?.seatSelectionAvailable;
    checks.push(evidence("Выбор места", available ? "confirmed" : hasDetails || route.productType === "avia" ? "missing" : "unknown", available ? "Выбор места доступен для предложения." : "Выбор места не подтверждён данными предложения."));
  }

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
    const isBus = route.productType === "bus";
    if ((isRail || isBus) && route.detailsRef) {
      try {
        details = await mcp.getOfferDetails(isRail ? "rail" : "bus", route.detailsRef);
      } catch {
        details = null;
      }
    }
    const vehicleFacts = extractVehicleFacts(details, route.productType);
    const vehicleEvidence = !(isRail || isBus) ? [] : vehicleFacts.detailsChecked ? [
      evidence(isRail ? "Оснащение вагона" : "Оснащение автобуса", "confirmed", vehicleFacts.amenities.length
        ? isRail
          ? `Проверены детали класса обслуживания: ${vehicleFacts.hasBioToilet ? "биотуалет есть; " : ""}${vehicleFacts.hasAirConditioning ? "кондиционер есть" : "состав удобств ограничен"}.`
          : `Проверены детали рейса: ${vehicleFacts.hasToilet ? "туалет указан; " : ""}${vehicleFacts.luggageCompartment ? "багажное отделение указано" : "состав удобств ограничен"}.`
        : "Детали предложения получены, но список удобств пуст.")
    ] : [evidence(isRail ? "Оснащение вагона" : "Оснащение автобуса", "unknown", "Детали выбранного предложения получить не удалось.")];
    return assessRoute({ ...route, baseEvidence: [...(route.baseEvidence || []), ...vehicleEvidence], vehicleFacts }, input);
  }));
  return enriched.sort((left, right) => routeRiskScore(left) - routeRiskScore(right) || comparablePrice(left) - comparablePrice(right) || left.durationMinutes - right.durationMinutes);
}

export function buildDecisionSupport(routes = []) {
  if (!routes.length) return null;
  const recommended = routes[0];
  const fastest = [...routes].filter((route) => route.durationMinutes > 0).sort((left, right) => left.durationMinutes - right.durationMinutes)[0] || recommended;
  const cheapest = [...routes].filter((route) => route.price > 0).sort((left, right) => left.price - right.price)[0] || recommended;
  const scenarios = [
    decisionScenario("recommended", "Лучшее совпадение", recommended, recommended),
    decisionScenario("fastest", "Самый быстрый", fastest, recommended),
    decisionScenario("cheapest", "Самый дешёвый", cheapest, recommended)
  ];
  return {
    recommendedRouteId: recommended.id,
    criteriaCount: recommended.accessibility?.coverage?.total || 0,
    hasTradeoff: scenarios.some((scenario) => scenario.routeId !== recommended.id && scenario.unmet.length > 0),
    scenarios
  };
}

function decisionScenario(type, title, route, baseline) {
  const unmet = route.accessibility?.unmet || [];
  const priceDelta = Number(route.price || 0) - Number(baseline.price || 0);
  const durationDelta = Number(route.durationMinutes || 0) - Number(baseline.durationMinutes || 0);
  let explanation;
  if (type === "recommended") {
    explanation = route.accessibility?.status === "fits"
      ? "Все выбранные условия выполнены. Это основной вариант для решения."
      : `Ближе всего к запросу, но нужно проверить: ${unmet.join(", ") || "детали предложения"}.`;
  } else if (route.id === baseline.id) {
    explanation = type === "fastest"
      ? "Лучшее совпадение одновременно является самым быстрым."
      : "Лучшее совпадение одновременно является самым дешёвым.";
  } else {
    const deltas = [];
    if (priceDelta < 0) deltas.push(`экономия ${formatRubles(Math.abs(priceDelta))}`);
    if (priceDelta > 0) deltas.push(`дороже на ${formatRubles(priceDelta)}`);
    if (durationDelta < 0) deltas.push(`быстрее на ${formatDuration(Math.abs(durationDelta))}`);
    if (durationDelta > 0) deltas.push(`дольше на ${formatDuration(durationDelta)}`);
    const cost = deltas.join(" · ") || "без разницы в цене и времени";
    explanation = unmet.length ? `${cost}. Компромисс: ${unmet.join(", ")}.` : `${cost}. Все выбранные условия сохранены.`;
  }
  return {
    type,
    title,
    routeId: route.id,
    transport: route.transport,
    price: route.price,
    priceBasis: route.priceBasis,
    durationMinutes: route.durationMinutes,
    status: route.accessibility?.status,
    unmet,
    priceDelta,
    durationDelta,
    explanation
  };
}

function comparablePrice(route) {
  return route.price > 0 ? route.price : Number.MAX_SAFE_INTEGER;
}

function formatRubles(value) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours} ч ` : ""}${rest ? `${rest} мин` : ""}`.trim();
}

function extractVehicleFacts(details, productType) {
  if (!details) return { detailsChecked: false, amenities: [], hasBioToilet: false, hasToilet: false, luggageCompartment: false, luggageAvailable: false, seatSelectionAvailable: false };
  const rawAmenities = productType === "bus"
    ? (details.amenities || [])
    : (details.service_classes || []).flatMap((item) => item.amenities || []);
  const enabledAmenities = rawAmenities.filter((item) => item.enabled !== false);
  const amenities = unique(enabledAmenities.map((item) => String(item.code || item.name || "").toUpperCase()).filter(Boolean));
  return {
    detailsChecked: true,
    amenities,
    hasBioToilet: amenities.includes("BIO_TOILET"),
    hasAirConditioning: amenities.includes("AIR_CONDITIONING") || amenities.includes("CONDITIONER"),
    hasToilet: amenities.includes("TOILET"),
    luggageCompartment: amenities.includes("LUGGAGE_COMPARTMENT"),
    luggageAvailable: Boolean(details.luggage?.available ?? details.luggage?.included ?? details.luggage),
    seatSelectionAvailable: Boolean(details.seat_selection?.available === true || details.seat_selection?.required === true || Number(details.seat_selection?.free_count || 0) > 0 || details.seat_selection?.available_seat_ids?.length)
  };
}

function routeRiskScore(route) {
  const coverage = route.accessibility?.coverage || {};
  return (coverage.missing || 0) * 40 + (coverage.unknown || 0) * 20 + (coverage.partial || 0) * 8 + (coverage.actions || 0) * 3 + (route.changes || 0) * 2 - (coverage.confirmed || 0);
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
  return [];
}

export function extractMcpContext(mcpResponse, input) {
  const content = mcpResponse?.result?.content || [];
  for (const item of content) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      const payload = JSON.parse(item.text);
      const meta = payload.meta || {};
      const offerCount = (payload.offers?.length || 0) + (payload.variants?.length || 0);
      return {
        resolvedFrom: offerCount ? meta.from?.name || input.from : input.from,
        resolvedTo: offerCount ? meta.to?.name || input.to : input.to,
        fromRegion: offerCount ? meta.from?.region || null : null,
        toRegion: offerCount ? meta.to?.region || null : null,
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
  const offerFacts = extractOfferFacts(offer);
  const selectedPrice = input.checkedBaggage && offerFacts.checkedBaggage?.price
    ? offerFacts.checkedBaggage.price
    : Number(offer.price?.amount || 0);

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
    price: selectedPrice,
    priceBasis: offerFacts.passengersAdult + offerFacts.passengersChild > 1 ? "за всех пассажиров" : input.checkedBaggage && offerFacts.checkedBaggage ? "тариф с багажом" : "за пассажира",
    currency: offer.price?.currency || "RUB",
    changes: Math.max(0, Number(offer.segments_count || 1) - 1),
    bookingUrl: preferredBookingUrl(offer),
    searchResultsUrl: offer.search_results_url,
    detailsRef: offer.details_ref || null,
    offerFacts,
    evidence: [
      { label: "Билет и расписание", state: "confirmed", note: "Подтверждено данными Туту" },
      { label: "Станции", state: "confirmed", note: `${offer.legs?.[0]?.from || segment.from || input.from} → ${lastLeg?.to || lastSegment.to || input.to}` },
      ...(categories.length ? [{ label: "Вагоны в продаже", state: "confirmed", note: categories.join(", ") }] : []),
      ...(review ? [{ label: "Отзывы о поезде", state: "confirmed", note: review }] : [])
    ]
  };
  return assessRoute(route, input);
}

function extractOfferFacts(offer) {
  const variants = Array.isArray(offer.variants) ? offer.variants : [];
  const baggageVariant = variants.find((variant) => Number(variant?.conditions?.baggage?.pieces || 0) > 0 || Number(variant?.conditions?.baggage?.kg || variant?.conditions?.baggage?.weight_kg || 0) > 0) || null;
  const checkedBaggage = baggageVariant?.conditions?.baggage || null;
  const passengerRef = offer.checkout_ref || offer.details_ref || {};
  return {
    passengersAdult: Number(passengerRef.passengers_full ?? passengerRef.adults ?? 0),
    passengersChild: Number(passengerRef.passengers_child ?? passengerRef.children ?? 0),
    seatSelectionAvailable: variants.some((variant) => {
      const value = variant?.conditions?.seat_selection;
      return value === true || /^available/i.test(String(value || ""));
    }),
    checkedBaggage: checkedBaggage ? {
      pieces: Number(checkedBaggage.pieces || 0),
      kg: Number(checkedBaggage.kg || checkedBaggage.weight_kg || 0),
      price: Number(baggageVariant?.price?.amount || baggageVariant?.price || 0)
    } : null
  };
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

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

const form = document.querySelector("#searchForm");
const results = document.querySelector("#results");
const resultContent = document.querySelector("#resultContent");
const submitButton = document.querySelector("#submitButton");
const dateInput = document.querySelector("#date");
const mcpStatus = document.querySelector("#mcpStatus");
const modeInput = form.elements.mode;
const requirementChoices = [...document.querySelectorAll("[data-modes]")];

const tomorrow = new Date(Date.now() + 86_400_000);
dateInput.min = new Date().toISOString().slice(0, 10);
dateInput.value = tomorrow.toISOString().slice(0, 10);

updateAvailableRequirements();
modeInput.addEventListener("change", updateAvailableRequirements);
document.querySelector("#swapCities").addEventListener("click", () => {
  [form.elements.from.value, form.elements.to.value] = [form.elements.to.value, form.elements.from.value];
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  const payload = Object.fromEntries(new FormData(form));
  for (const name of ["directOnly", "childPassenger", "checkedBaggage", "onboardToilet", "airConditioning", "seatSelection"]) {
    payload[name] = Boolean(form.elements[name]?.checked && !form.elements[name].closest("[data-modes]")?.hidden);
  }

  setLoading(payload);
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.fields) showErrors(data.fields);
      throw new Error(data.error || "Не удалось выполнить поиск");
    }
    renderResults(data, payload);
  } catch (error) {
    renderError(error.message);
  } finally {
    results.setAttribute("aria-busy", "false");
    submitButton.disabled = false;
  }
});

async function checkMcp() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    const isLive = data.mcp?.ok;
    mcpStatus.className = `mcp-status ${isLive ? "is-live" : "is-demo"}`;
    mcpStatus.innerHTML = `<span class="status-dot"></span><span>${isLive ? "Сервис работает" : "Ограниченный режим"}</span>`;
  } catch {
    mcpStatus.className = "mcp-status is-demo";
    mcpStatus.innerHTML = '<span class="status-dot"></span><span>Статус неизвестен</span>';
  }
}

function setLoading(payload) {
  results.hidden = false;
  results.setAttribute("aria-busy", "true");
  submitButton.disabled = true;
  resultContent.innerHTML = `
    <div class="loading-card">
      <div class="loader" aria-hidden="true"><span></span><span></span><span></span></div>
      <div><p class="eyebrow">Проверяем всю цепочку</p><h2>${escapeHtml(payload.from)} → ${escapeHtml(payload.to)}</h2>
      <ol><li class="done">Подбираем предложения Туту</li><li>Сверяем проверяемые условия</li><li>Сортируем полные совпадения</li></ol></div>
    </div>`;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResults(data, payload) {
  if (data.mode === "empty") return renderEmpty(data, payload);
  const demo = data.mode === "demo";
  const from = data.context?.resolvedFrom || payload.from;
  const to = data.context?.resolvedTo || payload.to;
  const corrections = [];
  if (!samePlace(payload.from, from)) corrections.push(`«${escapeHtml(payload.from)}» распознано как «${escapeHtml(from)}»`);
  if (!samePlace(payload.to, to)) corrections.push(`«${escapeHtml(payload.to)}» распознано как «${escapeHtml(to)}»`);
  const unavailable = (data.context?.unavailable || []).map((item) => modeLabel(item.mode)).filter(Boolean);
  resultContent.innerHTML = `
    ${demo ? `<div class="mode-banner" role="status"><strong>Демонстрационный режим.</strong> ${escapeHtml(data.warning)}</div>` : ""}
    ${corrections.length ? `<div class="correction-banner" role="status"><span>✓</span><div><strong>Уточнили направление</strong><p>${corrections.join(" · ")}</p></div></div>` : ""}
    ${unavailable.length ? `<div class="mode-banner"><strong>Учли ограничения маршрута.</strong> Не нашли варианты: ${escapeHtml(unavailable.join(", "))}. Показываем доступные виды транспорта.</div>` : ""}
    <div class="results-header">
      <div><p class="eyebrow">${demo ? "Пример интерфейса" : "Проверенные предложения"}</p><h2>${escapeHtml(from)} → ${escapeHtml(to)}</h2><p>Сверили только выбранные условия, которые действительно доступны в данных.</p></div>
      <div class="source-badge"><span></span>Обновлено ${formatSearchTime(data.searchedAt)}</div>
    </div>
    ${data.decision ? decisionPanel(data.decision, data.routes) : ""}
    ${data.inclusion ? inclusionResultPanel(data.inclusion, from, to) : ""}
    <div class="route-list">${data.routes.map((route, index) => routeCard(route, index, data.routes.length)).join("")}</div>`;
}

function inclusionResultPanel(inclusion, from, to) {
  return `<details class="result-inclusion">
    <summary><span><i aria-hidden="true">♿</i><strong>Инклюзивность маршрута ${escapeHtml(from)} → ${escapeHtml(to)}</strong><small>Почему мы пока не включаем неподтверждаемые условия в зелёный статус</small></span><b>Прочитать</b></summary>
    <div class="result-inclusion-body"><p><strong>Это ограничение доступных данных, а не пользователя.</strong> ${escapeHtml(inclusion.message)}</p>
      <div>${(inclusion.missingData || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      <p>Пилотный доказательный реестр: ${inclusion.pilotFacilities} объекта. Для промышленного запуска нужен единый контур данных вокзалов, аэропортов, остановок, перевозчиков и оперативных событий.</p>
      <a href="/inclusion">Посмотреть архитектуру и дорожную карту →</a>
    </div>
  </details>`;
}

function decisionPanel(decision, routes) {
  return `<section class="decision-panel" aria-labelledby="decision-title">
    <div class="decision-heading"><div><p class="eyebrow">Цена компромисса</p><h3 id="decision-title">Не просто отфильтровали — сравнили решения</h3></div><p>${decision.hasTradeoff ? "Показываем, что можно выиграть и каким условием придётся пожертвовать." : "Лучший вариант выигрывает без отказа от выбранных условий."}</p></div>
    <div class="decision-grid">${decision.scenarios.map((scenario) => {
      const routeIndex = routes.findIndex((route) => route.id === scenario.routeId);
      const metric = scenario.type === "fastest" ? durationLabel(scenario.durationMinutes) : scenario.price ? `${number(scenario.price)} ₽` : "Цена в Туту";
      return `<button class="decision-option ${scenario.status === "fits" ? "is-fit" : "has-tradeoff"}" type="button" data-route-index="${routeIndex}">
        <span>${escapeHtml(scenario.title)}</span><strong>${escapeHtml(metric)}</strong><small>${escapeHtml(scenario.transport || "Маршрут")}</small><p>${escapeHtml(scenario.explanation)}</p><em>Показать предложение →</em>
      </button>`;
    }).join("")}</div>
  </section>`;
}

function routeCard(route, index, total) {
  const departure = formatDateTime(route.departure);
  const arrival = formatDateTime(route.arrival);
  const status = route.accessibility?.status || "verify";
  const coverage = route.accessibility?.coverage || { confirmed: 0, total: 0, partial: 0, unknown: 0, missing: 0, actions: 0 };
  const coverageText = coverage.total
    ? `${coverage.confirmed} из ${coverage.total} условий полностью подтверждено`
    : "Дополнительные условия не выбраны";
  return `
    <article class="route-card ${index === 0 ? "recommended" : ""}" id="route-card-${index}">
      <div class="route-top">
        <div><span class="transport">${escapeHtml(route.transport || "Маршрут")}</span>${index === 0 && total > 1 ? '<span class="best">Начать с этого</span>' : ""}</div>
        <span class="access-status ${status}"><i></i>${escapeHtml(route.accessibility?.label || "Нужно уточнить")}</span>
      </div>
      <div class="route-main">
        <div class="time"><strong>${departure.time}</strong><span>${escapeHtml(route.from)}</span><small>${departure.date}</small></div>
        <div class="journey"><span>${durationLabel(route.durationMinutes)}</span><div><i></i><i></i></div><small>${route.changes ? `${route.changes} пересадка` : "Без пересадок"}</small></div>
        <div class="time"><strong>${arrival.time}</strong><span>${escapeHtml(route.to)}</span><small>${arrival.date}</small></div>
        <div class="price"><strong>${route.price ? `${number(route.price)} ₽` : "Цена в Туту"}</strong><span>${escapeHtml(route.priceBasis || "за пассажира")}</span></div>
      </div>
      <div class="coverage-line"><strong>${escapeHtml(coverageText)}</strong><span>${coverage.missing ? `не соответствует: ${coverage.missing} · ` : ""}${coverage.partial ? `частично: ${coverage.partial} · ` : ""}${coverage.unknown ? `нет данных: ${coverage.unknown}` : "нет неизвестных условий"}${coverage.actions ? ` · обязательных действий: ${coverage.actions}` : ""}</span></div>
      <div class="weakest ${status === "fits" ? "is-ok" : ""}"><span aria-hidden="true">${status === "fits" ? "✓" : "!"}</span><div><strong>${status === "fits" ? "Результат проверки" : status === "not-fit" ? "Не выполнено" : "Требует проверки"}</strong><p>${escapeHtml(route.accessibility?.weakestLink || "Требуется проверка")}</p></div></div>
      <details>
        <summary>Почему такой вывод <span>+</span></summary>
        <div class="evidence-list">${(route.evidence || []).map(evidenceCard).join("")}</div>
      </details>
      <div class="route-actions">
        <span class="handoff-note">${handoffLabel(route)}</span>
        <button class="secondary-button" type="button" data-plan='${escapeAttribute(JSON.stringify(route.accessibility?.actions || []))}'>Что сделать до поездки</button>
        <a class="book-button" href="${safeUrl(route.bookingUrl)}" target="_blank" rel="noreferrer">${bookingLabel(route)} <span>→</span></a>
      </div>
    </article>`;
}

function evidenceCard(item) {
  const source = item.source?.url
    ? `<a href="${safeUrl(item.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.source.publisher || "Источник")}${item.source.checkedAt ? ` · проверено ${formatShortDate(item.source.checkedAt)}` : ""} ↗</a>`
    : "";
  const stateLabel = ({ confirmed: "Подтверждено", partial: "Частично", action: "Нужно действие", unknown: "Нет данных", missing: "Не соответствует", demo: "Демо" })[item.state] || "Статус неизвестен";
  return `<div class="evidence-card"><i class="evidence-${item.state}"></i><span><em>${stateLabel}</em><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.note)}</small>${source}</span></div>`;
}

function renderEmpty(data, payload) {
  const from = data.context?.resolvedFrom || payload.from;
  const to = data.context?.resolvedTo || payload.to;
  const corrected = !samePlace(payload.to, to) ? `<div class="correction-banner"><span>✓</span><div><strong>Название уточнено</strong><p>«${escapeHtml(payload.to)}» распознано как «${escapeHtml(to)}»</p></div></div>` : "";
  resultContent.innerHTML = `${corrected}<div class="empty-card"><span aria-hidden="true">↗</span><div><p class="eyebrow">${escapeHtml(from)} → ${escapeHtml(to)}</p><h2>Этим транспортом добраться не получилось</h2><p>${escapeHtml(data.message || "Попробуйте изменить дату или вид транспорта.")}</p>${data.suggestedMode === "any" ? '<button class="primary-button" type="button" id="searchAllButton">Показать другие виды транспорта <span>→</span></button>' : ""}</div></div>`;
  document.querySelector("#searchAllButton")?.addEventListener("click", () => {
    form.elements.mode.value = "any";
    form.requestSubmit();
  });
}

resultContent.addEventListener("click", (event) => {
  const scenario = event.target.closest("[data-route-index]");
  if (scenario) {
    const card = document.querySelector(`#route-card-${scenario.dataset.routeIndex}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("is-highlighted");
    setTimeout(() => card?.classList.remove("is-highlighted"), 1400);
    return;
  }
  const button = event.target.closest("[data-plan]");
  if (!button) return;
  const actions = JSON.parse(button.dataset.plan || "[]");
  const old = button.closest(".route-card").querySelector(".action-plan");
  if (old) return old.remove();
  button.closest(".route-card").insertAdjacentHTML("beforeend", `<div class="action-plan"><strong>До оплаты</strong><ol>${actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol><p>Мы не подменяем подтверждение перевозчика — мы помогаем ничего не забыть.</p></div>`);
});

function renderError(message) {
  resultContent.innerHTML = `<div class="error-card"><span aria-hidden="true">↻</span><div><p class="eyebrow">Поиск прервался</p><h2>Маршрут не потерян</h2><p>${escapeHtml(message)}. Проверьте соединение и попробуйте ещё раз.</p><button class="primary-button" type="button" id="retryButton">Повторить поиск</button></div></div>`;
  document.querySelector("#retryButton").addEventListener("click", () => form.requestSubmit());
}

function showErrors(errors) {
  Object.entries(errors).forEach(([field, message]) => {
    const input = form.elements[field];
    if (input) input.setAttribute("aria-invalid", "true");
    const target = document.querySelector(`[data-error-for="${field}"]`);
    if (target) target.textContent = message;
  });
}

function clearErrors() {
  form.querySelectorAll("[aria-invalid]").forEach((input) => input.removeAttribute("aria-invalid"));
  form.querySelectorAll(".field-error").forEach((item) => { item.textContent = ""; });
}

function updateAvailableRequirements() {
  const mode = modeInput.value;
  for (const choice of requirementChoices) {
    const visible = choice.dataset.modes.split(",").includes(mode);
    choice.hidden = !visible;
    if (!visible) choice.querySelector("input").checked = false;
  }
  const labels = { any: "Для поиска по всем видам транспорта можем строго проверить только отсутствие пересадок.", train: "Для поездов проверяем маршрут и оснащение конкретного вагона.", plane: "Для самолётов проверяем пассажиров и условия конкретных тарифов.", bus: "Для автобусов проверяем пассажиров, багаж и оснащение рейса." };
  document.querySelector("#requirementHint").textContent = labels[mode];
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { time: "—", date: "Уточнить" };
  return {
    time: date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    date: date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
  };
}

function durationLabel(minutes) {
  if (!minutes) return "Время в Туту";
  return `${Math.floor(minutes / 60)} ч ${minutes % 60 ? `${minutes % 60} мин` : ""}`;
}

function number(value) { return new Intl.NumberFormat("ru-RU").format(value); }
function bookingLabel(route) {
  if (route.productType === "avia") return "Посмотреть рейсы в Туту";
  if (route.productType === "bus") return "Выбрать рейс в Туту";
  if (["rail", "railway"].includes(route.productType)) return "Выбрать места в Туту";
  return "Продолжить в Туту";
}
function handoffLabel(route) {
  if (route.productType === "avia") return "Направление, дата и пассажиры уже заполнены";
  if (["rail", "railway"].includes(route.productType)) return "Направление, дата и поезд уже выбраны";
  return "Направление и дата уже заполнены";
}
function samePlace(left, right) { return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase(); }
function modeLabel(mode) { return ({ railway: "поезда", rail: "поезда", avia: "самолёты", bus: "автобусы", etrain: "электрички" })[mode] || ""; }
function formatSearchTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "сейчас" : date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
function formatShortDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }); }
function safeUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "https://www.tutu.ru/"; } catch { return "https://www.tutu.ru/"; } }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value = "") { return escapeHtml(value); }

checkMcp();
setInterval(checkMcp, 60_000);

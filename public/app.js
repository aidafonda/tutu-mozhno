const form = document.querySelector("#searchForm");
const results = document.querySelector("#results");
const resultContent = document.querySelector("#resultContent");
const submitButton = document.querySelector("#submitButton");
const dateInput = document.querySelector("#date");
const walkInput = form.elements.maxWalk;
const walkOutput = document.querySelector("#walkOutput");
const mcpStatus = document.querySelector("#mcpStatus");

const tomorrow = new Date(Date.now() + 86_400_000);
dateInput.min = new Date().toISOString().slice(0, 10);
dateInput.value = tomorrow.toISOString().slice(0, 10);

walkInput.addEventListener("input", () => { walkOutput.value = `${walkInput.value} м`; });
document.querySelector("#swapCities").addEventListener("click", () => {
  [form.elements.from.value, form.elements.to.value] = [form.elements.to.value, form.elements.from.value];
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  const payload = Object.fromEntries(new FormData(form));
  payload.stepFree = form.elements.stepFree.checked;
  payload.assistance = form.elements.assistance.checked;
  payload.accessibleToilet = form.elements.accessibleToilet.checked;

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
    mcpStatus.innerHTML = `<span class="status-dot"></span><span>${isLive ? `MCP онлайн · ${data.mcp.tools.length} инструментов` : "Демо-режим"}</span>`;
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
      <ol><li class="done">Подбираем предложения Туту</li><li>Сверяем ваши требования</li><li>Ищем слабое звено</li></ol></div>
    </div>`;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResults(data, payload) {
  const demo = data.mode === "demo";
  resultContent.innerHTML = `
    ${demo ? `<div class="mode-banner" role="status"><strong>Демонстрационный режим.</strong> ${escapeHtml(data.warning)}</div>` : ""}
    <div class="results-header">
      <div><p class="eyebrow">${demo ? "Пример интерфейса" : "Актуальные предложения"}</p><h2>${escapeHtml(payload.from)} → ${escapeHtml(payload.to)}</h2><p>Показываем не «процент доступности», а главное неизвестное и следующее действие.</p></div>
      <div class="source-badge"><span></span>${escapeHtml(data.source)}</div>
    </div>
    <div class="route-list">${data.routes.map((route, index) => routeCard(route, index)).join("")}</div>`;
}

function routeCard(route, index) {
  const departure = formatDateTime(route.departure);
  const arrival = formatDateTime(route.arrival);
  const status = route.accessibility?.status || "verify";
  return `
    <article class="route-card ${index === 0 ? "recommended" : ""}">
      <div class="route-top">
        <div><span class="transport">${escapeHtml(route.transport || "Маршрут")}</span>${index === 0 ? '<span class="best">Самый спокойный</span>' : ""}</div>
        <span class="access-status ${status}"><i></i>${escapeHtml(route.accessibility?.label || "Нужно уточнить")}</span>
      </div>
      <div class="route-main">
        <div class="time"><strong>${departure.time}</strong><span>${escapeHtml(route.from)}</span><small>${departure.date}</small></div>
        <div class="journey"><span>${durationLabel(route.durationMinutes)}</span><div><i></i><i></i></div><small>${route.changes ? `${route.changes} пересадка` : "Без пересадок"}</small></div>
        <div class="time"><strong>${arrival.time}</strong><span>${escapeHtml(route.to)}</span><small>${arrival.date}</small></div>
        <div class="price"><strong>${route.price ? `${number(route.price)} ₽` : "Цена в Туту"}</strong><span>за пассажира</span></div>
      </div>
      <div class="weakest"><span aria-hidden="true">!</span><div><strong>Слабое звено</strong><p>${escapeHtml(route.accessibility?.weakestLink || "Требуется проверка")}</p></div></div>
      <details>
        <summary>Почему такой вывод <span>+</span></summary>
        <div class="evidence-list">${(route.evidence || []).map((item) => `<div><i class="evidence-${item.state}"></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.note)}</small></span></div>`).join("")}</div>
      </details>
      <div class="route-actions">
        <button class="secondary-button" type="button" data-plan='${escapeAttribute(JSON.stringify(route.accessibility?.actions || []))}'>Что сделать до поездки</button>
        <a class="book-button" href="${safeUrl(route.bookingUrl)}" target="_blank" rel="noreferrer">Перейти в Туту <span>→</span></a>
      </div>
    </article>`;
}

resultContent.addEventListener("click", (event) => {
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
function safeUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "https://www.tutu.ru/"; } catch { return "https://www.tutu.ru/"; } }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value = "") { return escapeHtml(value); }

checkMcp();
setInterval(checkMcp, 60_000);

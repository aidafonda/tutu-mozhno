const labels = { stepFree: "Путь без ступеней", accessibleToilet: "Доступный санузел", assistance: "Сопровождение", platforms: "Платформы" };
const states = { confirmed: "Подтверждено", partial: "Частично", action: "Нужно действие", unknown: "Нет данных" };
const escape = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

try {
  const response = await fetch("/api/accessibility/registry");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  document.querySelector("#method").innerHTML = `<strong>Методология.</strong> ${escape(data.methodology)} <small>Версия реестра: ${escape(data.version)}</small>`;
  document.querySelector("#facilityList").innerHTML = data.facilities.map((facility) => `<article class="facility"><div class="facility-head"><div><h2>${escape(facility.name)}</h2><p>${escape(facility.city)} · код станции ${escape(facility.stationCode)}</p></div><span class="registry-version">Проверено ${escape(facility.source.checkedAt)}</span></div><div class="fact-grid">${Object.entries(facility.facts).map(([key, fact]) => `<div class="fact ${escape(fact.status)}"><span>${escape(states[fact.status] || fact.status)}</span><strong>${escape(labels[key] || key)}</strong><p>${escape(fact.note)}</p></div>`).join("")}</div><a class="source-link" href="${escape(facility.source.url)}" target="_blank" rel="noreferrer">${escape(facility.source.publisher)} ↗</a></article>`).join("");
} catch {
  document.querySelector("#method").textContent = "Не удалось загрузить реестр.";
}

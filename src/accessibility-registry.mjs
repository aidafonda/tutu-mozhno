export const ACCESSIBILITY_REGISTRY_VERSION = "2026-08-19";

export const accessibilityRegistry = [
  {
    id: "rail-2006004",
    kind: "rail_station",
    stationCode: "2006004",
    name: "Ленинградский вокзал",
    city: "Москва",
    aliases: ["ленинградский вокзал", "москва октябрьская", "москва-пассажирская"],
    source: {
      publisher: "Дирекция железнодорожных вокзалов РЖД",
      url: "https://leningradsky.dzvr.ru/",
      checkedAt: ACCESSIBILITY_REGISTRY_VERSION
    },
    facts: {
      stepFree: {
        status: "partial",
        note: "Вход для МГН оборудован пандусом, но входные группы и платформы оценены источником как частично доступные (75%)."
      },
      accessibleToilet: {
        status: "confirmed",
        note: "Адаптированная туалетная комната находится на цокольном этаже."
      },
      assistance: {
        status: "action",
        note: "Помощь и сопровождение доступны по предварительной заявке в Центр содействия мобильности РЖД.",
        leadTimeHours: 24,
        phone: "8 800 775-00-00"
      },
      platforms: {
        status: "partial",
        note: "Есть расширенный проход и переносные аппарели; платформы оценены как частично доступные (75%)."
      }
    }
  },
  {
    id: "rail-2004001",
    kind: "rail_station",
    stationCode: "2004001",
    name: "Московский вокзал",
    city: "Санкт-Петербург",
    aliases: ["московский вокзал", "санкт-петербург главный", "санкт-петербург-главный"],
    source: {
      publisher: "Дирекция железнодорожных вокзалов РЖД",
      url: "https://moskovsky.dzvr.ru/",
      checkedAt: ACCESSIBILITY_REGISTRY_VERSION
    },
    facts: {
      stepFree: {
        status: "confirmed",
        note: "Вход оборудован пандусом, со стороны платформ нет вертикальных препятствий; пути движения оценены как доступные."
      },
      accessibleToilet: {
        status: "confirmed",
        note: "Выделенный санузел оборудован откидным поручнем и кнопкой вызова персонала."
      },
      assistance: {
        status: "action",
        note: "Помощь и сопровождение доступны по предварительной заявке в Центр содействия мобильности РЖД.",
        leadTimeHours: 24,
        phone: "8 800 775-00-00"
      },
      platforms: {
        status: "confirmed",
        note: "К платформам предусмотрен доступный проход для пассажиров на креслах-колясках."
      }
    }
  }
];

export function findFacility(value, kind) {
  const text = normalize(value);
  return accessibilityRegistry.find((facility) => {
    if (kind && facility.kind !== kind) return false;
    if (facility.stationCode && text.includes(facility.stationCode)) return true;
    return facility.aliases.some((alias) => text.includes(normalize(alias)));
  }) || null;
}

export function publicRegistry() {
  return {
    version: ACCESSIBILITY_REGISTRY_VERSION,
    scope: "Пилотный реестр официально проверенных железнодорожных вокзалов",
    methodology: "Факт считается подтверждённым только при наличии ссылки на официальный паспорт объекта. Отсутствие объекта в реестре означает «нет данных», а не «недоступно».",
    facilities: accessibilityRegistry
  };
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

import {
  dressingDepartments,
  reportOperationCategory
} from "./reportOperations";

describe("report operation presentation", () => {
  it("groups every intervention with intravascular imaging as KAG + stent", () => {
    expect(reportOperationCategory({ operation: "КАГ. ВСУЗИ. Стент ПНА" })).toBe("КАГ + стент");
    expect(reportOperationCategory({ operation: "БАП ПКА + внутрисосудистая визуализация" })).toBe("КАГ + стент");
  });

  it.each([
    ["ЦАГ + ТА СМА", "ЦАГ + ТА"],
    ["цаг, тэ из ПМА", "ЦАГ + ТА"],
    ["Церебральная ангиография. Тромбаспирация", "ЦАГ + ТА"],
    ["ЦАГ: ТРОМБО-АСПИРАЦИЯ", "ЦАГ + ТА"],
    ["ЦАГ; тромб экстракция", "ЦАГ + ТА"],
    ["ЦАГ — тромбэкстракция + стентирование ВСА", "ЦАГ + ТА + стент"],
    ["ЦАГ, ТА, баллонная ангиопластика", "ЦАГ + ТА + БАП"],
    ["ЦАГ + ТЭ + БАП + стентирование", "ЦАГ + ТА + стент"]
  ] as const)("classifies combined cerebral intervention %s", (operation, expected) => {
    expect(reportOperationCategory({ operation })).toBe(expected);
  });

  it("builds a deduplicated dressing route by department without today's plan", () => {
    const groups = dressingDepartments({
      emergency_operations: [
        { patient: "Петров Иван", department: "рсц", operation: "ЦАГ" },
        { patient: "Петров Иван", department: "рсц", operation: "ЦАГ" }
      ],
      planned_operations: [
        { patient: "Иванов Петр", department: "к/о 2", operation: "КАГ" }
      ],
      today_planned_operations: [
        { patient: "Неоперированный Пациент", department: "к/о 1", operation: "КАГ" }
      ]
    });

    expect(groups).toEqual([
      {
        department: "к/о 2",
        patients: [expect.objectContaining({ patient: "Иванов Петр" })]
      },
      {
        department: "рсц",
        patients: [expect.objectContaining({ patient: "Петров Иван" })]
      }
    ]);
  });
});

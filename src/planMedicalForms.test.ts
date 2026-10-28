import { buildMedicalForms, medicalFormDate, medicalFormName, radiationProcedureName, surgicalProcedureName } from "./planMedicalForms";

describe("medical plan forms", () => {
  test("surgical consent distinguishes diagnostic and possible stenting procedures", () => {
    expect(surgicalProcedureName("каг")).toBe("Коронарография");
    expect(surgicalProcedureName("КАГ + стент")).toBe("Коронарография с возможным стентированием");
    expect(surgicalProcedureName("каг стент + цаг")).toBe("Коронарография с возможным стентированием; Церебральная ангиография");
    expect(radiationProcedureName("каг стент")).toBe("Коронарография");
  });
  test("surgical template uses plan data and selected doctor, never source example details", () => {
    const html = buildMedicalForms("surgery", "2026-10-28", [{patient:"Петров ИИ",operation:"каг стент",department:"кардио 2",birth_date:"1960-01-03"}], "Идрисов МЗ");
    expect(html).toContain("Петров И.И.");
    expect(html).toContain("03.01.1960");
    expect(html).toContain("Кардиологическое №2");
    expect(html).toContain("Врач ОРХМДиЛ <b>Идрисов М.З.</b>");
    expect(html).toContain("(подпись) __________________");
    expect(html.match(/class="page surgical"/g)).toHaveLength(2);
    expect(html).not.toMatch(/Бурачевский|Галашова|Лесной|Мельниково/);
    expect(() => buildMedicalForms("surgery", "2026-10-28", [{patient:"Петров ИИ",operation:"каг"}])).toThrow("хирурга");
  });
  test("uses hospital date, not device timezone", () => {
    expect(medicalFormDate(new Date("2026-10-27T18:00:00Z"))).toBe("2026-10-28");
  });
  test("normalizes initials and full names", () => {
    expect(medicalFormName("Студницкий АВ")).toBe("Студницкий А.В.");
    expect(medicalFormName("Захаров Сергей Васильевич")).toBe("Захаров С.В.");
  });
  test("expands procedures and multiple operations", () => {
    expect(radiationProcedureName("каг + стент")).toBe("Коронарография");
    expect(radiationProcedureName("каг стент + цаг")).toBe("Коронарография; Церебральная ангиография");
    expect(radiationProcedureName("гибрид")).toBe("Ангиография и ангиопластика артерий голени");
  });
  test("pairs radiation forms without duplicating patients", () => {
    const html = buildMedicalForms("radiation", "2026-10-28", ["Первый АБ", "Второй ВГ", "Третий ДЕ"].map(patient => ({patient, operation: "каг"})));
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html.match(/class="radiation"/g)).toHaveLength(3);
    expect(html).toContain("28.10.2026");
  });
  test("consent has specified doctor and method, no sample medical record", () => {
    const html = buildMedicalForms("anesthesia", "2026-10-28", [{patient: "Петров ИИ", operation: "каг"}], "Студницкий АВ");
    expect(html).toContain("Студницкий А.В.");
    expect(html).toContain("миа, возможный общий");
    expect(html).not.toContain("27999");
    expect(html).toContain("Приложение к медицинской карте стационарного больного.</p>");
    expect(html).not.toContain("больного №");
    expect(html).not.toContain("Захаров");
  });
  test("rejects empty batches and escapes user text", () => {
    expect(() => buildMedicalForms("radiation", "2026-10-28", [])).toThrow();
    expect(buildMedicalForms("radiation", "2026-10-28", [{patient: "<script>", operation: "<img>"}])).not.toContain("<script>");
  });
});

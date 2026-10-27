import { buildMedicalForms, medicalFormDate, medicalFormName, radiationProcedureName } from "./planMedicalForms";

describe("medical plan forms", () => {
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

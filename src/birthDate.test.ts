import { normalizeBirthDate, planPatientAge } from "./birthDate";

test("birth date accepts Russian input and rejects impossible dates", () => {
  expect(normalizeBirthDate("29.02.1956")).toBe("1956-02-29");
  expect(() => normalizeBirthDate("29.02.1955")).toThrow();
  expect(() => normalizeBirthDate("12.13.1955")).toThrow();
  expect(normalizeBirthDate("")).toBe("");
});
test("age uses calendar birthday", () => {
  expect(planPatientAge("1954-09-27", new Date(2026, 8, 26))).toBe("71");
  expect(planPatientAge("1954-09-27", new Date(2026, 8, 27))).toBe("72");
  expect(planPatientAge()).toBe("—");
});

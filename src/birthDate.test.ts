import { formatBirthDateInput, normalizeBirthDate, planPatientAge } from "./birthDate";

test("birth date inserts separators while typing and supports paste and deletion", () => {
  expect(formatBirthDateInput("1")).toBe("1");
  expect(formatBirthDateInput("12", "1")).toBe("12.");
  expect(formatBirthDateInput("12.05", "12.0")).toBe("12.05.");
  expect(formatBirthDateInput("12051954")).toBe("12.05.1954");
  expect(formatBirthDateInput("12.05.1954")).toBe("12.05.1954");
  expect(formatBirthDateInput("12", "12.")).toBe("12");
  expect(formatBirthDateInput("12.05", "12.05.")).toBe("12.05");
  expect(formatBirthDateInput("", "1")).toBe("");
});

test("birth date accepts Russian input and rejects impossible dates", () => {
  expect(normalizeBirthDate("29.02.1956")).toBe("1956-02-29");
  expect(() => normalizeBirthDate("29.02.1955")).toThrow();
  expect(() => normalizeBirthDate("12.13.1955")).toThrow();
  expect(normalizeBirthDate("")).toBe("");
});
test("age uses calendar birthday", () => {
  expect(planPatientAge("1954-09-27", new Date(2026, 8, 26))).toBe("71");
  expect(planPatientAge("1954-09-27", new Date(2026, 8, 27))).toBe("72");
  expect(planPatientAge()).toBe("");
  expect(planPatientAge("")).toBe("");
});

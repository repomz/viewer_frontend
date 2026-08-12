import { findProtocolAngiography, latinPatientSurname, protocolMatchesAngiography } from "./patientMatching";
import type { Study } from "./types";

const study = (patient: string, type: string, date: string): Study => ({
  id: patient + type, created_at: date, updated_at: date, study_id: patient,
  patient, age: 50, department: "", name_operation: "", study_type: type,
  descr_operation: "", time_beginning: date, time_duration: 0, surgeon: "", dicom_link: ""
});

describe("patient angiography matching", () => {
  it("uses the hospital transliteration rules", () => {
    expect(latinPatientSurname("Щукин Юрий Иванович")).toBe("chshukin");
  });

  it("matches the first three surname letters only on the same date", () => {
    const protocol = study("Недопекин Иван Иванович", "каг", "2026-08-03T08:00:00+07:00");
    expect(protocolMatchesAngiography(protocol, study("NEDOPEKIN", "xa", "2026-08-03T11:00:00+07:00"))).toBe(true);
    expect(protocolMatchesAngiography(protocol, study("NEDOPEKIN", "xa", "2026-08-04T11:00:00+07:00"))).toBe(false);
  });

  it("keeps an explicit XA link independently of name and date matching", () => {
    const protocol = study("Иванов Иван", "каг", "2025-01-01T10:00:00+07:00");
    protocol.dicom_link = "xa://study/1.2.840.10008";
    const xa = study("OTHER", "xa", "2026-08-03T11:00:00+07:00");
    xa.study_id = "1.2.840.10008";
    expect(protocolMatchesAngiography(protocol, xa)).toBe(true);
  });

  it("uses additional surname letters when three-letter candidates collide", () => {
    const protocol = study("Байгулов Иван", "каг", "2026-08-13T10:00:00+07:00");
    const bajgulov = study("BAJGULOV", "xa", "2026-08-13T11:00:00+07:00");
    const bajborodov = study("BAJBORODOV", "xa", "2026-08-13T12:00:00+07:00");
    expect(findProtocolAngiography(protocol, [bajborodov, bajgulov])).toBe(bajgulov);
  });

  it("does not guess when five letters still leave multiple candidates", () => {
    const protocol = study("Иванов Иван", "каг", "2026-08-13T10:00:00+07:00");
    const first = study("IVANOV", "xa", "2026-08-13T11:00:00+07:00");
    const second = study("IVANOVA", "xa", "2026-08-13T12:00:00+07:00");
    expect(findProtocolAngiography(protocol, [first, second])).toBeUndefined();
  });
});

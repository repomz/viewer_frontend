import { latinPatientSurname, protocolMatchesAngiography } from "./patientMatching";
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
});

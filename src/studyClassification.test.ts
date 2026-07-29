import { isPacsImagingStudy } from "./studyClassification";
import type { Study } from "./types";

const baseStudy: Study = {
  id: "1",
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T00:00:00Z",
  study_id: "1.2.3",
  patient: "Пациент",
  age: 60,
  department: "не указано",
  name_operation: "XA",
  study_type: "xa",
  descr_operation: "XA",
  time_beginning: "2026-07-29T00:00:00Z",
  time_duration: 0,
  surgeon: "не указано",
  dicom_link: "orthanc://study/1.2.3"
};

describe("isPacsImagingStudy", () => {
  it("recognizes a technical XA record imported into PACS", () => {
    expect(isPacsImagingStudy(baseStudy)).toBe(true);
  });

  it("keeps an XA operation protocol in Studies", () => {
    expect(
      isPacsImagingStudy({
        ...baseStudy,
        department: "Кардиология",
        surgeon: "Иванов И.И.",
        time_duration: 45,
        name_operation: "Коронарография",
        descr_operation: "Полный протокол операции"
      })
    ).toBe(false);
  });

  it("keeps a protocol without a DICOM link in Studies", () => {
    expect(isPacsImagingStudy({ ...baseStudy, dicom_link: "" })).toBe(false);
  });
});

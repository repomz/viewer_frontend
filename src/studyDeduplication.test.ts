import { deduplicateStudies } from "./studyDeduplication";
import type { Study } from "./types";

function study(overrides: Partial<Study>): Study {
  return {
    id: "row-1",
    created_at: "2026-09-24T08:00:00Z",
    updated_at: "2026-09-24T08:00:00Z",
    study_id: "1520",
    patient: "Иванов Иван Иванович",
    age: 60,
    department: "к/о 2",
    name_operation: "КАГ",
    study_type: "каг",
    descr_operation: "Заключение",
    recommendation: "",
    time_beginning: "2026-09-24T07:20:00Z",
    time_duration: 20,
    surgeon: "киргизов",
    dicom_link: "",
    ...overrides
  };
}

describe("deduplicateStudies", () => {
  it("collapses repeated protocol rows even when study_id was shifted", () => {
    const rows = deduplicateStudies([
      study({ id: "new-copy", study_id: "1521" }),
      study({ id: "original", study_id: "1520" })
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("new-copy");
  });

  it("keeps different operations and different operation times", () => {
    const rows = deduplicateStudies([
      study({ id: "first" }),
      study({ id: "other-time", time_beginning: "2026-09-24T07:21:00Z" }),
      study({ id: "other-operation", name_operation: "КАГ стент" })
    ]);

    expect(rows).toHaveLength(3);
  });

  it("prefers a duplicate that already has an XA link", () => {
    const rows = deduplicateStudies([
      study({ id: "without-xa" }),
      study({ id: "with-xa", dicom_link: "xa://study/1.2.3" })
    ]);

    expect(rows[0]?.id).toBe("with-xa");
  });
});

import { studyCategories, studyCategoriesFor } from "./studyOperationCategories";
import type { Study } from "./types";

function study(name_operation: string, descr_operation = ""): Study {
  return {
    id: name_operation,
    study_id: name_operation,
    study_type: "",
    patient: "Пациент",
    age: 0,
    name_operation,
    descr_operation,
    recommendation: "",
    surgeon: "идрисов",
    department: "к/о 2",
    time_beginning: "2026-08-14T08:00:00Z",
    time_duration: 0,
    dicom_link: "",
    created_at: "2026-08-14T08:00:00Z",
    updated_at: "2026-08-14T08:00:00Z"
  };
}

describe("study operation categories", () => {
  it("uses the current statistics operation types", () => {
    expect(studyCategories).toEqual([
      "all", "ВСУЗИ", "КАГ", "ЦАГ", "СТЕНТ КОР", "БАП КОР",
      "СТЕНТ ВСА", "СТЕНТ В/К", "СТЕНТ Н/К", "АНЕВРИЗМА",
      "ИНСУЛЬТ", "Голень", "ДРУГИЕ"
    ]);
  });

  it("keeps multi-label interventions available in every relevant filter", () => {
    expect(studyCategoriesFor(study("КАГ. Стент ПНА + ВСУЗИ"))).toEqual([
      "ВСУЗИ",
      "СТЕНТ КОР"
    ]);
    expect(studyCategoriesFor(study("ЦАГ. Тромбэкстракция СМА"))).toEqual([
      "ЦАГ",
      "ИНСУЛЬТ"
    ]);
  });

  it("uses the fallback for operations outside the current categories", () => {
    expect(studyCategoriesFor(study("ЭМА"))).toEqual(["ДРУГИЕ"]);
  });
});

import type { Study } from "./types";

const PACS_MODALITIES = new Set(["xa", "ct"]);
const UNSPECIFIED = "не указано";

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

/**
 * Imported PACS objects currently share the studies table with operation
 * protocols. The backend marks these technical records with a DICOM link,
 * zero duration and unspecified clinical fields.
 */
export function isPacsImagingStudy(study: Study): boolean {
  return (
    PACS_MODALITIES.has(normalized(study.study_type)) &&
    Boolean(study.dicom_link.trim()) &&
    study.time_duration === 0 &&
    normalized(study.department) === UNSPECIFIED &&
    normalized(study.surgeon) === UNSPECIFIED
  );
}

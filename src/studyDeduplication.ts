import type { Study } from "./types";

function normalized(value: string): string {
  return value.toLocaleLowerCase("ru-RU");
}

function normalizedText(value: string): string {
  return normalized(String(value ?? ""))
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function isImaging(study: Study): boolean {
  return ["xa", "ct"].includes(normalizedText(study.study_type));
}

export function protocolIdentity(study: Study): string {
  const parsedTime = Date.parse(study.time_beginning);
  const time = Number.isFinite(parsedTime)
    ? new Date(parsedTime).toISOString()
    : normalizedText(study.time_beginning);
  return [
    normalizedText(study.patient),
    time,
    normalizedText(study.name_operation)
  ].join("|");
}

/**
 * Removes repeated copies of one operation while preserving genuinely
 * different interventions for the same patient. Imaging rows use their own
 * identifiers and are deliberately not collapsed by patient/time.
 */
export function deduplicateStudies(studies: Study[]): Study[] {
  const result: Study[] = [];
  const positions = new Map<string, number>();

  for (const study of studies) {
    const key = isImaging(study)
      ? `imaging:${study.id || study.study_id}`
      : `protocol:${protocolIdentity(study)}`;
    const existingPosition = positions.get(key);
    if (existingPosition === undefined) {
      positions.set(key, result.length);
      result.push(study);
      continue;
    }

    const existing = result[existingPosition]!;
    if (!existing.dicom_link?.trim() && study.dicom_link?.trim()) {
      result[existingPosition] = study;
    }
  }

  return result;
}

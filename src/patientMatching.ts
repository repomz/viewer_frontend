import type { Study } from "./types";

const transliteration: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "chsh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
};

export function latinPatientSurname(value: string): string {
  const surname = value.toLocaleLowerCase("ru").trim().split(/\s+/)[0] ?? "";
  return [...surname]
    .map((letter) => transliteration[letter] ?? letter)
    .join("")
    .replace(/[^a-z]/g, "");
}

function localDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function protocolMatchesAngiography(protocol: Study, imaging: Study): boolean {
  if (imaging.study_type.toLowerCase() !== "xa") return false;
  if (protocol.dicom_link.includes(imaging.study_id)) return true;
  const protocolSurname = latinPatientSurname(protocol.patient);
  const imagingSurname = latinPatientSurname(imaging.patient);
  if (protocolSurname.length < 3 || imagingSurname.length < 3) return false;
  return protocolSurname.slice(0, 3) === imagingSurname.slice(0, 3) &&
    localDate(protocol.time_beginning) === localDate(imaging.time_beginning);
}

export function findProtocolAngiography(
  protocol: Study,
  imagingStudies: Study[]
): Study | undefined {
  const explicitlyLinked = imagingStudies.find(
    (study) =>
      study.study_type.toLowerCase() === "xa" &&
      protocol.dicom_link.includes(study.study_id)
  );
  if (explicitlyLinked) return explicitlyLinked;

  const protocolSurname = latinPatientSurname(protocol.patient);
  if (protocolSurname.length < 3) return undefined;
  const candidates = imagingStudies.filter((study) => {
    if (study.study_type.toLowerCase() !== "xa") return false;
    const surname = latinPatientSurname(study.patient);
    return surname.length >= 3 &&
      surname.slice(0, 3) === protocolSurname.slice(0, 3) &&
      localDate(protocol.time_beginning) === localDate(study.time_beginning);
  });
  if (candidates.length === 1) return candidates[0];
  for (const length of [4, 5]) {
    const narrowed = candidates.filter((study) => {
      const surname = latinPatientSurname(study.patient);
      return protocolSurname.length >= length && surname.length >= length &&
        surname.slice(0, length) === protocolSurname.slice(0, length);
    });
    if (narrowed.length === 1) return narrowed[0];
  }
  return undefined;
}

/** Format incrementally without trapping Backspace on an inserted separator. */
export function formatBirthDateInput(value: string, previous = ""): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean);
  const formatted = parts.join(".");
  return value.length >= previous.length && (digits.length === 2 || digits.length === 4)
    ? `${formatted}.`
    : formatted;
}

export function normalizeBirthDate(value?: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const parts = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Дата рождения: ДД.ММ.ГГГГ");
  const date = new Date(`${iso}T12:00:00`);
  const [year, month, day] = iso.split("-").map(Number);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date > new Date()) throw new Error("Проверьте дату рождения");
  return iso;
}

export function planPatientAge(value?: string, onDate = new Date()): string {
  if (!value) return "";
  try {
    const [year = 0, month = 0, day = 0] = normalizeBirthDate(value).split("-").map(Number);
    const age = onDate.getFullYear() - year - (onDate.getMonth() + 1 < month || (onDate.getMonth() + 1 === month && onDate.getDate() < day) ? 1 : 0);
    return age >= 0 && age <= 125 ? String(age) : "—";
  } catch { return "—"; }
}

export function displayBirthDate(value?: string): string {
  return value?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1") ?? "";
}

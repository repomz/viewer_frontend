export type MedicalFormKind = "radiation" | "anesthesia";
type Patient = { patient: string; operation: string };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

export function medicalFormDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tomsk", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}

export function medicalFormName(name: string): string {
  const [surname, ...rest] = name.trim().split(/\s+/);
  const initials = rest.length > 1 ? rest.map(s => s[0]).join("") : (rest[0] || "").replace(/\./g, "");
  return `${surname || ""}${initials ? " " + [...initials.slice(0, 2).toUpperCase()].map(c => `${c}.`).join("") : ""}`;
}

const procedures: Record<string, string> = {
  "каг": "Коронарография", "каг стент": "Коронарография", "каг диагностика": "Коронарография",
  "цаг": "Церебральная ангиография", "гибрид": "Ангиография и ангиопластика артерий голени",
  "ангио вса": "Ангиография внутренних сонных артерий", "стент вса": "Стентирование внутренней сонной артерии",
  "ангио в/к": "Ангиография артерий верхних конечностей", "ангио н/к": "Ангиография артерий нижних конечностей",
  "ангио опа/нпа": "Ангиография подвздошных артерий", "стент опа/нпа": "Стентирование подвздошных артерий",
  "бап голень": "Баллонная ангиопластика артерий голени", "бап голени": "Баллонная ангиопластика артерий голени",
  "бап фистулы": "Баллонная ангиопластика артериовенозной фистулы", "экс": "Имплантация электрокардиостимулятора",
  "эма": "Эмболизация маточных артерий", "эмб простаты": "Эмболизация артерий предстательной железы"
};
export function radiationProcedureName(operation: string): string {
  return [...new Set(operation.toLowerCase().replace(/каг\s*\+\s*стент/g, "каг стент").split(/\s+\+\s+|;/).map(s => s.trim()).filter(Boolean).map(s => procedures[s] || s))].join("; ");
}

export function buildMedicalForms(kind: MedicalFormKind, date: string, patients: Patient[], doctor = "", anesthesia = "миа, возможный общий"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Некорректная дата плана");
  if (!patients.length) throw new Error("На сегодня в плане нет пациентов");
  if (kind === "anesthesia" && !doctor.trim()) throw new Error("Укажите ФИО анестезиолога");
  const day = date.split("-").reverse().join(".");
  const radiation = (p: Patient) => `<section class="radiation"><h2>Лист учета лучевой нагрузки</h2><div class="fio">ФИО <u>${escape(medicalFormName(p.patient))}</u></div><table><colgroup><col style="width:15%"><col style="width:58%"><col style="width:15%"><col style="width:12%"></colgroup><thead><tr><th>Дата</th><th>Наименование рентгенологического исследования, исследования с помощью радионуклидов, метода радиационной терапии, метода лечения с помощью лучевого воздействия, иного метода диагностики или лечения, сопровождающегося лучевой нагрузкой</th><th>Код по номенклатуре медицинских услуг</th><th>Величина лучевой нагрузки (доза), милизиверт (мЗв)</th></tr></thead><tbody>${Array.from({length:8}, (_, i) => `<tr><td>${i ? "" : day}</td><td>${i ? "" : escape(radiationProcedureName(p.operation))}</td><td></td><td></td></tr>`).join("")}</tbody></table></section>`;
  const consent = (p: Patient) => `<section class="page consent"><h2>ОГАУЗ "Томская областная клиническая больница"</h2><p>Приложение к медицинской карте стационарного больного.</p><h2>СОГЛАСИЕ НА АНЕСТЕЗИОЛОГИЧЕСКОЕ ПОСОБИЕ</h2>
<p>Я <b>${escape(medicalFormName(p.patient))}</b> в соответствии со ст. 21 и 41 Конституции РФ и со ст. ст. 19, 20, 22 Федерального закона от 21 ноября 2011 г. N 323-ФЗ "Об основах охраны здоровья граждан в Российской Федерации", подписывая данный документ, добровольно, без какого-либо внешнего давления, даю согласие на проведение анестезиологического пособия в ОГАУЗ "Томская областная клиническая больница".</p>
<p>Я подтверждаю, что в доступной форме информирован о выбранном врачом анестезиологом виде и методе анестезиологического пособия</p><div class="line">${escape(anesthesia)}</div><small>(указать полное наименование выбранного вида и метода анестезиологического пособия)</small>
<p>Я, в доступной для меня форме, информирован(а) о характере, особенностях, риске, возможных последствиях и осложнениях предстоящего анестезиологического пособия, сопряженных с риском инфицирования, развития нарушений сердечно-сосудистой системы, нарушений других органов и систем, и даже летального исхода.</p>
<p>Я согласен(а) на катетеризацию центральных вен.</p>
<p>В случае, если во время анестезии или операции возникнут осложнения или иная непредвиденная ситуация, требующая в интересах моего здоровья изменения вида и метода анестезии, трансфузии компонентов крови и кровезаменителей или проведение иных врачебных мероприятий, я полностью доверяю решение данных вопросов врачу анестезиологу.</p>
<p>В случае необходимости я согласна(ен) на проведение повторных анестезий.</p>
<p>Я подтверждаю, что не принимал(а) пищу и не пил(а) любые жидкости за _____ часов до анестезии.</p>
<p>Я информирован(а) о составе анестезиологической бригады, выполняющей анестезиологическое пособие.</p>
<p>Я подтверждаю, что у меня была возможность обсудить с врачом-анестезиологом мое состояние, сущность и особенности предполагаемого анестезиологического пособия. На все вопросы я получил(а) удовлетворяющие меня ответы, Мне, было, предоставлено достаточно времени для принятия решения.</p>
<p>Моя, личная, подпись удостоверяет, что я ознакомлен (а) со всеми пунктами настоящего документа, данные мне объяснения меня полностью удовлетворяют, я полностью понимаю назначение данного документа и подтверждаю свое согласие на вышеуказанное анестезиологическое пособие.</p>
<p>Ф.И.О. пациента(ки) <b>${escape(medicalFormName(p.patient))}</b></p>
<p>Ф.И.О. законного представителя пациента с указанием характера отношений</p><div class="line">&nbsp;</div><small>(ФИО полностью, указать родственные или иные отношения)</small>
<p>Подпись___________________ ______________________</p><p>${day}</p><div class="doctor">Лечащий врач <span><u>${escape(medicalFormName(doctor))}</u><small>(фамилия, имя, отчество (при наличии) медицинского работника)</small></span><span>________________<small>(подпись)</small></span></div></section>`;
  const pages = kind === "anesthesia" ? patients.map(consent).join("") : patients.reduce<string[]>((all, p, i) => { if (i % 2 === 0) all.push(""); all[all.length - 1] += radiation(p); return all; }, []).map(p => `<div class="page">${p}</div>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${kind === "radiation" ? "Лучевая нагрузка" : "Согласие анестезиолога"} ${day}</title><style>
@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#000;background:#fff}.page{break-after:page}.page:last-child{break-after:auto}h2{margin:0 0 3mm;text-align:center;font-size:13pt}.radiation{height:138mm;font-family:"Times New Roman",serif;padding-bottom:6mm}.fio{font-size:12pt;margin-bottom:3mm}.fio u{display:inline-block;min-width:145mm}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:0.3mm solid #000;padding:1mm}th{font-size:8.5pt;line-height:1.05}td{height:11mm;font-size:10pt;vertical-align:middle}.consent{font-family:Arial,sans-serif;padding:10mm 5mm 0 20mm;font-size:8pt;line-height:1.23}.consent h2{font-size:10pt;margin-bottom:3mm}.consent p{margin:2.5mm 0;text-align:justify}.line{border-bottom:1px solid #000;text-align:center;min-height:4mm}small{display:block;text-align:center;font-size:6.5pt}.doctor{display:flex;gap:5mm;align-items:center;margin-top:4mm}.doctor span:first-of-type{flex:1;text-align:center}
</style></head><body>${pages}</body></html>`;
}

// Operational dates use Fortaleza's UTC-03:00 offset, independently of the
// browser's local time zone. Empty or invalid partial inputs never become dates.
export function localDateTimeToIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "";
  const day = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== date) return "";
  const value = new Date(`${date}T${time}:00-03:00`);
  return Number.isFinite(+value) ? value.toISOString() : "";
}

export function localDateTimeParts(value: string | null | undefined): { date: string; time: string } {
  if (!value || !Number.isFinite(+new Date(value))) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

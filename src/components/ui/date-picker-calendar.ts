// Calendar arithmetic uses UTC dates only; a browser's time zone cannot change
// the YYYY-MM-DD value sent to the application.
export function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function calendarValue(date: Date): string {
  if (date.getUTCFullYear() < 1) return "0001-01-01";
  if (date.getUTCFullYear() > 9999) return "9999-12-31";
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function calendarDay(value: string, delta: number): string {
  const date = calendarDate(value)!;
  date.setUTCDate(date.getUTCDate() + delta);
  return calendarValue(date);
}

export function calendarMonth(value: string, delta: number): string {
  const date = calendarDate(value)!;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return calendarValue(date);
}

export function calendarClamp(value: string, min?: string, max?: string): string {
  const lower = min && calendarDate(min) ? min : "0001-01-01";
  const upper = max && calendarDate(max) ? max : "9999-12-31";
  return value < lower ? lower : value > upper ? upper : value;
}

export function calendarDays(month: string): (string | null)[][] {
  const first = calendarDate(`${month.slice(0, 7)}-01`)!;
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const offset = first.getUTCDay();
  const count = last.getUTCDate();
  const cells = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day < 1 || day > count ? null : `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;
  });
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

function limit(value: string | undefined, fallback: number, maximum: number) {
  if (value === "0") return 0;
  if (!value || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return number >= 1 && number <= maximum ? number : fallback;
}
// Server-controlled limits prevent one account from occupying the whole agenda.
// Zero explicitly disables a limit; malformed configuration uses safe defaults.
export function clientBookingPolicy() {
  return {
    activeLimit: limit(process.env.MAX_CLIENT_ACTIVE_BOOKINGS, 5, 50),
    advanceDays: limit(process.env.MAX_CLIENT_BOOKING_ADVANCE_DAYS, 90, 365),
  };
}

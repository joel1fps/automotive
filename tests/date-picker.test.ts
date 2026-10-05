import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarClamp, calendarDate, calendarDay, calendarDays, calendarMonth, calendarValue } from "../src/components/ui/date-picker-calendar";

test("calendar accepts real ISO dates without rolling over invalid dates", () => {
  for (const invalid of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-02", "2026-01-00", "2026-1-2", "", "not-a-date"])
    assert.equal(calendarDate(invalid), null, invalid);
  assert.equal(calendarValue(calendarDate("2028-02-29")!), "2028-02-29");
  assert.equal(calendarValue(calendarDate("0001-01-01")!), "0001-01-01");
  assert.equal(calendarDate("2026-10-04")!.getUTCHours(), 12);
});

test("calendar navigation preserves valid days across month, leap year and year boundaries", () => {
  assert.equal(calendarMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(calendarMonth("2028-01-31", 1), "2028-02-29");
  assert.equal(calendarMonth("2028-02-29", 12), "2029-02-28");
  assert.equal(calendarMonth("2026-01-15", -1), "2025-12-15");
  assert.equal(calendarDay("2026-12-31", 1), "2027-01-01");
  assert.equal(calendarDay("2026-03-01", -1), "2026-02-28");
  assert.equal(calendarDay("0001-01-01", -7), "0001-01-01");
  assert.equal(calendarMonth("9999-12-31", 12), "9999-12-31");
});

test("calendar grids start with Sunday and show only real dates of the displayed month", () => {
  const october = calendarDays("2026-10-01");
  assert.deepEqual(october[0], [null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.equal(october.length, 5);
  assert.equal(october.flat().filter(Boolean).length, 31);
  assert.deepEqual(calendarDays("2026-02-01")[0], ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-07"]);
  assert.equal(calendarDays("2026-02-01").length, 4);
  assert.equal(calendarDays("2026-08-01").length, 6);
});

test("keyboard navigation clamps at allowed limits without changing calendar dates for local time zones", () => {
  const min = "2026-10-04", max = "2026-11-03";
  assert.equal(calendarClamp(calendarDay(min, -1), min, max), min);
  assert.equal(calendarClamp(calendarMonth(min, 1), min, max), max);
  assert.equal(calendarClamp("2026-10-31", min, max), "2026-10-31");
  const before = process.env.TZ;
  try {
    for (const zone of ["America/Fortaleza", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      process.env.TZ = zone;
      assert.equal(calendarDay("2026-03-08", 1), "2026-03-09");
      assert.equal(calendarMonth("2026-03-31", -1), "2026-02-28");
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

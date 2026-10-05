import { test } from "node:test";
import assert from "node:assert/strict";
import { localDateTimeParts, localDateTimeToIso } from "../src/lib/local-date-time";

test("free scheduling converts any Fortaleza minute to ISO, including overnight UTC rollover", () => {
  assert.equal(localDateTimeToIso("2026-10-06", "19:07"), "2026-10-06T22:07:00.000Z");
  assert.equal(localDateTimeToIso("2026-10-06", "23:59"), "2026-10-07T02:59:00.000Z");
  assert.equal(localDateTimeToIso("2026-10-06", "00:01"), "2026-10-06T03:01:00.000Z");
  assert.deepEqual(localDateTimeParts("2026-10-07T02:59:00.000Z"), { date: "2026-10-06", time: "23:59" });
  assert.deepEqual(localDateTimeParts("2026-10-06T03:00:00.000Z"), { date: "2026-10-06", time: "00:00" });
});

test("partial date/time inputs and rolled-over calendar dates do not produce schedule timestamps", () => {
  for (const [date, time] of [["", "19:07"], ["2026-10-06", ""], ["2026-02-29", "19:07"], ["2026-10-06", "24:00"], ["2026-10-06", "19:60"], ["2026-10-06", "9:00"], ["2026-10-06", "19:07:12"]])
    assert.equal(localDateTimeToIso(date, time), "", `${date} ${time}`);
  assert.deepEqual(localDateTimeParts("invalid"), { date: "", time: "" });
  assert.deepEqual(localDateTimeParts(null), { date: "", time: "" });
});

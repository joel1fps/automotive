"use client";

import { DatePicker } from "./date-picker";

export function DateTimePicker({ date, time, onDateChange, onTimeChange, dateLabel, timeLabel, minDate, required, disabled }: {
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  dateLabel: string;
  timeLabel: string;
  minDate?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return <>
    <label>{dateLabel}<DatePicker ariaLabel={dateLabel} value={date} onChange={onDateChange} min={minDate} required={required} disabled={disabled} /></label>
    <label>{timeLabel}<input type="time" step="60" aria-label={timeLabel} value={time} required={required} disabled={disabled} onChange={(event) => onTimeChange(event.target.value)} /></label>
  </>;
}

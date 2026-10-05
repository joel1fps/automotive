"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import { calendarClamp, calendarDate, calendarDay, calendarDays, calendarMonth } from "./date-picker-calendar";
import styles from "./date-picker.module.css";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
};

const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekdayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const dateLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "full" });
const monthLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
const todayValue = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function DatePicker({ value, onChange, id, name, min, max, required, disabled, ariaLabel = "Data" }: DatePickerProps) {
  const generatedId = useId();
  const inputId = id || `date-${generatedId}`;
  const titleId = `${inputId}-month`;
  const popupId = `${inputId}-calendar`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("2000-01-01");
  const [focusedDay, setFocusedDay] = useState("2000-01-01");
  const [position, setPosition] = useState({ position: "fixed" as "fixed" | "absolute", top: 0, left: 0, width: 280, maxHeight: 340 });
  const selected = calendarDate(value);
  const display = selected ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "Selecionar data";

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = () => {
    if (disabled) return;
    const day = calendarClamp(selected ? value : todayValue(), min, max);
    setMonth(`${day.slice(0, 7)}-01`);
    setFocusedDay(day);
    // A portal inside the enclosing Radix dialog remains in its focus boundary.
    setPortal(trigger.current?.closest('[role="dialog"]') || document.body);
    setOpen(true);
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const nativePopover = typeof popup.current?.showPopover === "function";
    if (nativePopover && !popup.current!.matches(":popover-open")) popup.current!.showPopover();
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      let viewportLeft = viewport?.offsetLeft || 0;
      let viewportTop = viewport?.offsetTop || 0;
      let viewportWidth = viewport?.width || window.innerWidth;
      let viewportHeight = viewport?.height || window.innerHeight;
      const enclosingDialog = !nativePopover && portal instanceof HTMLElement && portal !== document.body ? portal : null;
      const dialogRect = enclosingDialog?.getBoundingClientRect();
      if (dialogRect) {
        // Legacy browsers without popovers keep the entire popup in the visible
        // area of the enclosing dialog, using coordinates in its scroll box.
        const right = Math.min(viewportLeft + viewportWidth, dialogRect.right);
        const bottom = Math.min(viewportTop + viewportHeight, dialogRect.bottom);
        viewportLeft = Math.max(viewportLeft, dialogRect.left);
        viewportTop = Math.max(viewportTop, dialogRect.top);
        viewportWidth = right - viewportLeft;
        viewportHeight = bottom - viewportTop;
      }
      const width = Math.min(280, viewportWidth - 24);
      const left = Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + viewportWidth - width - 12));
      // Keep the complete month visible whenever the viewport can hold it.
      // If neither side of the anchor has enough room, overlap the anchor and
      // clamp the popup to the viewport rather than shrinking it to one row.
      const maxHeight = Math.max(1, viewportHeight - 24);
      const desiredHeight = Math.min(popup.current?.scrollHeight || 320, maxHeight);
      const below = viewportTop + viewportHeight - rect.bottom - 8;
      const above = rect.top - viewportTop - 8;
      const preferAbove = below < desiredHeight && above > below;
      const top = preferAbove
        ? Math.max(viewportTop + 12, Math.min(rect.top - Math.min(desiredHeight, maxHeight) - 8, viewportTop + viewportHeight - Math.min(desiredHeight, maxHeight) - 12))
        : Math.max(viewportTop + 12, Math.min(rect.bottom + 8, viewportTop + viewportHeight - Math.min(desiredHeight, maxHeight) - 12));
      setPosition({ position: enclosingDialog ? "absolute" : "fixed",
        top: top - (dialogRect?.top || 0) + (enclosingDialog?.scrollTop || 0) - (enclosingDialog?.clientTop || 0),
        left: left - (dialogRect?.left || 0) + (enclosingDialog?.scrollLeft || 0) - (enclosingDialog?.clientLeft || 0),
        width, maxHeight });
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, month, portal]);

  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus({ preventScroll: true });
  }, [open, focusedDay, month]);

  const choose = (day: string) => {
    if (calendarClamp(day, min, max) !== day) return;
    onChange(day);
    close(true);
  };
  const moveFocus = (day: string) => {
    const next = calendarClamp(day, min, max);
    setFocusedDay(next);
    setMonth(`${next.slice(0, 7)}-01`);
  };
  const dayKey = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string | undefined;
    const weekday = calendarDate(day)!.getUTCDay();
    if (event.key === "ArrowLeft") next = calendarDay(day, -1);
    if (event.key === "ArrowRight") next = calendarDay(day, 1);
    if (event.key === "ArrowUp") next = calendarDay(day, -7);
    if (event.key === "ArrowDown") next = calendarDay(day, 7);
    if (event.key === "Home") next = calendarDay(day, -weekday);
    if (event.key === "End") next = calendarDay(day, 6 - weekday);
    if (event.key === "PageUp") next = calendarMonth(day, event.shiftKey ? -12 : -1);
    if (event.key === "PageDown") next = calendarMonth(day, event.shiftKey ? 12 : 1);
    if (next) {
      event.preventDefault();
      moveFocus(next);
    }
  };
  const previous = calendarMonth(month, -1);
  const next = calendarMonth(month, 1);
  const previousLast = calendarDay(month, -1);
  const currentToday = open ? todayValue() : "";

  return <div className={styles.root}>
    <button ref={trigger} id={inputId} type="button" className={styles.trigger} disabled={disabled}
      aria-label={`${ariaLabel}: ${display}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); show(); }
        if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
      }}>
      <span>{display}</span><CalendarDays size={17} aria-hidden="true" />
    </button>
    {(name || required) && <input className={styles.validationInput} type="text" tabIndex={-1} aria-hidden="true"
      name={name} value={value} required={required} disabled={disabled} onChange={() => {}}
      onInvalid={(event) => { event.preventDefault(); show(); trigger.current?.focus(); }} />}
    {open && portal && createPortal(<div ref={popup} id={popupId} popover="manual" role="dialog" aria-modal="false" aria-label={`Calendário de ${ariaLabel}`}
      className={styles.popup} style={position} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      }}>
      <div className={styles.header}>
        <button type="button" className={styles.monthArrow} aria-label="Mês anterior" disabled={previous.slice(0, 7) === month.slice(0, 7) || !!(min && previousLast < min)} onClick={() => moveFocus(calendarMonth(focusedDay, -1))}><ArrowLeft size={17} aria-hidden="true" /></button>
        <h2 id={titleId} className={styles.monthTitle} aria-live="polite">{monthLabel.format(calendarDate(month)!).replace(" de ", " ")}</h2>
        <button type="button" className={styles.monthArrow} aria-label="Próximo mês" disabled={next.slice(0, 7) === month.slice(0, 7) || !!(max && next > max)} onClick={() => moveFocus(calendarMonth(focusedDay, 1))}><ArrowRight size={17} aria-hidden="true" /></button>
      </div>
      <div role="grid" aria-labelledby={titleId} className={styles.grid}>
        <div role="row" className={styles.week}>
          {weekdays.map((day, index) => <span role="columnheader" aria-label={weekdayNames[index]} className={styles.weekday} key={day}>{day}</span>)}
        </div>
        {calendarDays(month).map((week, index) => <div role="row" className={styles.week} key={index}>
          {week.map((day, column) => <div role="gridcell" className={styles.cell} aria-selected={day ? day === value : undefined} key={day || `blank-${column}`}>
            {day && <button type="button" data-date={day} className={styles.day} aria-label={dateLabel.format(calendarDate(day)!)}
              aria-current={day === currentToday ? "date" : undefined} tabIndex={day === focusedDay ? 0 : -1}
              disabled={calendarClamp(day, min, max) !== day} onClick={() => choose(day)} onKeyDown={(event) => dayKey(event, day)}
              onFocus={() => setFocusedDay(day)}>{Number(day.slice(8, 10))}</button>}
          </div>)}
        </div>)}
      </div>
      <p className={styles.srOnly}>Use as setas para navegar entre dias. Page Up e Page Down mudam o mês. Enter seleciona; Escape fecha.</p>
    </div>, portal)}
  </div>;
}

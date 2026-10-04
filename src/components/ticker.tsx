"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useAnimationFrame, useInView, useMotionValue, useReducedMotion, wrap } from "motion/react";
import "./ticker.css";

export type TickerItem = { id: string; content: ReactNode };
export type TickerProps = {
  items: TickerItem[];
  velocity?: number;
  direction?: "left" | "right";
  gap?: number;
  hoverSlowdown?: number;
  label?: string;
};

export function Ticker({ items, velocity = 50, direction = "left", gap = 24, hoverSlowdown = 0, label = "Serviços em destaque" }: TickerProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const cycle = useRef(0);
  const speed = useRef(1);
  const x = useMotionValue(0);
  const inView = useInView(viewport);
  const reducedPreference = useReducedMotion();
  // Keep the first client render identical to the server-rendered markup.
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(!!reducedPreference), [reducedPreference]);
  const [copies, setCopies] = useState(2);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const staticMode = !!reduced || focused || paused;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 24;
  const slowdown = Number.isFinite(hoverSlowdown) ? Math.min(1, Math.max(0, hoverSlowdown)) : 0;

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useLayoutEffect(() => {
    if (!viewport.current || !group.current) return;
    const measure = () => {
      const width = group.current?.getBoundingClientRect().width || 0;
      if (!width) return;
      const progress = cycle.current ? -x.get() / cycle.current : 0;
      cycle.current = width;
      x.set(-progress * width);
      setCopies(Math.max(2, Math.ceil((viewport.current?.clientWidth || 0) / width) + 2));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    observer.observe(group.current);
    return () => observer.disconnect();
  }, [items.length, spacing, x, staticMode]);

  // Visual copies keep mouse/touch links, but never duplicate keyboard stops.
  // Focusing an original switches to a stationary, horizontally scrollable list.
  useEffect(() => {
    track.current?.querySelectorAll<HTMLElement>('[data-copy="true"] a, [data-copy="true"] button, [data-copy="true"] input, [data-copy="true"] [tabindex]')
      .forEach(element => element.tabIndex = -1);
  }, [copies, items, staticMode]);

  useAnimationFrame((_, delta) => {
    if (!inView || !visible || staticMode || !cycle.current) return;
    const seconds = Math.min(delta, 64) / 1000;
    const target = pointerInside ? slowdown : 1;
    speed.current += (target - speed.current) * (1 - Math.exp(-seconds / 0.18));
    if (Math.abs(speed.current - target) < 0.001) speed.current = target;
    const pixels = (Number.isFinite(velocity) ? Math.max(0, velocity) : 50) * seconds * speed.current;
    x.set(wrap(-cycle.current, 0, x.get() + pixels * (direction === "left" ? -1 : 1)));
  });

  if (!items.length) return null;
  return <section className="ticker" aria-label={label} data-static={staticMode}>
    {!reduced && <button className="ticker-toggle" type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>
      {paused ? "Retomar movimento" : "Pausar movimento"}
    </button>}
    <div ref={viewport} className="ticker-viewport"
      onPointerEnter={event => { if (event.pointerType === "mouse") setPointerInside(true); }}
      onPointerLeave={() => { setPointerInside(false); setHovered(null); }}
      onFocusCapture={event => { if (event.target.matches(":focus-visible")) setFocused(true); }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <motion.div ref={track} className="ticker-track" style={{ x: staticMode ? 0 : x }}>
        {Array.from({ length: staticMode ? 1 : copies }, (_, copy) => <div
          ref={copy === 0 ? group : undefined} key={copy} className="ticker-group"
          role="list" aria-hidden={copy > 0 ? true : undefined} data-copy={copy > 0}
          style={{ gap: spacing, paddingRight: spacing }}>
          {items.map(item => <motion.div key={item.id} role="listitem" className="ticker-item"
            initial={false}
            variants={{ normal: { scale: 1, opacity: 1 }, dimmed: { scale: 1, opacity: 0.58 }, hover: { scale: reduced ? 1 : 1.08, opacity: 1 } }}
            animate={hovered && hovered !== item.id ? "dimmed" : "normal"}
            whileHover="hover" transition={{ duration: reduced ? 0 : 0.22 }}
            onHoverStart={() => setHovered(item.id)} onHoverEnd={() => setHovered(null)}>
            {item.content}
          </motion.div>)}
        </div>)}
      </motion.div>
    </div>
  </section>;
}

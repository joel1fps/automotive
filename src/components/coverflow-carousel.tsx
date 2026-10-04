"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import "./coverflow-carousel.css";

export type CoverflowItem = { id: string; title: string; content: ReactNode };
export type CoverflowCarouselProps = { items: CoverflowItem[]; itemWidth?: number; gap?: number; maxRotate?: number; sideScale?: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function Card({ item, index, position, width, step, maxRotate, sideScale, reduced, active, select }: {
  item: CoverflowItem; index: number; position: MotionValue<number>; width: number; step: number;
  maxRotate: number; sideScale: number; reduced: boolean; active: boolean; select: () => void;
}) {
  const offset = useTransform(position, value => index + value / step);
  const rotateY = useTransform(offset, [-1, 0, 1], [maxRotate, 0, -maxRotate]);
  const scale = useTransform(offset, [-2, -1, 0, 1, 2], [sideScale * .9, sideScale, 1, sideScale, sideScale * .9]);
  const x = useTransform(offset, value => index * step - value * step * .32);
  const opacity = useTransform(offset, [-3, -1, 0, 1, 3], [.25, .75, 1, .75, .25]);
  const zIndex = useTransform(offset, value => 100 - Math.min(99, Math.round(Math.abs(value) * 10)));
  return <motion.button type="button" className="coverflow-card" aria-label={`Centralizar ${item.title}`} aria-pressed={active}
    tabIndex={active ? 0 : -1} onClick={select} style={{ width, marginLeft: -width / 2, x, rotateY: reduced ? 0 : rotateY, scale, opacity, zIndex }}>
    <span className="coverflow-art">{item.content}</span>
    <span className="coverflow-title">{item.title}</span>
  </motion.button>;
}

export function CoverflowCarousel({ items, itemWidth = 360, gap = 24, maxRotate = 45, sideScale = .8 }: CoverflowCarouselProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const position = useMotionValue(0);
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(itemWidth);
  const [active, setActive] = useState(0);
  const selected = useRef(0);
  const dragged = useRef(false);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const step = Math.max(1, width + Math.max(0, gap));
  const previousStep = useRef(step);
  const select = (index: number, instant = false) => {
    const target = clamp(index, 0, Math.max(0, items.length - 1));
    selected.current = target;
    setActive(target);
    animation.current?.stop();
    if (reduced || instant) position.set(-target * step);
    else animation.current = animate(position, -target * step, { type: "spring", stiffness: 300, damping: 30 });
  };
  useLayoutEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.min(itemWidth, entry.contentRect.width * .72))));
    observer.observe(viewport.current);
    return () => { observer.disconnect(); animation.current?.stop(); };
  }, [itemWidth]);
  useLayoutEffect(() => {
    animation.current?.stop();
    selected.current = clamp(selected.current, 0, Math.max(0, items.length - 1));
    setActive(selected.current);
    position.set(-selected.current * step);
    previousStep.current = step;
  }, [step, items.length, position]);
  if (!items.length) return null;
  return <div className="coverflow" role="region" aria-roledescription="carrossel" aria-label="Cada detalhe, um serviço"
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      select(event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : selected.current + (event.key === "ArrowRight" ? 1 : -1));
    }}>
    <div ref={viewport} className="coverflow-viewport" tabIndex={0} aria-label="Arraste ou use as setas para explorar os serviços"
      style={{ height: width + 100 }}
      onPointerDown={event => { dragged.current = false; animation.current?.stop(); controls.start(event); }}>
      <motion.div className="coverflow-track" style={{ x: position }} drag="x" dragControls={controls} dragListener={false}
        dragConstraints={{ left: -(items.length - 1) * step, right: 0 }} dragElastic={.08} dragMomentum={false}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          // Velocity projection supplies inertia; a single spring snaps to a whole item.
          const projected = position.get() + (reduced ? 0 : clamp(info.velocity.x * .18, -step * 2, step * 2));
          select(Math.round(-projected / step));
        }}>
        {items.map((item, index) => <Card key={item.id} item={item} index={index} position={position} width={width} step={step}
          maxRotate={clamp(maxRotate, 0, 80)} sideScale={clamp(sideScale, .1, 1)} reduced={!!reduced}
          active={active === index} select={() => { if (!dragged.current) select(index); }} />)}
      </motion.div>
    </div>
    <div className="coverflow-navigation">
      <button type="button" aria-label="Serviço anterior" disabled={active === 0} onClick={() => select(selected.current - 1)}>←</button>
      <p aria-live="polite" aria-atomic="true">{active + 1} / {items.length} — {items[active]?.title}</p>
      <button type="button" aria-label="Próximo serviço" disabled={active === items.length - 1} onClick={() => select(selected.current + 1)}>→</button>
    </div>
  </div>;
}

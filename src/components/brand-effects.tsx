"use client";
import { useEffect, useRef } from "react";
import {
  animate,
  m,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { logoPath } from "@/lib/logo-path";
export function LogoTrace() {
  const reduced = useReducedMotion();
  return (
    <m.svg className="logo-trace" viewBox="375 608 812 163" aria-hidden="true">
      <m.path
        transform="matrix(-.29266939 0 0 .29147983 1187.15503 608.56036)"
        d={logoPath}
        fill="none"
        stroke="#61cce4"
        strokeWidth="4"
        initial={{ pathLength: reduced ? 1 : 0, opacity: 0.25 }}
        animate={{ pathLength: 1, opacity: 0.25 }}
        transition={{ duration: 1.4, ease: "easeInOut" }}
      />
    </m.svg>
  );
}
export function PriceAmount({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const counter = useMotionValue(value);
  const formatted = useTransform(counter, (v) =>
    v.toFixed(2).replace(".", ","),
  );
  useEffect(() => {
    if (!inView || reduced) {
      counter.set(value);
      return;
    }
    counter.set(0);
    const controls = animate(counter, value, {
      duration: 0.7,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [value, inView, reduced, counter]);
  return (
    <m.strong ref={ref} aria-label={`${value.toFixed(2)} reais`}>
      {formatted}
    </m.strong>
  );
}
export function MagneticLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const x = useSpring(0, { stiffness: 200, damping: 20 });
  const y = useSpring(0, { stiffness: 200, damping: 20 });
  return (
    <m.a
      href={href}
      className="button primary"
      style={{ x, y }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.1);
        y.set((e.clientY - r.top - r.height / 2) * 0.1);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </m.a>
  );
}

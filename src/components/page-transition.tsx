"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAnimate } from "motion/react";

type TransitionContext = { go: (path: string) => Promise<void>; isPending: boolean };
const Context = createContext<TransitionContext | null>(null);
const ease = [0.76, 0, 0.24, 1] as const;

export function usePageTransition() {
  const context = useContext(Context);
  if (!context) throw new Error("usePageTransition requires PageTransitionProvider");
  return context;
}

export function PageTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [scope, animate] = useAnimate();
  const [phase, setPhase] = useState("idle");
  const [routePending, startTransition] = useTransition();
  const lock = useRef(false);
  const navigation = useRef<{ resolve: () => void; started: boolean; from: string } | null>(null);
  const isPending = phase !== "idle";

  // Next's push is not a Promise. Resolve only once its React transition commits,
  // including redirects (e.g. /cliente -> /entrar), not after a guessed delay.
  useEffect(() => {
    const current = navigation.current;
    if (!current) return;
    if (routePending) current.started = true;
    else if (current.started || pathname !== current.from) {
      navigation.current = null;
      current.resolve();
    }
  }, [routePending, pathname]);

  const go = async (path: string) => {
    if (lock.current) return;
    const target = new URL(path, window.location.href);
    if (target.origin !== window.location.origin || !["http:", "https:"].includes(target.protocol)) return;
    const href = target.pathname + target.search + target.hash;
    if (target.pathname === window.location.pathname && target.search === window.location.search) {
      if (target.hash) router.push(href);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(href);
      return;
    }
    lock.current = true;
    setPhase("covering");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.all([
        animate(".curtain-door-left", { transform: "translateX(0%)" }, { duration: 0.4, ease }),
        animate(".curtain-door-right", { transform: "translateX(0%)" }, { duration: 0.4, ease }),
      ]);
      setPhase("covered");
      await new Promise<void>((resolve) => {
        navigation.current = { resolve, started: false, from: pathname };
        // Keep the cover up if a stalled connection requires a full navigation.
        timeout = setTimeout(() => window.location.assign(href), 20000);
        startTransition(() => router.push(href));
      });
      clearTimeout(timeout);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setPhase("revealing");
      await Promise.all([
        animate(".curtain-door-left", { transform: "translateX(-100%)" }, { duration: 0.5, ease }),
        animate(".curtain-door-right", { transform: "translateX(100%)" }, { duration: 0.5, ease }),
      ]);
    } finally {
      clearTimeout(timeout);
      document.body.style.overflow = previousOverflow;
      lock.current = false;
      setPhase("idle");
    }
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (lock.current) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/api/") || /\.[a-z0-9]+$/i.test(url.pathname)) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    event.preventDefault();
    void go(url.pathname + url.search + url.hash);
  };

  return <Context.Provider value={{ go, isPending }}>
    <div className="page-transition-content" onClickCapture={onClickCapture} inert={isPending} aria-busy={isPending}>{children}</div>
    <div ref={scope} className="curtain-overlay" data-phase={phase} aria-hidden="true">
      <div className="curtain-door curtain-door-left" />
      <div className="curtain-door curtain-door-right" />
    </div>
  </Context.Provider>;
}

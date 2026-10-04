"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { CoverflowCarousel } from "./coverflow-carousel";
import { m, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, animate } from "motion/react";
import { logoPath } from "@/lib/logo-path";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";

/* Abertura a cada carregamento completo; respeita movimento reduzido. */
export function Loader() {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(true);
  const [pct, setPct] = useState(0);
  const [introDuration, setIntroDuration] = useState(1);
  useEffect(() => {
    if (reduced) { setShow(false); return; }
    const compact = window.matchMedia("(max-width: 767px)").matches;
    const duration = compact ? 0.2 : 1;
    setIntroDuration(duration);
    const c = animate(0, 100, { duration, ease: "easeInOut", onUpdate: (v) => setPct(Math.round(v)) });
    const t = setTimeout(() => {
      setShow(false);
    }, compact ? 450 : 1600);
    return () => { c.stop(); clearTimeout(t); };
  }, [reduced]);
  if (!show) return null;
  return (
    <div className="loader" role="status" aria-label="Abertura Automotive">
      <m.div className="loader-door left" exit={{ x: "-100%" }} />
      <div className="loader-center">
        <svg viewBox="375 608 812 163" className="loader-logo" aria-hidden="true">
          <m.path transform="matrix(-.29266939 0 0 .29147983 1187.15503 608.56036)" d={logoPath} fill="rgba(97,204,228,.12)" stroke="#61cce4" strokeWidth="5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: introDuration, ease: "easeInOut" }} />
        </svg>
        <Image src="/brand/logo-white.webp" alt="Automotive" width={260} height={116} sizes="260px" loading="eager" fetchPriority="low" className="loader-img" />
        <div className="loader-bar"><m.span style={{ width: `${pct}%` }} /></div>
        <p className="loader-pct" aria-hidden="true">{pct}%</p>
      </div>
      <m.div className="loader-door right" />
    </div>
  );
}

/* Texto que revela palavra por palavra (estilo React Bits SplitText). */
export function SplitText({ text, className }: { text: string; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10%" });
  return (
    <span ref={ref} className={className}>
      <span className="sr-only">{text}</span>
      {text.split(" ").map((w, i) => (
        <m.span key={i} aria-hidden="true" className="split-word" initial={reduced ? false : { y: "110%", opacity: 0, filter: "blur(8px)" }} animate={inView || reduced ? { y: 0, opacity: 1, filter: "blur(0px)" } : {}} transition={reduced ? { duration: 0 } : { delay: i * 0.07, type: "spring", stiffness: 120, damping: 16 }}>
          {w}&nbsp;
        </m.span>
      ))}
    </span>
  );
}

/* Faixa infinita de serviços. */
export function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  const row = [...items, ...items];
  return (
    <div className="marquee" aria-hidden="true">
      <div className={`marquee-track${reverse ? " rev" : ""}`}>
        {row.map((t, i) => (<span key={i}>{t}<i>•</i></span>))}
      </div>
    </div>
  );
}

/* Cartão 3D com spotlight que segue o cursor. */
export function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 });
  const [pos, setPos] = useState({ x: 50, y: 50 });
  return (
    <m.div
      className={`tilt ${className}`}
      style={{ rotateX: reduced ? 0 : rx, rotateY: reduced ? 0 : ry, transformPerspective: 900, ["--mx" as string]: `${pos.x}%`, ["--my" as string]: `${pos.y}%` }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        ry.set((x - 0.5) * 14); rx.set((0.5 - y) * 14); setPos({ x: x * 100, y: y * 100 });
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
    >{children}</m.div>
  );
}

/* Fundo aurora animado. */
export function Aurora() {
  return (<div className="aurora" aria-hidden="true"><i /><i /><i /></div>);
}

/* Vídeo vertical que toca mudo quando entra na tela. */
function Reel({ n, title, tag }: { n: string; title: string; tag: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const inView = useInView(box, { margin: "-25%" });
  const nearView = useInView(box, { margin: "200px" });
  const [playing, setPlaying] = useState(false);
  const [manualPlay, setManualPlay] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    const wantsPlay = inView && !pausedByUser && (!reduced || manualPlay);
    if (wantsPlay) {
      if (!shouldLoad) setShouldLoad(true);
      else v.play().catch(() => setPlaying(false));
    } else v.pause();
  }, [inView, reduced, manualPlay, pausedByUser, shouldLoad]);
  const togglePlayback = () => {
    if (playing) { setPausedByUser(true); setManualPlay(false); ref.current?.pause(); }
    else { setPausedByUser(false); setManualPlay(true); setShouldLoad(true); }
  };
  return (
    <TiltCard className="reel">
      <div ref={box} className="reel-box">
        <video ref={ref} src={shouldLoad ? `/media/video-${n}.mp4` : undefined} poster={nearView || shouldLoad ? `/media/video-${n}.jpg` : undefined} aria-label={title} muted loop playsInline preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} />
        <span className="reel-tag">{tag}</span>
        <button type="button" className="reel-play" aria-label={`${playing ? "Pausar" : "Reproduzir"} vídeo: ${title}`} onClick={togglePlayback} disabled={failed}>{playing ? <Pause size={18} /> : <Play size={18} />}<span>{failed ? "Vídeo indisponível" : playing ? "Pausar" : "Reproduzir"}</span></button>
      </div>
      <h3 className="reel-title">{title}</h3>
    </TiltCard>
  );
}
export function Reels() {
  const reduced = useReducedMotion();
  const reel = [
    ["01", "Devolvemos o brilho ao seu carro", "Conheça a Automotive"],
    ["04", "Limpeza e hidratação de banco de couro", "Antes x depois"],
    ["05", "Higienização interna completa", "Antes x depois"],
    ["02", "Película e proteção", "Aplicação"],
    ["06", "Oxi-sanitização com ozônio", "Sanitização"],
  ];
  const ref = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [12, -12]);
  const browse = (direction: number) => viewport.current?.scrollBy({ left: direction * 322, behavior: reduced ? "instant" : "smooth" });
  return (
    <section className="section reels-section" id="videos" ref={ref}>
      <Aurora />
      <div className="container">
        <p className="eyebrow">Veja em movimento</p>
        <h2><SplitText text="O trabalho em ação." /></h2>
        <div className="reel-navigation"><p>Vídeos da Automotive. Deslize para ver todos.</p><div><button type="button" className="reel-nav" aria-label="Ver vídeos anteriores" onClick={() => browse(-1)}><ArrowLeft /></button><button type="button" className="reel-nav" aria-label="Ver próximos vídeos" onClick={() => browse(1)}><ArrowRight /></button></div></div>
      </div>
      <div className="reels-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Vídeos da Automotive" onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); browse(e.key === "ArrowLeft" ? -1 : 1); } }}>
      <m.div className="reels" style={{ y: reduced ? 0 : y }}>
        {reel.map(([n, t, g]) => (<Reel key={n} n={n} title={t} tag={g} />))}
      </m.div>
      </div>
    </section>
  );
}

/* Artes da marca em cartões 3D. */
export function Showcase({ services }: { services: {slug:string;name:string;imageUrl?:string;description:string}[] }) {
  const art: Record<string,string> = {"extra-4":"13","oxi-sanitizacao":"23","extra-0":"07",moto:"16",completa:"14"};
  return (
    <section className="section container" id="destaques">
      <p className="eyebrow">Nossos cuidados</p>
      <h2><SplitText text="Cada detalhe, um serviço." /></h2>
      <CoverflowCarousel itemWidth={360} gap={24} maxRotate={45} sideScale={0.8}
        items={services.map(service => ({
          id: service.slug,
          title: service.name,
          content: <img
            src={service.imageUrl || (art[service.slug] ? `/gallery/foto-${art[service.slug]}.webp` : "/brand/logo-white.webp")}
            alt={service.name}
            draggable={false}
            loading="lazy"
            onError={event => {
              const image = event.currentTarget;
              if (image.getAttribute("src") !== "/brand/logo-white.webp") {
                image.src = "/brand/logo-white.webp";
                image.style.objectFit = "contain";
              }
            }}
            style={{ width: "100%", height: "100%", objectFit: service.imageUrl ? "cover" : "contain" }}
          />,
        }))} />
    </section>
  );
}

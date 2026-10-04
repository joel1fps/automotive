"use client";
import Link from "next/link";
import { Ticker } from "./ticker";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  m,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import {
  Menu,
  X,
  Droplets,
  ShieldCheck,
  Clock3,
  CalendarDays,
  Gift,
  MapPin,
  Instagram,
  MessageCircle,
  Check,
  Plus,
  Minus,
} from "lucide-react";
import {
  initialServices,
  LEGAL_NOTICE,
  money,
  vehicleLabels,
  type VehicleType,
} from "@/lib/catalog";
import { Button } from "./ui/button";
import { Testimonials } from "./testimonials";
import { Marquee, Reels, Showcase } from "./fx";
import { businessContact, locationUrl, whatsappUrl } from "@/lib/site-config";
import {
  LogoTrace,
  MagneticLink,
  PriceAmount,
} from "./brand-effects";
type PublicService = {
  _id?: string;
  name: string;
  slug: string;
  category: string;
  prices: { small: number; suv: number; pickup: number; moto?: number } | null;
  imageUrl?: string;
  vehicleTypes?: string[];
  startingPrice?: number;
  description: string;
  active: boolean;
};
type GalleryItem = {
  layout?: "pair";
  before: string;
  after: string;
  title: string;
  description: string;
};
const nav = [
  { href: "/servicos", label: "Serviços" },
  { href: "/galeria", label: "Antes e depois" },
  { href: "/contato", label: "Contato" },
];
export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link prefetch={false}
      href="/"
      className={`brand ${footer ? "brand-footer" : ""}`}
      aria-label="Automotive — início"
    >
      <Image
        src="/brand/logo-white.webp"
        alt="Automotive — Lava a Jato e Serviços"
        width={700}
        height={313}
        sizes="(max-width: 620px) 160px, 207px"
        loading={footer ? "lazy" : "eager"}
      />
    </Link>
  );
}
function Reveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-30px" }}
      transition={{ duration: 0.55 }}
    >
      {children}
    </m.div>
  );
}
export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  return (
    <>
      <m.div className="scroll-progress" style={{ scaleX: scrollYProgress }} />
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label="Menu principal">
            {nav.map((n) => (
              <Link prefetch={false} key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
            <Link prefetch={false} href="/cliente" className="account-link">
              Minha conta
            </Link>
          </nav>
          <Link prefetch={false} className="button primary header-cta" href="/cliente/agendar">
            Agendar agora
          </Link>
          <Button
            className="mobile-toggle"
            variant="secondary"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
        <AnimatePresence>
          {open && (
            <m.nav
              className="mobile-nav"
              aria-label="Menu mobile"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              {[
                ...nav,
                { href: "/cliente", label: "Minha conta" },
                { href: "/cliente/agendar", label: "Agendar agora" },
              ].map((n, i) => (
                <m.div
                  key={n.href}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link prefetch={false} href={n.href} onClick={() => setOpen(false)}>
                    {n.label}
                  </Link>
                </m.div>
              ))}
            </m.nav>
          )}
        </AnimatePresence>
      </header>
    </>
  );
}
export function PublicFooter() {
  return (
    <footer>
      <div className="container footer-grid">
        <Brand footer />
        <div>
          <p className="eyebrow">O cuidado continua</p>
          <Link prefetch={false} href="/servicos">Serviços e preços</Link>
          <Link prefetch={false} href="/cliente/fidelidade">Fidelidade</Link>
          <Link prefetch={false} href="/privacidade">Política de privacidade</Link>
        </div>
        <div>
          <p className="eyebrow">Seu próximo cuidado</p>
          <MagneticLink href="/cliente/agendar">
            Solicitar agendamento
          </MagneticLink>
        </div>
      </div>
      <div className="container footer-bottom">
        <p>{LEGAL_NOTICE}</p>
        <span>© {new Date().getFullYear()} Automotive</span>
      </div>
    </footer>
  );
}
function PriceTable({ services }: { services: PublicService[] }) {
  const [vehicle, setVehicle] = useState<VehicleType>("small");
  return (
    <section id="precos" className="section container">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Transparência desde o início</p>
          <h2>
            Cuidado no detalhe.
            <br />
            <span>Preço às claras.</span>
          </h2>
        </div>
        <div
          className="vehicle-tabs"
          role="tablist"
          aria-label="Tipo de veículo"
        >
          {Object.entries(vehicleLabels).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={vehicle === key}
              onClick={() => setVehicle(key as VehicleType)}
            >
              {vehicle === key && (
                <m.span className="tab-active" layoutId="vehicle-tab" />
              )}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="price-grid">
        {services
          .filter((s) => s.category === "wash" && typeof s.prices?.[vehicle] === "number" && (!s.vehicleTypes?.length || s.vehicleTypes.includes(vehicle)))
          .map((s, i) => (
            <m.article
              key={s.slug}
              className={`price-card ${i === 1 ? "featured" : ""}`}
              whileHover={{ y: -5 }}
              transition={{ duration: 0.2 }}
            >
              {i === 1 && (
                <span className="card-ribbon">Cuidado do dia a dia</span>
              )}
              <span className="service-number">0{i + 1}</span>
              {s.imageUrl && <img src={s.imageUrl} alt={s.name} style={{width:"100%",height:180,objectFit:"cover",borderRadius:12}} />}
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <div className="price">
                <small>R$</small>
                <AnimatePresence mode="wait">
                  <PriceAmount key={vehicle} value={s.prices![vehicle]!} />
                </AnimatePresence>
              </div>
              <span className="price-vehicle">{vehicleLabels[vehicle]}</span>
              <Link prefetch={false}
                className={`button ${i === 1 ? "primary" : "secondary"}`}
                href={`/cliente/agendar?servico=${s.slug}&veiculo=${vehicle}`}
              >
                Escolher este cuidado
              </Link>
            </m.article>
          ))}
      </div>
      {vehicle === "moto" && services.filter(s=>s.slug === "moto" && s.category !== "wash" && s.active !== false).map(s=><article className="price-card" key={s.slug}><h3>{s.name}</h3><p>{s.description}</p>{typeof s.prices?.moto === "number" && <strong>{money(s.prices.moto)}</strong>}<Link className="button primary" href="/cliente/agendar?servico=moto&veiculo=moto">Agendar moto</Link></article>)}
      <p className="price-note">
        <ShieldCheck size={16} /> Valores conforme a tabela Automotive. Serviços
        extras sob consulta.
      </p>
    </section>
  );
}
function Services({ services }: { services: PublicService[] }) {
  return (
    <section className="section extras-section">
      <div className="container">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Além da lavagem</p>
            <h2>
              Proteção, brilho
              <br />
              <span>e acabamento.</span>
            </h2>
          </div>
          <p className="section-intro">
            Cada veículo pede um cuidado.
            <br />
            Converse com a equipe sobre o seu.
          </p>
        </div>
        <Ticker velocity={48} direction="left" gap={24} hoverSlowdown={0}
          items={services.filter(s => s.category === "extra").map((s, i) => ({
            id: s.slug,
            content: <article className="extra-card">
              <span className="extra-index">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.name}</h3>
              <p>{s.description || "Avaliação do veículo e orçamento personalizado."}</p><Link className="button secondary" href={`/cliente/agendar?servico=${s.slug}${s.slug === "moto" ? "&veiculo=moto" : ""}`}>Solicitar agendamento</Link>
              <a className="text-link" href={whatsappUrl(`Olá! Gostaria de consultar disponibilidade e orçamento para ${s.name}.`)} target="_blank" rel="noreferrer">
                <MessageCircle size={16} /> Consultar pelo WhatsApp
              </a>
            </article>
          }))} />
        <p className="fine-print extra-booking-note">Motos e serviços especiais também podem ser solicitados online. Serviços sob orçamento precisam da avaliação da equipe.</p>
        <div className="service-stories">
          {services.filter(s=>["extra-6","oxi-sanitizacao"].includes(s.slug)).map(s=>(<article className="service-story" key={s.slug}><img src={s.imageUrl || (s.slug === "extra-6" ? "/gallery/foto-01.webp" : "/gallery/foto-17.webp")} alt={s.name} style={{width:"100%",objectFit:"cover"}}/><div><h3>{s.name}</h3><p>{s.description}</p><Link className="button secondary" href={`/cliente/agendar?servico=${s.slug}`}>Solicitar agendamento</Link></div></article>))}        </div>
        <Link prefetch={false} className="text-link" href="/contato">
          Conversar sobre serviços especiais
        </Link>
      </div>
    </section>
  );
}
function Comparison({ item }: { item: GalleryItem }) {
  const [position, setPosition] = useState(50);
  if (item.layout === "pair") return (
    <figure className="comparison">
      <div className="comparison-pair">
        {(["Antes", "Depois"] as const).map((label, index) => (
          <div className="headlight-frame" key={label}>
            <Image src={item.before} alt={`${label}: ${item.title}`} width={1080} height={1080} unoptimized
              style={{ left: index === 0 ? "-30%" : "-140%" }} />
            <span className="comparison-label before">{label}</span>
          </div>
        ))}
      </div>
      <figcaption><h3>{item.title}</h3><p>{item.description}</p></figcaption>
    </figure>
  );
  return (
    <div className="comparison">
      <div className="comparison-images">
        <Image
          src={item.after}
          alt={`Depois: ${item.title}`}
          fill
          sizes="(max-width: 700px) 100vw, 60vw"
        />
        <Image
          src={item.before}
          alt={`Antes: ${item.title}`}
          fill
          sizes="(max-width: 700px) 100vw, 60vw"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <span className="comparison-label before">Antes</span>
        <span className="comparison-label after">Depois</span>
        <div className="comparison-line" style={{ left: `${position}%` }} />
        <input
          aria-label={`Comparar antes e depois de ${item.title}`}
          type="range"
          min="0"
          max="100"
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
      </div>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
    </div>
  );
}
function Gallery({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  useEffect(() => {
    fetch("/gallery.json")
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {});
  }, []);
  return (
    <section className="section container" id="galeria">
      <div className="section-heading">
        <div>
          <p className="eyebrow">O resultado aparece</p>
          <h2>
            Antes &amp; <span>depois.</span>
          </h2>
        </div>
        {compact && (
          <Link prefetch={false} className="text-link" href="/galeria">
            Ver a galeria
          </Link>
        )}
      </div>
      {items.length ? (
        items
          .slice(0, compact ? 1 : undefined)
          .map((item, i) => <Comparison item={item} key={i} />)
      ) : (
        <div className="gallery-empty">
          <Droplets size={44} />
          <h3>Cada detalhe faz diferença.</h3>
          <p>Novos registros dos nossos serviços estarão aqui em breve.</p>
          <Link prefetch={false} href="/servicos" className="button secondary">
            Conhecer os cuidados
          </Link>
        </div>
      )}
    </section>
  );
}
function Loyalty() {
  return (
    <section className="loyalty-section">
      <div className="container loyalty-grid">
        <Reveal>
          <p className="eyebrow">Seu cuidado vale mais</p>
          <h2>
            10 lavagens.
            <br />
            <span>
              A próxima é<br />
              por nossa conta.
            </span>
          </h2>
          <p>
            A cada 10 lavagens pagas e concluídas, você recebe uma Lavagem
            Simples gratuita para o mesmo veículo.
          </p>
          <Link prefetch={false} className="button primary" href="/cliente/fidelidade">
            Acompanhar minha fidelidade
          </Link>
          <p className="fine-print">
            Cupom de uso único, vinculado à placa, com validade de 30 dias. A
            lavagem com cupom não soma pontos.
          </p>
        </Reveal>
        <div className="loyalty-card">
          <div className="loyalty-card-top">
            <span>AUTOMOTIVE</span>
            <Gift size={25} />
          </div>
          <p className="eyebrow">Cada visita, um passo</p>
          <div className="loyalty-stamps">
            {Array.from({ length: 10 }, (_, i) => (
              <m.span
                key={i}
                initial={{ scale: 0.8, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                transition={{ delay: i * 0.04, type: "spring" }}
                viewport={{ once: true }}
              >
                {i === 9 ? <Gift /> : <Droplets />}
              </m.span>
            ))}
          </div>
          <h3>Seu próximo cuidado começa aqui.</h3>
          <p>Entre na sua conta para ver seu progresso e seus cupons.</p>
          <span className="loyalty-watermark">01 / 10</span>
        </div>
      </div>
    </section>
  );
}
const faqs = [
  {
    q: "Como funciona o agendamento?",
    a: "Você escolhe o serviço, informa seu veículo e solicita um horário disponível. A solicitação fica pendente até a equipe confirmar. Acompanhe o status na sua conta.",
  },
  {
    q: "Como ganho a lavagem gratuita?",
    a: "Após 10 lavagens pagas e concluídas, você recebe um cupom de Lavagem Simples para a mesma placa e tipo de veículo. O cupom vale por 30 dias e pode ser usado uma única vez.",
  },
  {
    q: "SUV e caminhonete têm os mesmos preços?",
    a: "Os valores variam por tamanho. Use os filtros da tabela para conferir Carro pequeno, SUV e Caminhonete.",
  },
  {
    q: "Como faço para contratar PPF, vitrificação ou película?",
    a: "Esses serviços são sob consulta. A equipe avalia o veículo e informa o orçamento e a disponibilidade.",
  },
  { q: "O que fazer com objetos pessoais no veículo?", a: LEGAL_NOTICE },
];
function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section container faq-section">
      <div>
        <p className="eyebrow">Sem dúvidas no caminho</p>
        <h2>
          Bom saber
          <br />
          <span>antes de vir.</span>
        </h2>
      </div>
      <div>
        {faqs.map((f, i) => (
          <div className="faq-item" key={f.q}>
            <button
              aria-expanded={open === i}
              aria-controls={`faq-${i}`}
              onClick={() => setOpen(open === i ? null : i)}
            >
              {f.q}
              {open === i ? <Minus /> : <Plus />}
            </button>
            <AnimatePresence>
              {open === i && (
                <m.div
                  id={`faq-${i}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  <p>{f.a}</p>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  );
}
function Contact() {
  const { whatsapp, instagram, address } = businessContact;
  const map = locationUrl;
  const [showMap, setShowMap] = useState(false);
  return (
    <section className="contact-section">
      <div className="container contact-grid">
        <div>
          <p className="eyebrow">Vamos cuidar do seu carro?</p>
          <h2>
            Seu carro merece
            <br />
            <span>esse cuidado.</span>
          </h2>
          <div className="contact-actions">
            <Link prefetch={false} href="/cliente/agendar" className="button primary">
              <CalendarDays size={18} />
              Solicitar agendamento
            </Link>
            {whatsapp && (
              <a
                className="button secondary"
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={18} />
                WhatsApp
              </a>
            )}
          </div>
        </div>
        <div className="contact-details">
          <div>
            <MapPin />
            <div>
              <h3>Automotive</h3>
              <p>
                {address ||
                  "Endereço e canais de contato serão disponibilizados em breve."}
              </p>
              {map && (
                <a href={map} target="_blank" rel="noreferrer">
                  Abrir localização
                </a>
              )}
            </div>
          </div>
          {instagram && (
            <a
              href={
                instagram.startsWith("https://")
                  ? instagram
                  : `https://www.instagram.com/${instagram.replace("@", "")}/`
              }
              target="_blank"
              rel="noreferrer"
            >
              <Instagram />
              Instagram
            </a>
          )}
          <div className="contact-hours"><Clock3 /><div><h3>Horário de funcionamento</h3><p>{businessContact.hours}</p><small>Agendamentos sujeitos à confirmação da equipe.</small></div></div>
        </div>
      </div>
      <div className="container contact-location">
        <Image src="/gallery/foto-12.webp" alt="Arte Automotive com serviços e contato" width={700} height={700} sizes="(max-width: 700px) 90vw, 30vw" />
        <div className="map-panel">
          {showMap ? <iframe title="Localização da Automotive em Teresina" src={`https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`} loading="lazy" referrerPolicy="no-referrer" /> : <div className="map-placeholder"><MapPin size={36} /><h3>Encontre a Automotive</h3><p>{address}</p><button type="button" className="button secondary" onClick={() => setShowMap(true)}>Carregar mapa</button><small>Ao carregar, você se conecta ao Google Maps.</small></div>}
          <a className="text-link map-directions" href={map} target="_blank" rel="noreferrer">Abrir rota no Google Maps</a>
        </div>
      </div>
    </section>
  );
}
function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, 60]);
  return (
    <section className="hero" ref={ref}>
      <div className="hero-glow" />
      <LogoTrace />
      <div className="container hero-grid">
        <div className="hero-copy">
          <m.p className="eyebrow" initial={false} animate={{ opacity: 1 }}>
            Lava a jato &amp; estética automotiva
          </m.p>
          <h1>
            {["Seu carro", "novo", "de novo."].map((line, i) => (
              <m.span
                className={i === 2 ? "hero-accent" : ""}
                key={line}
                initial={{ y: 20 }}
                animate={{ y: 0 }}
                transition={{ delay: i * 0.12, duration: 0.6 }}
              >
                {line}
              </m.span>
            ))}
          </h1>
          <p>
            Da lavagem ao acabamento.
            <br />
            Atenção em cada detalhe, a cada visita.
          </p>
          <div className="hero-actions">
            <Link prefetch={false} className="button primary" href="/cliente/agendar">
              <CalendarDays size={18} />
              Agendar agora
            </Link>
            <Link prefetch={false} className="button secondary" href="/servicos">
              Ver serviços
            </Link>
          </div>
          <div className="hero-proof">
            <span>
              <Check size={16} /> Preços transparentes
            </span>
            <span>
              <Gift size={16} /> Fidelidade que recompensa
            </span>
          </div>
        </div>
        <m.div className="hero-art" style={{ y: reduced ? 0 : y }}>
          <div className="hero-image-wrap">
            <Image
              src="/brand/hero.webp"
              alt="Logo Automotive sobre o degradê azul petróleo original da marca"
              width={1400}
              height={612}
              sizes="(max-width: 620px) 100vw, 50vw"
              loading="eager"
              fetchPriority="high"
            />
            <div className="hero-image-caption">
              <span>
                UM NOVO BRILHO.
                <br />O MESMO CUIDADO.
              </span>
              <span>
                ESTÉTICA
                <br />
                AUTOMOTIVA
              </span>
            </div>
          </div>
          <div className="hero-price-tag">
            <Droplets />
            <div>
              <span>Lavagens a partir de</span>
              <strong>{money(30)}</strong>
              <small>Carro pequeno · lavagem externa</small>
            </div>
          </div>
        </m.div>
      </div>
      <div className="hero-bottom container">
        <span>01 — CUIDADO DO COMEÇO AO FIM</span>
        <span>BRILHO QUE SE VÊ. CUIDADO QUE SE SENTE.</span>
      </div>
    </section>
  );
}
export function PublicSite({ page }: { page: string }) {
  const [services, setServices] = useState<PublicService[]>(initialServices);
  useEffect(() => {
    if (["home", "servicos"].includes(page))
      fetch("/api/services")
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((data) => {
          setServices(data);
        })
        .catch(() => {});
  }, [page]);
  return (
    <>
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <PublicHeader />
      <main id="main">
        <div key={page}>
            {page === "home" ? (
              <>
                <Hero />
                <div className="benefits container">
                  <h2 className="sr-only">Os cuidados da Automotive</h2>
                  {[
                    {
                      icon: Droplets,
                      title: "Cada detalhe importa",
                      text: "Cuidado por dentro e por fora.",
                    },
                    {
                      icon: ShieldCheck,
                      title: "O brilho vem do cuidado",
                      text: "Serviços para cada necessidade.",
                    },
                    {
                      icon: CalendarDays,
                      title: "Seu tempo, bem cuidado",
                      text: "Solicite e acompanhe seu horário.",
                    },
                    {
                      icon: Gift,
                      title: "Cuidado que volta para você",
                      text: "10 lavagens, 1 Lavagem Simples grátis.",
                    },
                  ].map((b) => (
                    <div key={b.title}>
                      <b.icon />
                      <div>
                        <h3>{b.title}</h3>
                        <p>{b.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <PriceTable services={services} />
                <Services services={services} />
                <Marquee items={["Lavagem completa","Polimento técnico","Vitrificação","Película","PPF","Oxi-sanitização","Higienização interna","Revitalização de farol"]} />
                <Showcase services={services} />
                <Reels />
                <Gallery compact />
                <Loyalty />
                <Testimonials />
                <FAQ />
                <Contact />
              </>
            ) : page === "servicos" ? (
              <>
                <div className="page-title container">
                  <p className="eyebrow">Seu carro. Seu cuidado.</p>
                  <h1>
                    Serviços &amp; <span>preços.</span>
                  </h1>
                  <p>
                    Escolha o tamanho do seu veículo e encontre o cuidado ideal.
                  </p>
                </div>
                <PriceTable services={services} />
                <Services services={services} />
                <Contact />
              </>
            ) : page === "galeria" ? (
              <>
                <div className="page-title container">
                  <p className="eyebrow">Estética automotiva</p>
                  <h1>
                    O cuidado
                    <br />
                    <span>em resultado.</span>
                  </h1>
                </div>
                <Gallery />
                <Contact />
              </>
            ) : page === "contato" ? (
              <>
                <div className="page-title container">
                  <p className="eyebrow">Seu próximo cuidado</p>
                  <h1>
                    Vamos <span>conversar.</span>
                  </h1>
                </div>
                <Contact />
                <FAQ />
              </>
            ) : (
              <Privacy />
            )}
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
function Privacy() {
  return (
    <article className="container section privacy">
      <p className="eyebrow">Seus dados</p>
      <h1>
        Política de <span>privacidade</span>
      </h1>
      <p>
        Usamos seus dados para identificar sua conta, organizar agendamentos,
        acompanhar a fidelidade e registrar os serviços e pagamentos realizados.
      </p>
      <h2>Dados tratados</h2>
      <p>
        Nome, e-mail, telefone quando informado, modelo e placa do veículo,
        solicitações, histórico de serviços e cupons. A autenticação é realizada
        pelo Clerk. Não armazenamos sua senha.
      </p>
      <h2>Finalidade e acesso</h2>
      <p>
        Tratamos os dados necessários para executar os serviços solicitados e
        cumprir obrigações legais. Somente você e os administradores autorizados
        têm acesso aos seus agendamentos. Não usamos esses dados para marketing
        sem consentimento específico.
      </p>
      <h2>Seus direitos</h2>
      <p>
        Você pode solicitar acesso, correção ou eliminação dos seus dados,
        respeitadas as obrigações legais de conservação. Registros financeiros
        podem ser conservados durante o período exigido pela legislação
        aplicável.
      </p>
      <h2>Serviços utilizados</h2>
      <p>
        Clerk para autenticação, MongoDB Atlas para armazenamento e Vercel para
        hospedagem. Esses provedores podem processar dados fora do Brasil.
        Cookies de sessão são necessários para manter sua conta conectada.
      </p>
      <h2>Fale com a Automotive</h2>
      <p>
        {process.env.NEXT_PUBLIC_CONTACT_EMAIL ? (
          <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}`}>
            {process.env.NEXT_PUBLIC_CONTACT_EMAIL}
          </a>
        ) : (
          "O canal de atendimento sobre dados pessoais será informado antes da abertura dos cadastros."
        )}
      </p>
      <p className="fine-print">
        Esta política deve ser revisada e aprovada pelo responsável pelo
        estabelecimento antes da abertura ao público.
      </p>
    </article>
  );
}

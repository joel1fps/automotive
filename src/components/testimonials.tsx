"use client";
import { useEffect, useRef, useState } from "react";
import { LazyMotion, m } from "motion/react";
import { whatsappUrl } from "@/lib/site-config";
type Review = { name: string; quote: string; date?: string };
const dragFeatures = () => import("motion/react").then(module => module.domMax);
export function Testimonials() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const windowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch("/testimonials.json")
      .then((r) => r.json())
      .then(setReviews)
      .catch(() => {});
  }, []);
  return (
    <section className="section container testimony">
      <p className="eyebrow">Quem cuida também escuta</p>
      <h2>
        A sua experiência
        <br />
        <span>faz parte do nosso cuidado.</span>
      </h2>
      {reviews.length ? (
        <LazyMotion features={dragFeatures}>
          <div className="reviews-window" ref={windowRef}>
            <m.div
              className="review-track"
              drag="x"
              dragConstraints={windowRef}
              dragMomentum
            >
              {reviews.map((r, i) => (
                <article className="review-card" key={i} tabIndex={0}>
                  <p>“{r.quote}”</p>
                  <h3>{r.name}</h3>
                  {r.date && <p className="fine-print">{r.date}</p>}
                </article>
              ))}
            </m.div>
          </div>
        </LazyMotion>
      ) : (
        <div><p>Já conhece o nosso cuidado? Compartilhe sua experiência com a equipe.</p><a className="text-link" href={whatsappUrl("Olá! Gostaria de compartilhar minha experiência com a Automotive.")} target="_blank" rel="noreferrer">Enviar minha avaliação</a></div>
      )}
    </section>
  );
}

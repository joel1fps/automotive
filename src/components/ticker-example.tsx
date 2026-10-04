"use client";
import { Ticker } from "./ticker";

const labels = ["Polimento", "PPF", "Vitrificação", "Película", "Higienização", "Oxi-sanitização", "Revitalização de farol", "Lavagem completa"];
export function TickerExample() {
  return <Ticker velocity={55} direction="left" gap={24} hoverSlowdown={0}
    items={labels.map((label, index) => ({ id: String(index), content:
      <article className="ticker-demo-card"><span>{String(index + 1).padStart(2, "0")}</span><h3>{label}</h3></article>
    }))} />;
}

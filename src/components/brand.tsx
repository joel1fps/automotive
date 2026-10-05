import Link from "next/link";
import Image from "next/image";

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

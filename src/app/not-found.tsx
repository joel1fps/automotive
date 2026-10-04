import Link from "next/link";
export default function NotFound() {
  return (
    <main className="container section">
      <p className="eyebrow">404</p>
      <h1>Página não encontrada</h1>
      <Link className="button primary" href="/">
        Voltar ao início
      </Link>
    </main>
  );
}

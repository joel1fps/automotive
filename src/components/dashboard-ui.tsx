"use client";
import { useEffect } from "react";
import { ClipboardList } from "lucide-react";
import { statusLabels } from "@/lib/catalog";
import { Button } from "./ui/button";

export function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status}`}>{statusLabels[status] || status}</span>
  );
}
export function Pagination({
  data,
  page,
  setPage,
}: {
  data: { pages: number; total: number } | null;
  page: number;
  setPage: (page: number) => void;
}) {
  useEffect(() => {
    if (data && page > Math.max(1, data.pages)) setPage(Math.max(1, data.pages));
  }, [data, page, setPage]);
  return data && data.pages > 1 ? (
    <div className="pagination">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        Anterior
      </Button>
      <span>
        {page} de {data.pages}
      </span>
      <Button
        variant="secondary"
        disabled={page >= data.pages}
        onClick={() => setPage(page + 1)}
      >
        Próxima
      </Button>
    </div>
  ) : null;
}
export function LoadState({
  loading,
  error,
  empty = false,
  children,
}: {
  loading: boolean;
  error: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return loading ? (
    <div className="skeleton" aria-label="Carregando" />
  ) : error ? (
    <p role="alert" className="alert-error">
      {error}
    </p>
  ) : empty ? (
    <div className="empty">
      <ClipboardList size={32} />
      <p>Nenhum registro encontrado.</p>
    </div>
  ) : (
    <>{children}</>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Diálogo modal con el elemento nativo <dialog> (accesible y sin dependencias). */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-text backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-surface-muted"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="p-5">{open ? children : null}</div>
    </dialog>
  );
}

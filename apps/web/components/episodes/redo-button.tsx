"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Blocker } from "@/lib/dependencies";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** «Lo usan: el plan de ayudas visuales, las miniaturas A, B. Bórralos para …». */
export function BlockedNote({
  blockers,
  action = "redo",
  className,
}: {
  blockers: Blocker[];
  action?: "redo" | "delete";
  className?: string;
}) {
  const t = useTranslations("dependents");
  if (!blockers.length) return null;
  return (
    <p className={cn("text-xs text-muted", className)} data-testid="blocked-note">
      {t("usedBy")}{" "}
      {blockers.map((b, i) => (
        <span key={b.kind}>
          {i ? ", " : null}
          <Link href={b.href} scroll={false} className="text-accent underline">
            {t(`kind.${b.kind}`, { detail: b.detail ?? "" })}
          </Link>
        </span>
      ))}
      . {t(action === "redo" ? "hintRedo" : "hintDelete")}
    </p>
  );
}

/**
 * «Rehacer» de una tarjeta: activo si nada generado depende de ella; si algo
 * depende, queda desactivado y dice qué es (con enlace para ir a borrarlo).
 */
export function RedoButton({
  label,
  onClick,
  blockers,
  pending = false,
  disabled = false,
  variant = "ghost",
  size = "sm",
  icon,
  align = "start",
  testId,
}: {
  label: ReactNode;
  onClick: () => void;
  blockers: Blocker[];
  pending?: boolean;
  disabled?: boolean;
  variant?: Variant;
  size?: "sm" | "md";
  icon?: ReactNode;
  align?: "start" | "end";
  testId?: string;
}) {
  const blocked = blockers.length > 0;
  return (
    <div
      className={cn(
        "flex max-w-sm flex-col gap-1",
        align === "end" ? "items-end text-right" : "items-start",
      )}
    >
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={blocked || disabled || pending}
        data-testid={testId}
        aria-describedby={blocked && testId ? `${testId}-blocked` : undefined}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          (icon ?? <RotateCcw className="size-3.5" />)
        )}
        {label}
      </Button>
      {blocked ? (
        <span id={testId ? `${testId}-blocked` : undefined}>
          <BlockedNote blockers={blockers} />
        </span>
      ) : null}
    </div>
  );
}

/** «Borrar» de una tarjeta: pide confirmación y se bloquea igual que «Rehacer». */
export function DeleteButton({
  label,
  confirmText,
  onDelete,
  blockers = [],
  pending = false,
  disabled = false,
  align = "start",
  testId,
  showNote = true,
}: {
  label: ReactNode;
  confirmText: string;
  onDelete: () => void;
  blockers?: Blocker[];
  pending?: boolean;
  disabled?: boolean;
  align?: "start" | "end";
  testId?: string;
  /** Sin el aviso, cuando el «Rehacer» de al lado ya dice lo mismo. */
  showNote?: boolean;
}) {
  const blocked = blockers.length > 0;
  return (
    <div
      className={cn(
        "flex max-w-sm flex-col gap-1",
        align === "end" ? "items-end text-right" : "items-start",
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        className="text-critical hover:bg-critical-soft"
        onClick={() => confirm(confirmText) && onDelete()}
        disabled={blocked || disabled || pending}
        data-testid={testId}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        {label}
      </Button>
      {showNote ? <BlockedNote blockers={blockers} action="delete" /> : null}
    </div>
  );
}

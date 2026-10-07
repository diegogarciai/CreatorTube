"use client";

import { useTranslations } from "next-intl";

/** Traduce el error de una server action si es una clave conocida (p. ej. "errors.forbidden"). */
export function useActionError() {
  const t = useTranslations();
  return (error: string) => (/^[a-z]+\.[a-zA-Z_.]+$/.test(error) && t.has(error) ? t(error) : error);
}

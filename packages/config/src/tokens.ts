/**
 * Tokens de diseño compartidos entre la web y la futura app móvil.
 * La web los expone como variables CSS en apps/web/app/globals.css.
 */
export const colors = {
  background: "#fafaf9",
  surface: "#ffffff",
  border: "#e7e5e4",
  text: "#1c1917",
  muted: "#78716c",
  accent: "#ea580c",
  accentText: "#ffffff",
  ok: "#16a34a",
  warn: "#d97706",
  critical: "#dc2626",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14 } as const;

export const fonts = {
  sans: "Inter, ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

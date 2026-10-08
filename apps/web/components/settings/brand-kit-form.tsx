"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import {
  BRAND_COLOR_ROLES,
  BRAND_FONT_ROLES,
  type BrandKit,
  type BrandStyle,
} from "@planificador/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/form";
import { saveBrandKit, setBrandLogo } from "@/lib/actions/brand";
import { discardMedia, uploadMedia } from "@/lib/upload";
import { useActionError } from "@/lib/use-action-error";
import { errorMessage } from "@/lib/utils";

type Kit = Omit<BrandKit, "logoPath">;

/** Colores, tipografías y estilo del canal, con su logo y una vista previa. */
export function BrandKitForm({
  channelId,
  initial,
  isDefault,
  logoUrl,
  disabled,
}: {
  channelId: string;
  initial: BrandKit;
  isDefault: boolean;
  logoUrl: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("brand");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kit, setKit] = useState<Kit>({
    colors: initial.colors,
    fonts: initial.fonts,
    style: initial.style,
    thumbnailStyle: initial.thumbnailStyle,
  });

  const setStyle = <K extends keyof BrandStyle>(key: K, value: BrandStyle[K]) =>
    setKit((k) => ({ ...k, style: { ...k.style, [key]: value } }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveBrandKit(channelId, kit);
      if (res.ok) {
        toast.success(tc("saved"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });
  };

  const { style } = kit;
  return (
    <div className="space-y-6">
      {isDefault ? <p className="text-sm text-muted">{t("defaults")}</p> : null}

      <LogoField channelId={channelId} url={logoUrl} disabled={disabled} />

      <form onSubmit={save} className="space-y-6">
        <fieldset disabled={disabled || pending} className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("colors")}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {BRAND_COLOR_ROLES.map((role) => (
                <div key={role} className="flex items-start gap-2">
                  <input
                    type="color"
                    value={kit.colors[role]}
                    onChange={(e) =>
                      setKit((k) => ({ ...k, colors: { ...k.colors, [role]: e.target.value } }))
                    }
                    aria-label={t(`color.${role}`)}
                    className="mt-6 size-10 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
                  />
                  <Field
                    label={t(`color.${role}`)}
                    htmlFor={`brand-${role}`}
                    className="min-w-0 flex-1"
                  >
                    <Input
                      id={`brand-${role}`}
                      value={kit.colors[role]}
                      onChange={(e) =>
                        setKit((k) => ({ ...k, colors: { ...k.colors, [role]: e.target.value } }))
                      }
                      maxLength={7}
                      pattern="#[0-9A-Fa-f]{6}"
                      className="font-mono uppercase"
                    />
                    <p className="mt-1 text-xs text-muted">{t(`colorHint.${role}`)}</p>
                  </Field>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t("fonts")}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {BRAND_FONT_ROLES.map((role) => (
                <Field key={role} label={t(`font.${role}`)} htmlFor={`brand-font-${role}`}>
                  <Input
                    id={`brand-font-${role}`}
                    value={kit.fonts[role]}
                    onChange={(e) =>
                      setKit((k) => ({ ...k, fonts: { ...k.fonts, [role]: e.target.value } }))
                    }
                    maxLength={60}
                    required
                  />
                </Field>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">{t("style")}</h3>
            <NumberRow
              label={t("mix")}
              fields={[
                [
                  "mix-dark",
                  t("mixDark"),
                  style.mix.dark,
                  (v) => setStyle("mix", { ...style.mix, dark: num(v) }),
                ],
                [
                  "mix-light",
                  t("mixLight"),
                  style.mix.light,
                  (v) => setStyle("mix", { ...style.mix, light: num(v) }),
                ],
                [
                  "mix-accent",
                  t("mixAccent"),
                  style.mix.accent,
                  (v) => setStyle("mix", { ...style.mix, accent: num(v) }),
                ],
              ]}
            />
            <NumberRow
              label={t("grid")}
              fields={[
                [
                  "grid-size",
                  t("gridSize"),
                  style.grid.size,
                  (v) => setStyle("grid", { ...style.grid, size: num(v) }),
                ],
                [
                  "grid-opacity",
                  t("gridOpacity"),
                  style.grid.opacity,
                  (v) => setStyle("grid", { ...style.grid, opacity: num(v) }),
                ],
                [
                  "grid-data",
                  t("gridDataOpacity"),
                  style.grid.dataOpacity,
                  (v) => setStyle("grid", { ...style.grid, dataOpacity: num(v) }),
                ],
              ]}
            />
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={style.halo.enabled}
                  onChange={(e) => setStyle("halo", { ...style.halo, enabled: e.target.checked })}
                />
                {t("halo")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={style.halo.offWithData}
                  disabled={!style.halo.enabled}
                  onChange={(e) =>
                    setStyle("halo", { ...style.halo, offWithData: e.target.checked })
                  }
                />
                {t("haloOffWithData")}
              </label>
            </div>
            <NumberRow
              label={t("haloOpacity")}
              fields={[
                [
                  "halo-center",
                  t("haloCenter"),
                  style.halo.center,
                  (v) => setStyle("halo", { ...style.halo, center: num(v) }),
                ],
                [
                  "halo-edge",
                  t("haloEdge"),
                  style.halo.edge,
                  (v) => setStyle("halo", { ...style.halo, edge: num(v) }),
                ],
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("easing")} htmlFor="brand-easing">
                <Input
                  id="brand-easing"
                  value={style.easing}
                  onChange={(e) => setStyle("easing", e.target.value)}
                  className="font-mono"
                  maxLength={80}
                />
              </Field>
              <Field label={t("minWhiteOnAccent")} htmlFor="brand-min-white">
                <Input
                  id="brand-min-white"
                  type="number"
                  min={8}
                  max={400}
                  value={style.minWhiteOnAccentPx}
                  onChange={(e) => setStyle("minWhiteOnAccentPx", num(e.target.value))}
                />
              </Field>
              <Field label={t("minTextOnHalo")} htmlFor="brand-min-halo">
                <Input
                  id="brand-min-halo"
                  type="number"
                  min={8}
                  max={400}
                  value={style.minTextOnHaloPx}
                  onChange={(e) => setStyle("minTextOnHaloPx", num(e.target.value))}
                />
              </Field>
            </div>
            <NumberRow
              label={t("safeZone")}
              fields={(["top", "bottom", "left", "right"] as const).map((side) => [
                `safe-${side}`,
                t(side),
                style.safeZone[side],
                (v: string) => setStyle("safeZone", { ...style.safeZone, [side]: num(v) }),
              ])}
            />
          </section>

          <Field
            label={t("thumbnailStyle")}
            hint={t("thumbnailStyleHint")}
            htmlFor="brand-thumb-style"
          >
            <Textarea
              id="brand-thumb-style"
              value={kit.thumbnailStyle}
              onChange={(e) => setKit((k) => ({ ...k, thumbnailStyle: e.target.value }))}
              maxLength={2000}
            />
          </Field>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("preview")}</h3>
            <BrandPreview kit={kit} logoUrl={logoUrl} />
          </section>

          <Button type="submit">{pending ? tc("saving") : tc("save")}</Button>
        </fieldset>
      </form>
    </div>
  );
}

function NumberRow({
  label,
  fields,
}: {
  label: string;
  fields: [id: string, label: string, value: number, onChange: (v: string) => void][];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fields.map(([id, text, value, onChange]) => (
          <label key={id} className="space-y-1 text-xs text-muted">
            <span>{text}</span>
            <Input
              type="number"
              min={0}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-label={`${label}: ${text}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Una miniatura de muestra como la del manual: lienzo, halo radial (resplandor
 * al centro y ámbar profundo en la caída), retícula, viñeteado y el texto.
 */
function BrandPreview({ kit, logoUrl }: { kit: Kit; logoUrl: string | null }) {
  const t = useTranslations("brand");
  const { colors, fonts, style } = kit;
  const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  const line = mix(colors.grid, style.grid.opacity);
  // La retícula se dibuja a escala: la muestra mide un tercio de 1280 px.
  const cell = Math.max(4, style.grid.size / 3);
  const layers: [image: string, size: string][] = [
    [`radial-gradient(ellipse at center, transparent 55%, ${mix(colors.page, 90)})`, "100% 100%"],
    ...(style.halo.enabled
      ? ([
          [
            `radial-gradient(circle at 68% 45%, ${mix(colors.glow, style.halo.center)}, ${mix(colors.amberDeep, style.halo.edge)} 35%, transparent 65%)`,
            "100% 100%",
          ],
        ] as [string, string][])
      : []),
    [`linear-gradient(${line} 1px, transparent 1px)`, `${cell}px ${cell}px`],
    [`linear-gradient(90deg, ${line} 1px, transparent 1px)`, `${cell}px ${cell}px`],
  ];
  return (
    <div
      data-testid="brand-preview"
      className="relative aspect-video w-full max-w-md overflow-hidden rounded-lg border border-border"
      style={{
        backgroundColor: colors.canvas,
        backgroundImage: layers.map(([image]) => image).join(", "),
        backgroundSize: layers.map(([, size]) => size).join(", "),
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
        <img src={logoUrl} alt="" className="absolute top-3 left-3 h-5 w-auto" />
      ) : null}
      <div
        className="absolute bottom-4 left-4 max-w-[55%] text-2xl leading-tight"
        style={{
          fontFamily: `"${fonts.thumbnail}", "${fonts.display}", "${fonts.body}", sans-serif`,
          fontWeight: 900,
          textShadow: "0 2px 12px rgb(0 0 0 / 0.5)",
        }}
      >
        <span style={{ color: colors.text }}>{t("previewTitle")}</span>
        <br />
        <span style={{ color: colors.accent }}>{t("previewAccent")}</span>
      </div>
      <span
        className="absolute right-3 bottom-3 text-[10px] tracking-widest uppercase"
        style={{ fontFamily: `"${fonts.mono}", monospace`, color: colors.cream }}
      >
        {colors.accent}
      </span>
    </div>
  );
}

function LogoField({
  channelId,
  url,
  disabled,
}: {
  channelId: string;
  url: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("brand");
  const errorText = useActionError();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const upload = (file: File) =>
    start(async () => {
      let path: string | null = null;
      try {
        path = await uploadMedia(channelId, "brand", file);
        const res = await setBrandLogo(channelId, path);
        if (!res.ok) throw new Error(res.error);
        router.refresh();
      } catch (err) {
        if (path) await discardMedia(path).catch(() => undefined);
        toast.error(errorText(errorMessage(err)));
      }
    });

  const remove = () => {
    if (!confirm(t("removeLogoConfirm"))) return;
    start(async () => {
      const res = await setBrandLogo(channelId, null);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-20 w-40 items-center justify-center rounded-lg border border-border bg-[repeating-conic-gradient(var(--surface-muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
          <img src={url} alt={t("logo")} className="max-h-16 max-w-36 object-contain" />
        ) : (
          <Badge>{t("noLogo")}</Badge>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("logo")}</p>
        <p className="text-xs text-muted">{t("logoHint")}</p>
        {disabled ? null : (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/svg+xml,image/webp,image/jpeg"
              className="sr-only"
              aria-label={url ? t("replaceLogo") : t("uploadLogo")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) upload(file);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => input.current?.click()}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageUp className="size-4" />
              )}
              {url ? t("replaceLogo") : t("uploadLogo")}
            </Button>
            {url ? (
              <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
                <Trash2 className="size-4" /> {t("removeLogo")}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

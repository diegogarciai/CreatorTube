"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Download,
  ImageUp,
  Loader2,
  PencilLine,
  RefreshCw,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/form";
import {
  NO_OPTIONS,
  THUMBNAIL_SCHEMES,
  validateSchemeText,
  type SchemeId,
  type ThumbnailOptions,
} from "@planificador/core";
import { CopyButton } from "@/components/copy-button";
import { ThumbnailIdeas } from "./thumbnail-ideas";
import { optionLabels, ThumbnailOptionChecks } from "./thumbnail-options";
import {
  addEpisodeRef,
  chooseThumbnail,
  deleteEpisodeRef,
  editThumbnailText,
  generateThumbnails,
} from "@/lib/actions/thumbnails";
import type { ThumbnailDesignView, ThumbnailsView, ThumbnailVersion } from "@/lib/data/thumbnails";
import { createClient } from "@/lib/supabase/browser";
import { THUMBNAIL_ESTIMATE_CREDITS, THUMBNAIL_TEXT_ESTIMATE_CREDITS } from "@/lib/tasks";
import { discardMedia, uploadEpisodeRef } from "@/lib/upload";
import { useActionError } from "@/lib/use-action-error";
import { cn, errorMessage, usd } from "@/lib/utils";

const MAX_REFS = 3;
const ACTIVE = new Set(["queued", "generating", "composing", "scoring"]);

/** Miniaturas del episodio: generar, calificar, cambiar el texto, elegir y descargar. */
export function ThumbnailsPanel({
  episodeId,
  channelId,
  view,
  canEdit,
}: {
  episodeId: string;
  channelId: string;
  view: ThumbnailsView;
  canEdit: boolean;
}) {
  const t = useTranslations("thumbnails");
  const router = useRouter();

  // Mientras hay una tarea en marcha se consulta el estado; si cambia, se recarga.
  const supabase = useMemo(() => createClient(), []);
  const signature = view.designs
    .flatMap((d) => d.versions.map((v) => `${v.id}:${v.status}`))
    .join(",");
  useEffect(() => {
    if (!view.active) return;
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("episode_assets")
        .select("id, status, design_idx, created_at, tasks(status)")
        .eq("episode_id", episodeId)
        .eq("kind", "thumbnail")
        .order("created_at", { ascending: false })
        .limit(60);
      if (!data) return;
      const now = [...data]
        .sort((a, b) => a.design_idx - b.design_idx || b.created_at.localeCompare(a.created_at))
        .map((r) => `${r.id}:${r.status}`)
        .join(",");
      const dead = data.some(
        (r) => ACTIVE.has(r.status) && ["failed", "canceled"].includes(r.tasks?.status ?? ""),
      );
      if (now !== signature || dead) router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [view.active, supabase, episodeId, signature, router]);

  if (view.missingAssets) {
    return (
      <Card>
        <CardHeader title={t("title")} />
        <CardBody className="space-y-3 text-sm">
          <p className="text-muted">{t("missingAssets")}</p>
          <Link
            href={`/c/${channelId}/episodios/${episodeId}?tab=script`}
            className="text-accent underline"
          >
            {t("goToScript")}
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ThumbnailIdeas
        episodeId={episodeId}
        view={view}
        canEdit={canEdit}
        canGenerate={view.presenterPhotos > 0 && !view.active}
      />
      <Card>
        <CardHeader title={t("title")} description={t("description")} />
        <CardBody className="space-y-4">
          {!view.verdict ? (
            <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              {t("noVerdict")}
            </p>
          ) : null}
          {view.presenterPhotos === 0 ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              {t("noPresenterPhotos")}{" "}
              <Link href={`/c/${channelId}/ajustes`} className="underline">
                {t("goToSettings")}
              </Link>
            </p>
          ) : null}
          {view.active ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin text-accent" /> {t("working")}
            </p>
          ) : null}
          <ProductRefs
            episodeId={episodeId}
            channelId={channelId}
            refs={view.refs}
            canEdit={canEdit}
          />
        </CardBody>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        {view.designs.map((d) => (
          <DesignCard
            key={d.idx}
            episodeId={episodeId}
            design={d}
            canEdit={canEdit}
            busy={view.active}
            canGenerate={view.presenterPhotos > 0 && view.verdict}
          />
        ))}
      </div>
    </div>
  );
}

function ProductRefs({
  episodeId,
  channelId,
  refs,
  canEdit,
}: {
  episodeId: string;
  channelId: string;
  refs: ThumbnailsView["refs"];
  canEdit: boolean;
}) {
  const t = useTranslations("thumbnails");
  const errorText = useActionError();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const room = MAX_REFS - refs.length;

  const upload = (files: File[]) =>
    start(async () => {
      for (const file of files.slice(0, room)) {
        let path: string | null = null;
        try {
          path = await uploadEpisodeRef(channelId, episodeId, file);
          const res = await addEpisodeRef(episodeId, { path });
          if (!res.ok) throw new Error(res.error);
        } catch (err) {
          if (path) await discardMedia(path).catch(() => undefined);
          toast.error(errorText(errorMessage(err)));
          break;
        }
      }
      if (files.length > room) toast.error(errorText("errors.too_many_refs"));
      router.refresh();
    });

  const remove = (id: string) => {
    if (!confirm(t("deleteRefConfirm"))) return;
    start(async () => {
      const res = await deleteEpisodeRef(episodeId, id);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{t("productRefs")}</h3>
      <p className="text-xs text-muted">{t("productRefsHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        {refs.map((r) => (
          <div
            key={r.id}
            className="relative size-24 overflow-hidden rounded-lg border border-border bg-surface-muted"
          >
            {r.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
              <img
                src={r.url}
                alt={r.label ?? t("productRef")}
                className="size-full object-cover"
              />
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => remove(r.id)}
                disabled={pending}
                aria-label={t("deleteRef")}
                className="absolute top-1 right-1 rounded-md bg-surface/90 p-1 text-muted hover:text-critical"
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        {canEdit && room > 0 ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              aria-label={t("uploadRefs")}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) upload(files);
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
              {t("uploadRefs")}
            </Button>
          </>
        ) : null}
        {refs.length === 0 && !canEdit ? (
          <span className="text-xs text-muted">{t("noRefs")}</span>
        ) : null}
      </div>
    </section>
  );
}

const scoreTone = (score: number): Tone => (score >= 8 ? "ok" : score >= 5 ? "warn" : "critical");

function DesignCard({
  episodeId,
  design,
  canEdit,
  busy,
  canGenerate,
}: {
  episodeId: string;
  design: ThumbnailDesignView;
  canEdit: boolean;
  busy: boolean;
  canGenerate: boolean;
}) {
  const t = useTranslations("thumbnails");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  // La versión elegida en la tira vale mientras no llegue otra más nueva.
  const [selected, setSelected] = useState<{ latest: string | null; id: string } | null>(null);
  const [mode, setMode] = useState<"none" | "regenerate" | "text">("none");
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<ThumbnailOptions>(NO_OPTIONS);

  const latest = design.versions[0] ?? null;
  const current =
    (selected?.latest === (latest?.id ?? null) &&
      design.versions.find((v) => v.id === selected?.id)) ||
    latest;
  const working = current ? ACTIVE.has(current.status) : false;
  // El esquema y el texto: los de la versión que se ve o, sin versiones, los del texto elegido.
  const scheme = current?.scheme ?? design.idea?.scheme ?? null;
  const text = current?.text?.lines.join(" ") ?? design.idea?.text ?? "";

  const regenerate = () =>
    start(async () => {
      const res = await generateThumbnails(episodeId, {
        designs: [design.idx],
        note: note.trim() || undefined,
        options,
      });
      if (res.ok) {
        setMode("none");
        setNote("");
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  const choose = (v: ThumbnailVersion) =>
    start(async () => {
      const res = await chooseThumbnail(v.id);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });

  return (
    <Card
      data-testid={`thumbnail-${design.letter}`}
      className={cn(current?.chosen && "border-accent")}
    >
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{design.letter}</Badge>
            {scheme ? THUMBNAIL_SCHEMES[scheme].name : t("thumbnail", { letter: design.letter })}
            {scheme ? <Badge>{t("scheme", { id: scheme })}</Badge> : null}
            {current?.chosen ? (
              <Badge tone="ok">
                <Star className="size-3 fill-current" /> {t("chosen")}
              </Badge>
            ) : null}
          </span>
        }
        description={design.idea?.angle}
      />
      <CardBody className="space-y-3 text-sm">
        {text ? (
          <p>
            <span className="text-muted">{t("text")}:</span> «{text}»
          </p>
        ) : null}
        {design.idea?.scene ? (
          <p className="line-clamp-3 text-xs text-muted" title={design.idea.scene}>
            {design.idea.scene}
          </p>
        ) : null}
        {design.idea?.title ? (
          <p className="flex items-start gap-1.5 text-xs">
            <span className="min-w-0 flex-1">
              <span className="text-muted">{t("titleLabel")}:</span> {design.idea.title}
            </span>
            <CopyButton value={design.idea.title} />
          </p>
        ) : null}
        {!design.idea ? <p className="text-xs text-muted">{t("pickFirst")}</p> : null}

        <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-surface-muted">
          {current?.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
            <img
              src={current.url}
              alt={t("imageAlt", { letter: design.letter })}
              className="size-full object-cover"
            />
          ) : null}
          {working ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/70 text-xs">
              <Loader2 className="size-5 animate-spin text-accent" />
              {t(`status.${current!.status as "queued"}`)}
            </div>
          ) : !current ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
              {t("notGenerated")}
            </div>
          ) : null}
        </div>

        {current?.status === "failed" ? (
          <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-xs text-critical">
            {t("failed")} {current.error ? errorText(current.error) : null}
          </p>
        ) : null}
        {current?.note ? (
          <p className="text-xs text-muted">
            {t("noteLabel")}: {current.note}
          </p>
        ) : null}
        {current?.scenario ||
        current?.mirror ||
        optionLabels(current?.options ?? NO_OPTIONS).length ? (
          <p className="flex flex-wrap gap-1.5 text-xs text-muted" data-testid="version-tags">
            {current?.scenario ? (
              <span>{t("scenario", { scenario: current.scenario })}</span>
            ) : null}
            {current?.mirror ? <Badge>{t("mirrored")}</Badge> : null}
            {optionLabels(current?.options ?? NO_OPTIONS).map((k) => (
              <Badge key={k} tone="warn">
                {t(`options.${k}`)}
              </Badge>
            ))}
          </p>
        ) : null}
        {current?.warnings.length ? (
          <div
            role="status"
            className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn"
            data-testid="layout-warnings"
          >
            <p className="font-medium">{t("warnings")}</p>
            <ul className="list-disc pl-4">
              {current.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {current?.status === "ready" && !current.scheme ? (
          <p className="text-xs text-muted">{t("legacy")}</p>
        ) : null}

        {current?.score ? <ScoreBox score={current.score} /> : null}

        {design.versions.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" aria-label={t("versions")}>
            {design.versions.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelected({ latest: latest?.id ?? null, id: v.id })}
                aria-pressed={v.id === current?.id}
                title={t("version", { n: design.versions.length - i })}
                className={cn(
                  "relative h-9 w-16 overflow-hidden rounded border bg-surface-muted",
                  v.id === current?.id ? "border-accent ring-1 ring-accent" : "border-border",
                )}
              >
                {v.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
                  <img src={v.url} alt="" className="size-full object-cover" />
                ) : (
                  <span className="text-[10px] text-muted">{design.versions.length - i}</span>
                )}
                {v.chosen ? (
                  <Star className="absolute top-0.5 right-0.5 size-3 fill-accent text-accent" />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canEdit && design.idea ? (
            <Button
              size="sm"
              variant={current ? "secondary" : "primary"}
              onClick={() => {
                if (!current) return regenerate();
                // Los checks parten de los de la versión que se ve.
                setOptions(current.options);
                setMode(mode === "regenerate" ? "none" : "regenerate");
              }}
              disabled={pending || busy || !canGenerate}
            >
              <RefreshCw className="size-3.5" /> {current ? t("regenerate") : t("generate")}
            </Button>
          ) : null}
          {canEdit && current?.status === "ready" ? (
            <>
              {current.scheme ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setMode(mode === "text" ? "none" : "text")}
                  disabled={pending || busy}
                >
                  <PencilLine className="size-3.5" /> {t("editText")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={current.chosen ? "primary" : "secondary"}
                onClick={() => choose(current)}
                disabled={pending}
                aria-pressed={current.chosen}
              >
                <Star className={cn("size-3.5", current.chosen && "fill-current")} />
                {current.chosen ? t("unchoose") : t("choose")}
              </Button>
            </>
          ) : null}
          {current?.downloadUrl ? (
            <a
              href={current.downloadUrl}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted"
            >
              <Download className="size-3.5" /> {t("download")}
            </a>
          ) : null}
        </div>

        {mode === "regenerate" ? (
          <div className="space-y-2 rounded-lg bg-surface-muted p-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={t("notePlaceholder")}
              aria-label={t("noteLabel")}
              className="min-h-16"
            />
            <ThumbnailOptionChecks letter={design.letter} value={options} onChange={setOptions} />
            <p className="text-xs text-muted">{t("options.hint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={regenerate} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {t("regenerateConfirm")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                <X className="size-4" />
              </Button>
              <span className="text-xs text-muted">
                {t("estimate", { cost: usd(THUMBNAIL_ESTIMATE_CREDITS) })}
              </span>
            </div>
          </div>
        ) : null}
        {mode === "text" && current?.text && current.scheme ? (
          <TextEditor version={current} scheme={current.scheme} onDone={() => setMode("none")} />
        ) : null}
      </CardBody>
    </Card>
  );
}

function ScoreBox({ score }: { score: NonNullable<ThumbnailVersion["score"]> }) {
  const t = useTranslations("thumbnails");
  return (
    <details className="rounded-lg border border-border px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-2 text-xs">
        <Badge tone={scoreTone(score.score)}>{t("score", { score: score.score })}</Badge>
        <span className="text-muted">{score.improve}</span>
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {score.criteria.map((c) => (
          <li key={c.key} className="flex gap-2">
            {c.ok ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
            ) : (
              <X className="mt-0.5 size-3.5 shrink-0 text-critical" />
            )}
            <span>
              <span className="font-medium">{t(`criteria.${c.key}`)}:</span> {c.note}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TextEditor({
  version,
  scheme,
  onDone,
}: {
  version: ThumbnailVersion;
  scheme: SchemeId;
  onDone: () => void;
}) {
  const t = useTranslations("thumbnails");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(version.text?.lines.join(" ") ?? "");
  const [accent, setAccent] = useState(version.text?.accent ?? "");
  const [mirror, setMirror] = useState(version.mirror);
  const words = text.split(/\s+/).filter(Boolean);
  const accentValue = words.includes(accent) ? accent : (words.at(-1) ?? "");
  // Las reglas de texto del esquema, en vivo.
  const errors = words.length ? validateSchemeText(scheme, text, accentValue) : [];

  const save = () =>
    start(async () => {
      const res = await editThumbnailText(version.id, {
        text: text.trim(),
        accent: accentValue,
        mirror,
      });
      if (res.ok) {
        onDone();
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  return (
    <div className="space-y-2 rounded-lg bg-surface-muted p-3">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={40}
        aria-label={t("textLabel")}
        placeholder={t("textLabel")}
        className="h-8"
      />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          {t("accentWord")}
          <Select
            value={accentValue}
            onChange={(e) => setAccent(e.target.value)}
            className="h-8 w-auto"
          >
            {words.map((w, i) => (
              <option key={`${w}-${i}`} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </label>
        {THUMBNAIL_SCHEMES[scheme].mirror ? (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            {t("mirror")}
          </label>
        ) : null}
      </div>
      {errors.length ? (
        <ul role="alert" className="text-xs text-critical" data-testid="text-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">{t("textHint")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending || !words.length || errors.length > 0}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("applyText")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          <X className="size-4" />
        </Button>
        <span className="text-xs text-muted">
          {t("textEstimate", { cost: usd(THUMBNAIL_TEXT_ESTIMATE_CREDITS) })}
        </span>
      </div>
    </div>
  );
}

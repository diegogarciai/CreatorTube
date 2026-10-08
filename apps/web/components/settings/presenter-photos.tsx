"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageUp, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { PRESENTER_PHOTOS_MAX } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { addPresenterPhoto, deletePresenterPhoto } from "@/lib/actions/brand";
import type { PresenterPhotoView } from "@/lib/data/brand";
import { discardMedia, uploadMedia } from "@/lib/upload";
import { useActionError } from "@/lib/use-action-error";
import { errorMessage } from "@/lib/utils";

/** Fotos de referencia del presentador para las miniaturas. */
export function PresenterPhotos({
  channelId,
  photos,
  disabled,
}: {
  channelId: string;
  photos: PresenterPhotoView[];
  disabled?: boolean;
}) {
  const t = useTranslations("brand");
  const errorText = useActionError();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();
  const room = PRESENTER_PHOTOS_MAX - photos.length;

  const upload = (files: File[]) =>
    start(async () => {
      let done = 0;
      for (const file of files.slice(0, room)) {
        let path: string | null = null;
        try {
          path = await uploadMedia(channelId, "presenter", file);
          const res = await addPresenterPhoto(channelId, { path, label });
          if (!res.ok) throw new Error(res.error);
          done++;
        } catch (err) {
          if (path) await discardMedia(path).catch(() => undefined);
          toast.error(errorText(errorMessage(err)));
          break;
        }
      }
      if (files.length > room) toast.error(errorText("errors.too_many_photos"));
      if (done) {
        toast.success(t("uploaded", { count: done }));
        setLabel("");
        router.refresh();
      }
    });

  const remove = (id: string) => {
    if (!confirm(t("deletePhotoConfirm"))) return;
    start(async () => {
      const res = await deletePresenterPhoto(channelId, id);
      if (res.ok) router.refresh();
      else toast.error(errorText(res.error));
    });
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="flex gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
        <ShieldCheck className="size-4 shrink-0 text-accent" />
        <span>{t("privacy")}</span>
      </p>
      <p className="text-muted">{t("photosHint")}</p>

      {photos.length === 0 ? (
        <p className="text-muted">{t("noPhotos")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="space-y-1">
              <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-muted">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage
                  <img
                    src={p.url}
                    alt={p.label ?? t("photos")}
                    className="size-full object-cover"
                  />
                ) : null}
                {disabled ? null : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => remove(p.id)}
                    disabled={pending}
                    aria-label={t("deletePhoto")}
                    className="absolute top-1.5 right-1.5 h-7 px-2"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              {p.label ? <p className="truncate text-xs text-muted">{p.label}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {disabled || room <= 0 ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder={t("photoLabelPlaceholder")}
            aria-label={t("photoLabel")}
            className="h-8 w-56"
          />
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            aria-label={t("uploadPhotos")}
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
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
            {pending ? t("uploading") : t("uploadPhotos")}
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageUp, Pencil, Plus } from "lucide-react";
import { GEAR_CATEGORIES, GEAR_OWNERSHIP, type GearOwnership } from "@planificador/core";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { addGear, updateGear } from "@/lib/actions/gear";
import type { GearView } from "@/lib/data/gear";
import { discardMedia, uploadMedia } from "@/lib/upload";
import { useActionError } from "@/lib/use-action-error";
import { errorMessage } from "@/lib/utils";

/** Agregar o editar un equipo, con su foto. */
export function GearDialog({ channelId, gear }: { channelId: string; gear?: GearView }) {
  const t = useTranslations("gear");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [ownership, setOwnership] = useState<GearOwnership>(
    (gear?.ownership as GearOwnership) ?? "own",
  );
  const [file, setFile] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : removePhoto ? null : (gear?.photoUrl ?? null);

  function submit(form: FormData) {
    start(async () => {
      let path: string | null = null;
      try {
        if (file) path = await uploadMedia(channelId, "gear", file);
        const input = {
          name: form.get("name"),
          brand: form.get("brand"),
          model: form.get("model"),
          category: form.get("category"),
          ownership,
          acquiredOn: form.get("acquiredOn"),
          returnBy: form.get("returnBy") ?? "",
          affiliateUrl: String(form.get("affiliateUrl") ?? "").trim(),
          notes: form.get("notes"),
        };
        const photo = path ?? (removePhoto ? null : undefined);
        const res = gear
          ? await updateGear(channelId, gear.id, input, photo)
          : await addGear(channelId, input, photo);
        if (!res.ok) throw new Error(res.error);
        toast.success(gear ? t("saved") : t("added"));
        setOpen(false);
        setFile(null);
        setRemovePhoto(false);
        router.refresh();
      } catch (err) {
        if (path) await discardMedia(path).catch(() => undefined);
        toast.error(errorText(errorMessage(err)));
      }
    });
  }

  return (
    <>
      {gear ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={t("edit")}>
          <Pencil className="size-3.5" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} data-testid="add-gear">
          <Plus className="size-4" /> {t("add")}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={gear ? t("edit") : t("add")}>
        <form action={submit} className="grid gap-4 sm:grid-cols-2" data-testid="gear-form">
          <Field label={t("field.name")} htmlFor="g-name" className="sm:col-span-2">
            <Input
              id="g-name"
              name="name"
              required
              maxLength={120}
              defaultValue={gear?.name}
              placeholder={t("namePlaceholder")}
              autoFocus
            />
          </Field>
          <Field label={t("field.brand")} htmlFor="g-brand">
            <Input id="g-brand" name="brand" maxLength={80} defaultValue={gear?.brand} />
          </Field>
          <Field label={t("field.model")} htmlFor="g-model">
            <Input id="g-model" name="model" maxLength={120} defaultValue={gear?.model} />
          </Field>
          <Field label={t("field.category")} htmlFor="g-category">
            <Select id="g-category" name="category" defaultValue={gear?.category ?? "other"}>
              {GEAR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("field.ownership")} htmlFor="g-ownership">
            <Select
              id="g-ownership"
              value={ownership}
              onChange={(e) => setOwnership(e.target.value as GearOwnership)}
            >
              {GEAR_OWNERSHIP.map((o) => (
                <option key={o} value={o}>
                  {t(`ownership.${o}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("field.acquiredOn")} htmlFor="g-acquired">
            <Input
              id="g-acquired"
              name="acquiredOn"
              type="date"
              defaultValue={gear?.acquired_on ?? ""}
            />
          </Field>
          {ownership === "loan" ? (
            <Field label={t("field.returnBy")} htmlFor="g-return">
              <Input
                id="g-return"
                name="returnBy"
                type="date"
                defaultValue={gear?.return_by ?? ""}
              />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          {ownership !== "own" ? (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs sm:col-span-2">
              {t("disclosureHint")}
            </p>
          ) : null}
          <Field
            label={t("field.affiliateUrl")}
            htmlFor="g-affiliate"
            hint={t("affiliateHint")}
            className="sm:col-span-2"
          >
            <Input
              id="g-affiliate"
              name="affiliateUrl"
              type="url"
              maxLength={500}
              placeholder="https://"
              defaultValue={gear?.affiliate_url ?? ""}
            />
          </Field>
          <Field label={t("field.notes")} htmlFor="g-notes" className="sm:col-span-2">
            <Textarea
              id="g-notes"
              name="notes"
              maxLength={2000}
              defaultValue={gear?.notes}
              placeholder={t("notesPlaceholder")}
            />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-muted">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- vista previa local o URL firmada
                <img src={preview} alt="" className="size-full object-cover" />
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setRemovePhoto(false);
              }}
              aria-label={t("photo")}
            />
            <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
              <ImageUp className="size-3.5" /> {preview ? t("changePhoto") : t("addPhoto")}
            </Button>
            {preview ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setRemovePhoto(true);
                }}
              >
                {t("removePhoto")}
              </Button>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="gear-save">
              {pending ? tc("saving") : tc("save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

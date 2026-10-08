"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import type { AiStage } from "@planificador/ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { refreshAiModels, setModelPrices, setWorkspaceAiSettings } from "@/lib/actions/admin";
import { useActionError } from "@/lib/use-action-error";

export type AiModelRow = {
  id: string;
  displayName: string;
  available: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
};

export type WorkspaceAiRow = {
  defaultModel: string | null;
  stageModels: Partial<Record<AiStage, string>>;
};

/** Catálogo de modelos de la cuenta, con su precio para los créditos. */
export function AiModelsCatalog({
  models,
  jobsConfigured,
}: {
  models: AiModelRow[];
  jobsConfigured: boolean;
}) {
  const t = useTranslations("aiModels");
  const errorText = useActionError();
  const [pending, start] = useTransition();

  const refresh = () =>
    start(async () => {
      const res = await refreshAiModels();
      if (res.ok) toast.success(t("refreshStarted"));
      else toast.error(errorText(res.error));
    });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={refresh} disabled={!jobsConfigured || pending}>
          <RefreshCw className="size-4" /> {t("refresh")}
        </Button>
        <span className="text-xs text-muted">{t("refreshHint")}</span>
      </div>
      {models.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {models.map((m) => (
            <ModelPriceRow key={m.id} model={m} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">{t("pricesHint")}</p>
    </div>
  );
}

function ModelPriceRow({ model }: { model: AiModelRow }) {
  const t = useTranslations("aiModels");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2">
      <div className="min-w-48 flex-1">
        <p className="font-medium">{model.displayName || model.id}</p>
        <p className="font-mono text-xs text-muted">{model.id}</p>
      </div>
      {model.available ? null : <Badge tone="warn">{t("unavailable")}</Badge>}
      {model.inputPrice === null || model.outputPrice === null ? (
        <Badge>{t("noPrice")}</Badge>
      ) : null}
      <form
        className="flex flex-wrap items-center gap-2"
        action={(form) =>
          start(async () => {
            const res = await setModelPrices(model.id, form.get("input"), form.get("output"));
            if (res.ok) {
              toast.success(tc("saved"));
              router.refresh();
            } else toast.error(errorText(res.error));
          })
        }
      >
        <label className="flex items-center gap-1 text-xs text-muted">
          {t("input")}
          <Input
            name="input"
            type="number"
            min={0}
            step="0.01"
            defaultValue={model.inputPrice ?? ""}
            className="h-8 w-20"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          {t("output")}
          <Input
            name="output"
            type="number"
            min={0}
            step="0.01"
            defaultValue={model.outputPrice ?? ""}
            className="h-8 w-20"
          />
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {tc("save")}
        </Button>
      </form>
    </li>
  );
}

/** El modelo de un espacio: uno por defecto y, si se quiere, uno por etapa. */
export function WorkspaceAiForm({
  workspaceId,
  models,
  settings,
  stages,
}: {
  workspaceId: string;
  models: AiModelRow[];
  settings: WorkspaceAiRow | null;
  /** Las etapas que llaman a la IA (vienen del servidor: el panel no carga la lógica de IA). */
  stages: readonly AiStage[];
}) {
  const t = useTranslations("aiModels");
  const tc = useTranslations("common");
  const errorText = useActionError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [defaultModel, setDefaultModel] = useState(settings?.defaultModel ?? "");
  const [stageModels, setStageModels] = useState<Partial<Record<AiStage, string>>>(
    settings?.stageModels ?? {},
  );
  const options = models.filter(
    (m) => m.available || m.id === defaultModel || Object.values(stageModels).includes(m.id),
  );
  const overrides = Object.values(stageModels).filter(Boolean).length;

  const save = () =>
    start(async () => {
      const res = await setWorkspaceAiSettings(workspaceId, {
        defaultModel: defaultModel || null,
        stageModels: Object.fromEntries(Object.entries(stageModels).filter(([, v]) => v)),
      });
      if (res.ok) {
        toast.success(tc("saved"));
        router.refresh();
      } else toast.error(errorText(res.error));
    });

  return (
    <div className="w-full space-y-2 rounded-lg bg-surface-muted px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t("defaultModel")}</span>
        <Select
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          aria-label={t("defaultModel")}
          className="h-8 w-auto min-w-56"
        >
          <option value="">{t("platformDefault")}</option>
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName || m.id}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={save} disabled={pending}>
          {tc("save")}
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted">
          {t("byStage", { count: overrides })}
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {stages.map((stage) => (
            <label key={stage} className="flex items-center justify-between gap-2 text-xs">
              <span>{t(`stage.${stage}`)}</span>
              <Select
                value={stageModels[stage] ?? ""}
                onChange={(e) => setStageModels((prev) => ({ ...prev, [stage]: e.target.value }))}
                className="h-8 w-auto min-w-48"
              >
                <option value="">{t("sameAsDefault")}</option>
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.id}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

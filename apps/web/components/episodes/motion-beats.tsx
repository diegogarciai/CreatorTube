"use client";

import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { AidIconView } from "@planificador/motion/icons";
import {
  actionLabel,
  AID_ICON_GROUPS,
  isAidIcon,
  BEAT_ACTIONS,
  beatCreates,
  beatTargets,
  beatTimeline,
  caseLabel,
  elementsFromBeats,
  PIECE_ACTIONS,
  type AidBeat,
  type AidPiece,
  type BeatAction,
} from "@planificador/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import type { VisualAidView } from "@/lib/data/visual-aids";

/**
 * El guion de animación de una M (12.5 y 12.6): cada momento con su tiempo,
 * la frase del guion que lo dispara y lo que pasa en pantalla.
 */
export function BeatList({ aid }: { aid: VisualAidView }) {
  const t = useTranslations("visualAids");
  const times = beatTimeline(aid.beats, aid.durationS ?? 0);
  const targets = beatTargets(aid.beats);
  const elements = elementsFromBeats(aid.beats);
  return (
    <div className="space-y-1" data-testid={`beats-${aid.code}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-muted">
        {aid.aidCase ? <Badge>{caseLabel(aid.aidCase)}</Badge> : null}
        <span>{t("storyboard", { count: aid.beats.length })}</span>
      </p>
      <ol className="space-y-1">
        {aid.beats.map((b, i) => {
          const el = elements[targets[i] ?? -1];
          const what = beatCreates(b)
            ? [b.value, b.unit, b.text].filter(Boolean).join(" ")
            : [el?.text, b.action === "change" ? [b.value, b.unit].filter(Boolean).join(" ") : ""]
                .filter(Boolean)
                .join(" → ");
          return (
            <li key={i} className="flex gap-2">
              <span className="w-10 shrink-0 font-mono text-muted tabular-nums">
                {times[i]!.start.toFixed(1)} s
              </span>
              <span className="min-w-0">
                <span className="text-muted">«{b.phrase}»</span>{" "}
                {isAidIcon(b.icon) ? (
                  <AidIconView
                    name={b.icon}
                    size={14}
                    color="currentColor"
                    style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }}
                  />
                ) : null}
                <span className="font-medium">
                  → {actionLabel(b.action)}: {what}
                </span>
                {b.value && b.row ? (
                  <span className="text-muted"> {t("row", { row: b.row })}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Edita los momentos: frase, acción, sobre qué elemento, y texto o cifra con su fila. */
export function BeatsEditor({
  beats,
  piece,
  onChange,
}: {
  beats: AidBeat[];
  piece: AidPiece | null;
  onChange: (beats: AidBeat[]) => void;
}) {
  const t = useTranslations("visualAids");
  const actions = piece ? PIECE_ACTIONS[piece] : BEAT_ACTIONS;
  const elements = elementsFromBeats(beats);
  const set = (i: number, patch: Partial<AidBeat>) =>
    onChange(beats.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  // Cuántos elementos ya entraron antes de cada momento (los posibles blancos).
  const before = beats.map((_, i) => beats.slice(0, i).filter(beatCreates).length);
  return (
    <div className="space-y-2" data-testid="beats-editor">
      <span>{t("fieldBeats")}</span>
      {beats.map((b, i) => {
        const creates = b.action === "enter";
        const numeric = creates || b.action === "change";
        return (
          <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="flex gap-1.5">
              <span className="pt-1.5 font-mono text-muted">{i + 1}</span>
              <Input
                value={b.phrase}
                onChange={(e) => set(i, { phrase: e.target.value })}
                aria-label={t("fieldPhrase", { n: i + 1 })}
                className="h-8 flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(beats.filter((_, j) => j !== i))}
                aria-label={t("removeBeat")}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-4">
              <Select
                value={b.action}
                onChange={(e) => {
                  const action = e.target.value as BeatAction;
                  set(
                    i,
                    action === "enter"
                      ? { action, target: null, text: b.text ?? "" }
                      : { action, target: b.target ?? 0, text: null },
                  );
                }}
                aria-label={t("fieldAction", { n: i + 1 })}
                className="h-8 w-40"
              >
                {actions.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(a)}
                  </option>
                ))}
              </Select>
              {creates ? (
                <Input
                  value={b.text ?? ""}
                  onChange={(e) => set(i, { text: e.target.value })}
                  placeholder={t("fieldBeatText")}
                  aria-label={t("fieldBeatText")}
                  className="h-8 min-w-40 flex-1"
                />
              ) : (
                <Select
                  value={String(b.target ?? 0)}
                  onChange={(e) => set(i, { target: Number(e.target.value) })}
                  aria-label={t("fieldTarget", { n: i + 1 })}
                  className="h-8 min-w-40 flex-1"
                >
                  {elements.slice(0, Math.max(before[i]!, 1)).map((el, k) => (
                    <option key={k} value={k}>
                      {el.text}
                    </option>
                  ))}
                </Select>
              )}
              {numeric ? (
                <Select
                  value={b.icon ?? ""}
                  onChange={(e) =>
                    set(i, { icon: isAidIcon(e.target.value) ? e.target.value : null })
                  }
                  aria-label={t("fieldIcon", { n: i + 1 })}
                  className="h-8 w-40"
                >
                  <option value="">{t("noIcon")}</option>
                  {Object.entries(AID_ICON_GROUPS).map(([group, icons]) => (
                    <optgroup key={group} label={group}>
                      {icons.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon.replace(/_/g, " ")}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              ) : null}
              {numeric ? (
                <>
                  <Input
                    value={b.value ?? ""}
                    onChange={(e) => set(i, { value: e.target.value || null })}
                    placeholder={t("fieldValue")}
                    aria-label={t("fieldValue")}
                    className="h-8 w-20"
                  />
                  <Input
                    value={b.unit ?? ""}
                    onChange={(e) => set(i, { unit: e.target.value || null })}
                    placeholder={t("fieldUnit")}
                    aria-label={t("fieldUnit")}
                    className="h-8 w-16"
                  />
                  <Input
                    value={b.row ? String(b.row) : ""}
                    onChange={(e) =>
                      set(i, { row: Number(e.target.value.replace("#", "")) || null })
                    }
                    placeholder="#"
                    aria-label={t("fieldBeatRow")}
                    className="h-8 w-14"
                  />
                </>
              ) : null}
            </div>
          </div>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        disabled={beats.length >= 8}
        onClick={() => onChange([...beats, { phrase: "", action: "highlight", target: 0 }])}
      >
        <Plus className="size-3.5" /> {t("addBeat")}
      </Button>
    </div>
  );
}

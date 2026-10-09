import type { Claim } from "@planificador/ai";
import type { Tables } from "@planificador/db";

/** Una fila de `verification_items` como la afirmación que usan los prompts. */
export const claimFromRow = (r: Tables<"verification_items">): Claim => ({
  idx: r.idx,
  kind: r.kind as Claim["kind"],
  claim: r.claim,
  line: r.line,
  occurrences: r.occurrences,
  status: r.status as Claim["status"],
  nature: r.nature as Claim["nature"],
  url: r.url,
  sourceTitle: r.source_title,
  quote: r.quote,
  date: r.data_date,
  value: r.value,
  note: r.note,
});

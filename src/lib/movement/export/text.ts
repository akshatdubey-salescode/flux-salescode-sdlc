import { renderText } from "../checklist";
import { fmtTs } from "./common";
import type { ExportModel } from "./model";

/** The Copy text, with a standalone header so a pasted or downloaded file says what it is and who has signed. */
export function renderTextExport(model: ExportModel): string {
  const m = model.movement;
  const who = (s: ExportModel["signers"][number]) => `${s.slot} ${s.name || s.email || "(nobody named)"}: ${s.signed ? (s.signedCurrent ? "signed" : "signed an older checklist") : "waiting"}`;
  const head = [
    `Delivery: ${model.delivery.name} (${model.delivery.date}). Environment: ${m.environment.toUpperCase()}. Status: ${m.status}.`,
    `Sign-offs: ${model.signers.map(who).join("; ")}.`,
    `Checklist ${m.hash.slice(0, 12)}. Exported ${fmtTs(model.generatedAt) || model.generatedAt}.`,
  ];
  return `${head.join("\n")}\n\n${renderText(model.checklist)}`;
}

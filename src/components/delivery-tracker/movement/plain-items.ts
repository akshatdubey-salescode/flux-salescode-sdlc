/**
 * Plain wording for the "All items" list of the Checklist tab (pure): every item's text goes through `plainify`, with ONE deduper over the
 * whole checklist in section order, so a fact that two items state (the same service line in "Services to deploy" and in the Jira rows, the
 * same "Previous data fix" in two places) is shown once. The section copy texts are built from the same plain items.
 */
import type { Checklist, ChecklistItem, ChecklistSection } from "./api-types";
import { parseCoverItem } from "./jira-checklist";
import { isEmptyPlain, makeDeduper, plainCopy, plainify, type Plain } from "./plain-text";

export interface PlainItems {
  /** item id -> its plain text. Items with a structured config are not here (they show their own cells). */
  byId: Map<string, Plain>;
  /** Items whose every sentence was already shown by an earlier item. */
  repeats: Set<string>;
}

/** The texts that are structured facts (a config key with its environments) rather than free text. */
const isStructured = (it: ChecklistItem): boolean => !!it.config || !!it.answers?.length;

/** "channelkart#1147 master 33e8209192 19 Nov APIs, guard (approved ...) [merged]" -> "channelkart#1147 — 19 Nov APIs, guard (approved ...) (master, 33e8209192, merged)". */
export function itemText(it: Pick<ChecklistItem, "key" | "text">): string {
  const p = it.key.startsWith("cover:") ? parseCoverItem(it) : null;
  if (!p) return it.text;
  const meta = [p.branch, p.commit ? p.commit.slice(0, 10) : "", p.state].filter(Boolean).join(", ");
  return `${p.pr}${p.note ? ` — ${p.note}` : ""}${meta ? ` (${meta})` : ""}${p.noApproval && !/no formal approval/i.test(p.note ?? "") ? " — no formal approval" : ""}`;
}

const STATE_WORD: Record<string, string> = { done: "Done", not_done: "Not done", unknown: "Not known yet", yes: "Yes", no: "No", not_required: "Not required", other: "" };

/** A release-page row merged over several Jiras: its question and each answer once, with the Jiras that gave it and the words they wrote. */
export function answerList(it: Pick<ChecklistItem, "text" | "answers">): { label: string; answers: Array<{ word: string; jiras: string[]; plain: Plain }> } | null {
  if (!it.answers?.length) return null;
  const at = it.text.indexOf(": ");
  const label = at > 0 ? it.text.slice(0, at) : it.text;
  return { label, answers: it.answers.map((a) => ({ word: STATE_WORD[a.state] ?? "", jiras: a.jiras, plain: plainify(a.text, { maxLead: 200 }) })) };
}

export function plainItems(cl: Pick<Checklist, "sections">): PlainItems {
  const dedupe = makeDeduper();
  const byId = new Map<string, Plain>();
  const repeats = new Set<string>();
  for (const s of cl.sections)
    for (const it of s.items) {
      if (isStructured(it)) continue;
      const own = plainify(itemText(it), { maxLead: 160 });
      const p = plainify(itemText(it), { dedupe, maxLead: 160 });
      if (isEmptyPlain(p) && !isEmptyPlain(own)) repeats.add(it.id);
      byId.set(it.id, isEmptyPlain(p) ? own : p);
    }
  return { byId, repeats };
}

const envLine = (it: ChecklistItem): string => (it.env ? ` | demo: ${it.env.values.demo ?? "not set"}, uat: ${it.env.values.uat ?? "not set"}, prod: ${it.env.values.prod ?? "not set"}` : "");

/** One section as text for the clipboard: "N. Title", then each item as a line with its points under it (repeats of an earlier item are left out). */
export function sectionPlainText(section: ChecklistSection, plain: PlainItems, heading?: { environment: string; deliveryName: string }): string {
  const L: string[] = [`${section.number}. ${section.title}${heading ? ` (${heading.environment.toUpperCase()} movement: ${heading.deliveryName})` : ""}`];
  for (const it of section.items) {
    if (it.config) {
      L.push(`- ${it.config.key}${it.config.store ? ` | where: ${it.config.store}` : ""}${it.config.default !== undefined ? ` | default: ${it.config.default}` : ""}${envLine(it)}`);
      continue;
    }
    const al = answerList(it);
    if (al) {
      L.push(`- ${al.label}`);
      for (const a of al.answers) {
        const lines = plainCopy(a.plain);
        const head = `${a.word ? `${a.word}: ` : ""}${a.jiras.join(", ")}`;
        L.push(`    - ${head}${lines.length ? ` — ${lines[0].trimStart()}` : ""}`);
        for (const l of lines.slice(1)) L.push(`        ${l}`);
      }
      continue;
    }
    if (plain.repeats.has(it.id)) continue;
    const p = plain.byId.get(it.id);
    if (!p) continue;
    const flag = it.severity === "blocker" ? "[Blocker] " : it.label && it.severity === "warn" ? `[${it.label}] ` : it.severity === "warn" ? "[Warn] " : "";
    const lines = plainCopy(p);
    lines.forEach((l, i) => L.push(i === 0 ? `- ${flag}${l.trimStart()}` : `  ${l}`));
  }
  return L.join("\n");
}

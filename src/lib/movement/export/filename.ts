/** File names for the exports: ASCII, no path or header-breaking characters, bounded. */
import type { MovementEnvironment } from "../values";

export type ExportFormat = "xlsx" | "text" | "html";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["xlsx", "text", "html"];
export const isExportFormat = (v: unknown): v is ExportFormat => typeof v === "string" && (EXPORT_FORMATS as readonly string[]).includes(v);

/** The `format` query value, case-insensitive ("XLSX", "Text"); null when it is not one of the three. */
export function parseFormat(v: string | null): ExportFormat | null {
  const f = (v ?? "xlsx").trim().toLowerCase();
  return isExportFormat(f) ? f : null;
}

const EXT: Record<ExportFormat, string> = { xlsx: "xlsx", text: "txt", html: "html" };
export const CONTENT_TYPE: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  text: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
};

/** `movement-prod-<delivery name>-<date>.xlsx`: only [A-Za-z0-9._-], at most 80 characters before the extension. */
export function exportFilename(deliveryName: string, environment: MovementEnvironment, deliveryDate: string, format: ExportFormat): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ? deliveryDate : "";
  const base = [`movement-${environment}`, slug(deliveryName).slice(0, 50), date].filter(Boolean).join("-").slice(0, 80).replace(/-+$/g, "");
  return `${base}.${EXT[format]}`;
}

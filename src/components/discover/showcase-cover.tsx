import { imageUrl } from "@/lib/discover/core";
import { cn } from "@/lib/utils";

// Deterministic gradient per showcase, used when there's no cover image.
const PALETTES = [
  ["#0f766e", "#14b8a6"],
  ["#1d4ed8", "#60a5fa"],
  ["#7c3aed", "#c084fc"],
  ["#be123c", "#fb7185"],
  ["#b45309", "#fbbf24"],
  ["#15803d", "#4ade80"],
  ["#334155", "#94a3b8"],
  ["#a21caf", "#f0abfc"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function ShowcaseCover({
  id,
  title,
  coverImageId,
  className,
}: {
  id: string;
  title: string;
  coverImageId: string | null;
  className?: string;
}) {
  if (coverImageId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl(coverImageId)}
        alt=""
        loading="lazy"
        className={cn("aspect-[16/9] w-full object-cover bg-zinc-100 dark:bg-zinc-800", className)}
      />
    );
  }
  const [from, to] = PALETTES[hash(id) % PALETTES.length];
  const initial = (title.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      aria-hidden
      className={cn("aspect-[16/9] w-full flex items-center justify-center", className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
    >
      <span className="text-5xl font-bold text-white/90 drop-shadow-sm">{initial}</span>
    </div>
  );
}

import { RiCompass3Line } from "@remixicon/react";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { FeedControls } from "@/components/discover/feed-controls";
import { ShareToolButton } from "@/components/discover/share-tool-button";
import { ShowcaseCard } from "@/components/discover/showcase-card";
import { normalizeTag } from "@/lib/discover/core";
import { listMyShowcases, listPublishedShowcases } from "@/lib/discover/service";

export default async function DiscoverPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const tab = str("tab") === "mine" ? "mine" : "all";
  const q = str("q").trim().slice(0, 200);
  const tag = normalizeTag(str("tag"));
  const sort = str("sort") === "popular" ? "popular" : "newest";

  const [mine, feed] = await Promise.all([
    listMyShowcases(user.id),
    tab === "all" ? listPublishedShowcases({ viewerId: user.id, q, tag, sort }) : Promise.resolve([]),
  ]);
  const items = tab === "mine" ? mine : feed;
  const filtered = Boolean(q || tag);

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader
        actions={<ShareToolButton />}
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Discover</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 space-y-6 p-6 lg:px-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Discover</h1>
          <p className="max-w-xl text-sm text-zinc-500 dark:text-zinc-400">
            Internal tools your colleagues have built. Find something useful, or share what you&apos;ve made.
          </p>
        </div>

        <FeedControls mineCount={mine.length} />

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
            <RiCompass3Line size={32} className="text-zinc-400" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {tab === "mine"
                ? "You haven't shared any tools yet."
                : filtered
                  ? "No showcases match. Try a different search or tag."
                  : "Nothing here yet. Be the first to share a tool."}
            </p>
            {!filtered && (
              <ShareToolButton variant="outline" />
            )}
          </div>
        ) : (
          <div className="grid gap-x-6 gap-y-10 pt-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((s) => (
              <ShowcaseCard key={s.id} s={s} showStatus={tab === "mine"} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

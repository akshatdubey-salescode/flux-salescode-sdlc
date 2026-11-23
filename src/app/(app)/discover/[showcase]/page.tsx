import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { RiExternalLinkLine, RiGithubLine, RiPlayCircleLine } from "@remixicon/react";
import { requireAuth } from "@/lib/auth/server";
import { PageHeader } from "@/components/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Comments } from "@/components/discover/comments";
import { ShowcaseActions } from "@/components/discover/showcase-actions";
import { UpvoteButton } from "@/components/discover/upvote-button";
import { imageUrl, parseShowcaseParam, showcasePath, videoEmbed } from "@/lib/discover/core";
import { canEdit, canView, getShowcaseByShortId, isDiscoverAdmin, listComments } from "@/lib/discover/service";

export default async function ShowcasePage(props: { params: Promise<{ showcase: string }> }) {
  const user = await requireAuth();
  const { showcase: param } = await props.params;
  const parsed = parseShowcaseParam(param);
  if (!parsed) notFound();

  const s = await getShowcaseByShortId(parsed.shortId, user.id);
  if (!s || !canView(user, s)) notFound();
  // Renamed since the link was shared: send to the current URL.
  if (parsed.slug !== s.slug) redirect(showcasePath(s));

  const comments = await listComments(s.id);
  const isAuthor = canEdit(user, s);
  const isAdmin = isDiscoverAdmin(user);
  const embed = videoEmbed(s.demoVideoUrl);
  const path = showcasePath(s);
  const edited = s.publishedAt && s.updatedAt.getTime() - s.publishedAt.getTime() > 60_000;

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/discover">Discover</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-xs truncate">{s.title || "Untitled showcase"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <article className="mx-auto max-w-3xl space-y-6">
          {s.status === "draft" && (
            <div
              className={
                s.takenDownReason
                  ? "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  : "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
              }
            >
              {s.takenDownReason ? (
                <>
                  <strong>Taken down by an admin:</strong> {s.takenDownReason}
                  <br />
                  Only you and admins can see it. Edit it to address this, then publish again.
                </>
              ) : (
                "This is a draft. Only you can see it until you publish."
              )}
            </div>
          )}

          {s.coverImageId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl(s.coverImageId)}
              alt=""
              className="aspect-[16/9] w-full rounded-xl border border-zinc-200 object-cover dark:border-zinc-800"
            />
          )}

          <header className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {s.title || "Untitled showcase"}
            </h1>
            {s.tagline && <p className="text-lg text-zinc-600 dark:text-zinc-300">{s.tagline}</p>}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              By <span className="font-medium text-zinc-700 dark:text-zinc-200">{s.authorName}</span>
              {s.publishedAt && <> · Published {format(s.publishedAt, "d MMM yyyy")}</>}
              {edited && <> · Updated {format(s.updatedAt, "d MMM yyyy")}</>}
            </p>
            {s.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {s.tags.map((t) => (
                  <Link key={t} href={`/discover?tag=${encodeURIComponent(t)}`}>
                    <Badge variant="outline">#{t}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </header>

          <div className="flex flex-wrap items-center gap-2 border-y border-zinc-200 py-3 dark:border-zinc-800">
            <UpvoteButton
              showcaseId={s.id}
              upvoted={s.viewerUpvoted}
              count={s.upvoteCount}
              disabled={s.status !== "published"}
            />
            {s.liveUrl && (
              <Button asChild variant="outline" size="lg">
                <a href={s.liveUrl} target="_blank" rel="noopener noreferrer">
                  <RiExternalLinkLine />
                  Open tool
                </a>
              </Button>
            )}
            {s.repoUrl && (
              <Button asChild variant="outline" size="lg">
                <a href={s.repoUrl} target="_blank" rel="noopener noreferrer">
                  <RiGithubLine />
                  Repository
                </a>
              </Button>
            )}
            {s.demoVideoUrl && !embed && (
              <Button asChild variant="outline" size="lg">
                <a href={s.demoVideoUrl} target="_blank" rel="noopener noreferrer">
                  <RiPlayCircleLine />
                  Watch demo
                </a>
              </Button>
            )}
            <div className="ml-auto">
              <ShowcaseActions
                id={s.id}
                editHref={`${path}/edit`}
                status={s.status}
                isAuthor={isAuthor}
                isAdmin={isAdmin}
              />
            </div>
          </div>

          {embed && (
            <div className="aspect-video overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
              <iframe
                src={embed.src}
                title="Demo video"
                className="h-full w-full"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              />
            </div>
          )}

          <div className="text-[15px]">
            <Markdown content={s.body} />
          </div>

          <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <Comments
              comments={comments}
              showcaseId={s.id}
              viewerId={user.id}
              isAdmin={isAdmin}
              canComment={s.status === "published"}
            />
          </div>
        </article>
      </main>
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
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
import { parseShowcaseParam, showcasePath } from "@/lib/discover/core";
import { canEdit, getShowcaseByShortId, listTags } from "@/lib/discover/service";
import { ShowcaseEditor } from "./showcase-editor";

export default async function EditShowcasePage(props: { params: Promise<{ showcase: string }> }) {
  const user = await requireAuth();
  const { showcase: param } = await props.params;
  const parsed = parseShowcaseParam(param);
  if (!parsed) notFound();

  const s = await getShowcaseByShortId(parsed.shortId, user.id);
  if (!s || !canEdit(user, s)) notFound();
  if (parsed.slug !== s.slug) redirect(`${showcasePath(s)}/edit`);

  const tags = await listTags();

  return (
    <div className="flex flex-col min-h-svh">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/discover?tab=mine">Discover</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-xs truncate">
                {s.title ? `Edit "${s.title}"` : "New showcase"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <main className="flex-1 p-6">
        <ShowcaseEditor
          id={s.id}
          status={s.status}
          takenDownReason={s.takenDownReason}
          initialPath={showcasePath(s)}
          initialUpdatedAt={s.updatedAt.toISOString()}
          tagSuggestions={tags.map((t) => t.tag)}
          initial={{
            title: s.title,
            tagline: s.tagline,
            body: s.body,
            coverImageId: s.coverImageId,
            repoUrl: s.repoUrl ?? "",
            liveUrl: s.liveUrl ?? "",
            demoVideoUrl: s.demoVideoUrl ?? "",
            tags: s.tags,
          }}
        />
      </main>
    </div>
  );
}

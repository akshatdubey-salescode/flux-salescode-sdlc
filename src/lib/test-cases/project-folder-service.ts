// Looks up (or picks, once) the bucket folder for a project's test-case files.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tcProjectFolders } from "@/lib/db/schema";
import { folderCandidates } from "./project-folder";

export async function getProjectFolder(project: { id: string; name: string; key: string }): Promise<string> {
  const existing = async () =>
    (await db.select({ folder: tcProjectFolders.folder }).from(tcProjectFolders).where(eq(tcProjectFolders.projectId, project.id)).limit(1))[0]?.folder;

  const known = await existing();
  if (known) return known;

  for (const folder of folderCandidates(project.name, project.key)) {
    // A conflict means either another project already took this folder name, or this project's own
    // row was just created by a concurrent request; the unique indexes settle both without a race.
    const inserted = await db
      .insert(tcProjectFolders)
      .values({ projectId: project.id, folder })
      .onConflictDoNothing()
      .returning({ folder: tcProjectFolders.folder });
    if (inserted[0]) return inserted[0].folder;
    const raced = await existing();
    if (raced) return raced;
  }
  throw new Error("Could not choose a storage folder for this project");
}

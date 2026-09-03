"use client";

// The "How sprints work" explainer, in a modal opened from a button next to
// the tab's controls — mirrors MetricMeaningModal's placement/pattern on the
// performance-review page. Every rule the tracker enforces is written down
// here so anyone creating or reading a sprint knows exactly what the numbers
// mean and what each action does; the tab itself stays uncluttered.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RiQuestionLine } from "@remixicon/react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold">{title}</h3>
      <div className="space-y-1.5 text-xs/relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export function SprintGuide({ trigger }: { trigger?: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <RiQuestionLine className="size-3.5" />
            How sprints work
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>How sprints work</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Section title="What a sprint is">
            <p>
              A sprint is an internal, time-boxed iteration: a start date, an end date, an optional goal, and the
              Jira issues the team commits to finishing inside that window. Unlike Delivery Tracking (which is a
              promise to a client), sprints exist for the team — they measure how well we plan and what changes
              mid-flight.
            </p>
          </Section>

          <Section title="The three phases">
            <p>
              <span className="font-medium text-foreground">Planned</span> — the sprint has been created but not
              started. Add and remove candidate issues freely; nothing is being measured yet.
            </p>
            <p>
              <span className="font-medium text-foreground">Active</span> — someone pressed{" "}
              <span className="font-medium text-foreground">Start sprint</span>. The sprint runs until it is
              explicitly completed. Only <span className="font-medium text-foreground">one sprint per project</span>{" "}
              can be active at a time — finish the current one before starting the next.
            </p>
            <p>
              <span className="font-medium text-foreground">Completed</span> — the sprint was closed. Closed sprints
              are read-only (reopen one to change it) and hide behind the “Show completed” toggle.
            </p>
          </Section>

          <Section title="The commitment — locked at start">
            <p>
              The moment a sprint is started, every issue in it becomes the{" "}
              <span className="font-medium text-foreground">commitment</span>. That snapshot never silently changes —
              it is the baseline every later number is measured against. This is why the start is an explicit button,
              not a date: the commitment is taken when the team says “go”, exactly like starting a sprint on a Scrum
              board.
            </p>
          </Section>

          <Section title="Scope changes are visible, in both directions">
            <p>
              Issues added <em>after</em> the sprint starts are <em>not</em> part of the commitment. They show with an
              amber <span className="font-medium text-foreground">“Added &lt;date&gt; *”</span> marker — the asterisk
              is the same convention Jira&apos;s sprint report uses for scope added after start — and adding them{" "}
              <span className="font-medium text-foreground">requires a written reason</span>, which shows on the card
              and in the report.
            </p>
            <p>
              Issues removed from an active sprint are not erased — removal also{" "}
              <span className="font-medium text-foreground">requires a reason</span>, and the item moves to a{" "}
              <span className="font-medium text-foreground">“removed after start”</span> list on the card, with who
              removed it, when, and why. There is no silent scope change in either direction. Removing an issue from a
              sprint that is still planned, by contrast, is just planning and leaves no trace.
            </p>
          </Section>

          <Section title="Progress comes from Jira, never by hand">
            <p>
              An item counts as to&nbsp;do / in&nbsp;progress / done purely from its live Jira status. Nobody marks a
              sprint item done in this tab — move the ticket in Jira and the sprint reflects it on the next sync. The
              progress bar is simply “issues in a done status / all issues currently in the sprint”.
            </p>
          </Section>

          <Section title="Completing a sprint and spillover">
            <p>
              Sprints close on schedule, finished or not — there is deliberately no “everything must be done” gate.
              When you press <span className="font-medium text-foreground">Complete sprint</span>, you decide what
              happens to unfinished items:
            </p>
            <p>
              <span className="font-medium text-foreground">Carry over</span> copies them into another open sprint,
              marked “↩ from &lt;sprint&gt;”. They also stay in the closed sprint as its spillover record — the closed
              sprint&apos;s report keeps telling the truth about what didn&apos;t get done. Or{" "}
              <span className="font-medium text-foreground">leave them</span>, and decide later from the backlog.
              Carried items joining a sprint that already started count as scope added after start; joining a planned
              sprint, they become part of its commitment when it starts.
            </p>
          </Section>

          <Section title="Reading the report line">
            <p>
              Every started sprint shows:{" "}
              <span className="font-medium text-foreground">
                Committed N · completed M of N (%) · added after start * · removed · carried in
              </span>
              . The completion percentage is measured against the commitment only — work added mid-sprint never
              inflates it. The <span className="font-medium text-foreground">velocity</span> line at the top averages
              committed-issues-completed across the last closed sprints, so planning the next sprint has a number to
              lean on.
            </p>
          </Section>

          <Section title="Comments and reports">
            <p>
              The 💬 button on any item shows the issue&apos;s Jira comment thread, read live from Jira; a comment
              posted there goes to the Jira issue itself, authored as you via your connected Atlassian account — Flux
              keeps no separate comment store. The <span className="font-medium text-foreground">Report</span> button
              on each sprint downloads the full sprint report as Excel: a summary sheet, every item with its scope
              origin and reason, and the removed-after-start list.{" "}
              <span className="font-medium text-foreground">Copy update</span> puts a plain-text version of the same
              status on the clipboard, ready to paste into a team group. The ⛶ button opens a{" "}
              <span className="font-medium text-foreground">focused view</span> of one sprint (everything works there
              too), and the 🔗 button copies a <span className="font-medium text-foreground">shareable link</span>{" "}
              straight to that sprint — anyone with project access can open it. Related sprints can be clubbed into a{" "}
              <span className="font-medium text-foreground">workstream</span> (an initiative inside the project, like
              “Wholesaler App” holding its Demo sprints): create one with the New workstream button, move sprints in
              via the picker on each card, and the workstream section shows the combined rollup with its own shareable
              link and a report covering every sprint in it.
            </p>
          </Section>

          <Section title="Who can do what">
            <p>
              Everyone on the project can view sprints and their reports. Creating, starting, editing, completing,
              deleting, and changing sprint contents needs delivery-manager rights (ADMINs, or users granted “Delivery
              Managers” access by a superuser) — the same permission as Delivery Tracking.
            </p>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

# Flux SDLC Platform — Vision & Problem Statement

**Date:** May 21, 2026
**Author:** Nikhil Agarwal
**Audience:** CTO, Salescode

---

## What We Are Building and Why

Salescode operates across multiple client projects, with engineering teams, delivery managers, and business analysts all working in parallel. Today, this work is scattered — across Jira boards, Slack threads, emails, spreadsheets, and verbal check-ins. There is no single place where you can answer: *"What is the state of delivery right now, across every client, every developer, every issue?"*

**Flux** is that place. It is Salescode's internal SDLC operating system — a platform that consolidates every signal from every project into one coherent view, and changes the way developers, managers, and clients experience the software delivery lifecycle.

### Everything flows into one place

```mermaid
flowchart LR
    subgraph IN["Data Sources"]
        J["Jira Projects"]
        G["GitHub Repos"]
        FD["Freshdesk Tickets"]
    end

    subgraph FLUX["⚡ Flux Platform"]
        D["Org Dashboard"]
        MT["My Tasks"]
        TP["Team Pulse"]
        SLA["SLA Engine"]
        CI["Client Issue Tracker"]
    end

    subgraph OUT["Who Benefits"]
        DEV["Developers"]
        MGR["Engineering Managers"]
        AM["Account Managers"]
        CTO["CTO / Leadership"]
    end

    J --> FLUX
    G --> FLUX
    FD --> FLUX
    FLUX --> OUT
```

---

## Where Time Is Being Wasted Today

Before looking at solutions, this is where engineering effort leaks every single day:

```mermaid
pie title Where Delivery Time Leaks Today
    "Context switching across tools (Jira, Slack, email)" : 30
    "Unplanned / ad-hoc work absorbing sprint capacity" : 25
    "Manual status reporting and standups" : 20
    "SLA breaches discovered after the client complains" : 15
    "Manually creating Jira tickets from client Slack messages" : 10
```

Each slice below maps to a specific problem Flux eliminates.

---

## The Problems We Are Solving

---

### For Developers

---

#### Problem 1 — No clarity on what to work on next

Developers today switch between Jira, Slack, and team standups to piece together their priorities. A typical morning looks like this:

```mermaid
journey
    title Developer Morning: Before Flux
    section Finding Priorities
      Log into Jira Project A: 2: Developer
      Log into Jira Project B: 2: Developer
      Scroll through Slack for task updates: 1: Developer
      Ping PM to ask what to prioritize: 1: Developer
    section Starting Work
      Manually identify the highest priority ticket: 2: Developer
      Re-read Slack threads for context on the ticket: 2: Developer
      Finally start coding (40+ minutes wasted): 3: Developer
```

```mermaid
journey
    title Developer Morning: With Flux
    section Finding Priorities
      Open My Tasks dashboard: 5: Developer
      All tasks across all projects in one screen: 5: Developer
    section Starting Work
      Click highest priority task: 5: Developer
      Full context, status history, and timeline visible: 5: Developer
      Start coding immediately: 5: Developer
```

**What Flux changes:** Every developer gets a personal **My Tasks** dashboard. All their Jira issues across every project — filterable by status, priority, and project — in one place. No more hunting across boards.

---

#### Problem 2 — No visibility into where work is actually getting stuck

A ticket moves through multiple stages. Nobody knows how long it sat in each one. The same bottleneck repeats sprint after sprint because it is never visible.

**A typical issue without Flux looks like this:**

```
Status          Time Spent
─────────────────────────────────────────────────────
Todo          ██░░░░░░░░░░░░░░░░░░░░░░░  1.5h
In Progress   ████████░░░░░░░░░░░░░░░░░  6h
In Review     ██████████████████░░░░░░░  18h  ← STUCK
QA            █████░░░░░░░░░░░░░░░░░░░░  4h
Done          ─
```

18 hours in review — nobody knew until the sprint retro.

**What Flux changes:** Every issue has a **Time in Status** timeline — a visual breakdown of exactly how long that issue spent in each workflow state. Bottlenecks are visible the moment they happen, not in the retrospective.

---

### For Managers

---

#### Problem 4 — No real-time picture of team health

Knowing how a team is performing means attending standups, reading Jira manually, and pinging individuals. By the time a manager identifies a problem, it is already too late.

```mermaid
flowchart TD
    subgraph BEFORE["Today — Manager's Only Options"]
        S1["Attend daily standup"]
        S2["Manually check Jira\nfor each developer"]
        S3["Ping developers\non Slack"]
        S4["Wait for sprint retro\nto see problems"]
    end

    subgraph AFTER["With Flux Team Pulse"]
        T1["Open Team Board"]
        T2["See every developer's\nlive workload"]
        T3["Staleness alert:\nno movement in 5+ days"]
        T4["At-risk flags\nbefore deadlines slip"]
        T1 --> T2 --> T3
        T1 --> T4
    end
```

**What Flux changes:** The **Team Pulse** board gives managers a live snapshot of every developer's work — active tasks, workload distribution, and automatic staleness flags. No standup needed to answer: *"Is my team healthy right now?"*

---

#### Problem 5 — Unplanned work is invisible until it causes a slip

Developers pick up ad-hoc bugs and urgent requests that never make it into the sprint plan. Managers only find out when planned work misses the deadline.

```mermaid
pie title Sprint Capacity Breakdown (Typical Week)
    "Planned sprint work" : 55
    "Unplanned / ad-hoc work" : 30
    "Meetings and context switching" : 15
```

30% of capacity consumed by invisible work — every single week.

**What Flux changes:** The **Unplanned Work view** inside every team board automatically surfaces issues falling outside the planned sprint. Managers see the real capacity picture and can re-prioritize before plans slip.

---

#### Problem 6 — SLA tracking is manual and breaches are discovered too late

Salescode commits to response and resolution SLAs for every client. Today, tracking them is someone's manual job. Breaches are discovered after the client complains.

```mermaid
flowchart TD
    A["Issue Created or Status Changed"]
    B{"SLA Rule\nConfigured?"}
    C["Start SLA Timer"]
    D{"Threshold\nBreached?"}
    E["Keep Monitoring"]
    F["Breach Detected"]
    G["Notify Assignee\n+ Stakeholders"]
    H{"2× Threshold\nBreached?"}
    I["Auto-escalate\nto Manager"]
    J{"Issue\nResolved?"}
    K["Auto-close\nViolation"]

    A --> B
    B -- No --> Z["No Action"]
    B -- Yes --> C
    C --> D
    D -- No --> E --> D
    D -- Yes --> F
    F --> G --> H
    H -- No --> H
    H -- Yes --> I
    F --> J
    J -- Yes --> K
```

**What Flux changes:** The **SLA Engine** checks rules continuously. The moment a threshold is crossed, it notifies the right people immediately and escalates automatically at 2× — before the client even notices.

---

#### Problem 7 — Delivery velocity across all projects is invisible

There is no way to look across all active Salescode projects and understand which are on track, which are slowing down, and where effort is concentrated.

```mermaid
flowchart LR
    subgraph PROJECTS["Active Jira Projects"]
        P1["Project Alpha"]
        P2["Project Beta"]
        P3["Project Gamma"]
        P4["Project Delta"]
    end

    subgraph FLUX["Flux Org Dashboard"]
        AGG["Aggregated velocity,\nthroughput, SLA health\nacross all projects"]
    end

    P1 --> FLUX
    P2 --> FLUX
    P3 --> FLUX
    P4 --> FLUX

    FLUX --> CTO["CTO sees the\nreal delivery picture"]
    FLUX --> DM["Delivery Manager\nacts before projects slip"]
```

**What Flux changes:** The **Organization Dashboard** aggregates velocity, issue throughput, and SLA health across every synced Jira project — one view instead of four separate Jira boards.

---

#### Problem 8 — Developer performance reviews have no objective data

Assessing a developer relies on memory and impressions. Managers have no structured data on velocity, resolution time, or whether bandwidth is well-utilized.

| What Managers Have Today | What Developer Insights Provides |
|---|---|
| "I think they've been busy" | Exact task count in-progress vs completed |
| "They seem a bit slow this sprint" | Avg time to resolution vs team average |
| "Not sure if they're blocked" | List of issues with zero movement for 5+ days |
| "Hard to say how they're doing" | Velocity trend over the last 4 weeks |
| Gut feel in performance reviews | Data-backed conversations |

**What Flux changes:** The **Developer Insights** view gives an objective, data-driven profile per developer — making performance conversations fair and grounded.

---

#### Problem 9 — Gantt and timeline planning is always stale

Project plans live in spreadsheets. The actual work lives in Jira. These two are never in sync.

```mermaid
flowchart LR
    subgraph TODAY["Today"]
        SP["Sprint plan in\nspreadsheet / Notion"]
        JR["Actual work\nin Jira"]
        GAP["⚠️ Always out of sync"]
        SP -.->|"Manually kept in sync\n(quickly becomes stale)"| JR
        SP --> GAP
        JR --> GAP
    end

    subgraph FLUX["With Flux"]
        LIVE["Live Jira data"]
        GANTT["Team Timeline +\nGantt auto-generated"]
        LIVE -->|"Real-time"| GANTT
        GANTT --> TRUTH["Always shows\nactual state of work"]
    end
```

**What Flux changes:** The **Team Timeline and Gantt views** are generated directly from live Jira data. When an issue moves, the timeline updates. Managers always see the real picture.

---

### For Client Relationship Management

The existing workflow is already partially set up. Clients raise tickets in **Freshdesk**. The support team then manually links a Jira ticket to that Freshdesk ticket, embedding the FD ticket number in Jira. The relationship exists — but it is buried across two systems that nobody sees together.

```mermaid
flowchart LR
    CLI["Client raises issue"]
    FD["Freshdesk Ticket\n(FD-1042)"]
    SUP["Support Engineer\nmanually links Jira"]
    JI["Jira Ticket\n(references FD-1042)"]

    CLI --> FD --> SUP --> JI

    FD -.->|"Siloed"| GAP["⚠️ No unified view\nanywhere"]
    JI -.->|"Siloed"| GAP
```

The link exists. The visibility does not. That is the problem.

---

#### Problem 10 — No single view that shows Freshdesk ticket status alongside Jira progress

To answer "what is the current status of this client's issue?" someone has to:
1. Open Freshdesk, find the ticket, read the client-facing status
2. Open Jira, search for the linked ticket by FD number, read the engineering status
3. Mentally reconcile the two

This happens for every single issue. It is slow, it requires access to both tools, and it is error-prone.

```mermaid
journey
    title Checking Status of a Client Issue: Today
    section Current Process
      Open Freshdesk: 2: Account Manager
      Find the ticket by client name or date: 2: Account Manager
      Note the FD ticket number: 3: Account Manager
      Open Jira: 2: Account Manager
      Search for the linked Jira ticket: 2: Account Manager
      Cross-reference status mentally: 1: Account Manager
      Still unclear if engineering has picked it up: 1: Account Manager
```

```mermaid
journey
    title Checking Status of a Client Issue: With Flux Dashboard
    section With Flux
      Open Client Issues dashboard in Flux: 5: Account Manager
      See Freshdesk status + Jira status side by side: 5: Account Manager
      Instantly know if it is being worked on: 5: Account Manager
```

**What Flux changes:** The **Client Issues Dashboard** syncs Freshdesk tickets and their linked Jira issues into one unified view. Freshdesk status on the left. Jira progress on the right. No switching tools. No manual reconciliation.

---

#### Problem 11 — No visibility into tickets that have not been linked to Jira yet

The support team manually links the Jira ticket to Freshdesk. If they forget, or if the ticket is still being triaged, there is no Jira link yet. No one can easily see which Freshdesk tickets are still unlinked — meaning they may be sitting with no engineering action started.

```mermaid
flowchart TD
    FD1["FD-1041 ✅ Linked to PROJ-88"]
    FD2["FD-1042 ✅ Linked to PROJ-91"]
    FD3["FD-1043 ⚠️ No Jira link — 3 days old"]
    FD4["FD-1044 ⚠️ No Jira link — 1 day old"]

    DASH["Flux Dashboard\nflags unlinked tickets automatically"]

    FD1 --> DASH
    FD2 --> DASH
    FD3 --> DASH
    FD4 --> DASH

    DASH --> AM["Account Manager / Lead\nsees the gap immediately"]
```

**What Flux changes:** The dashboard highlights every Freshdesk ticket that has no Jira counterpart yet, sorted by age. Nothing falls through the cracks quietly.

---

#### Problem 12 — No high-level view across all clients at once

A senior person — Account Manager, Delivery Lead, or CTO — has no single screen showing: how many open Freshdesk tickets exist across all clients, which ones have engineering work in progress in Jira, and which are at risk of breaching SLA. This picture only exists if someone manually pulls it together.

```mermaid
flowchart TD
    subgraph FRESHDESK["Freshdesk (all clients)"]
        T1["Client A — 4 open tickets"]
        T2["Client B — 2 open tickets"]
        T3["Client C — 6 open tickets\n⚠️ 2 unlinked"]
        T4["Client D — 1 open ticket"]
    end

    subgraph JIRA["Linked Jira Tickets"]
        J1["ALPHA-12, ALPHA-15\nIn Progress"]
        J2["BETA-08\nIn Review"]
        J3["GAMMA-21\nBlocked ⚠️"]
    end

    subgraph FLUX["Flux Client Issues Dashboard"]
        OVERVIEW["At-a-glance overview\nper client"]
        RISK["SLA risk flags\n(days open vs threshold)"]
        UNLINKED["Unlinked ticket alerts"]
        DRILL["Per-ticket drill-down:\nFD status + Jira status together"]
    end

    FRESHDESK --> FLUX
    JIRA --> FLUX
    FLUX --> LEAD["Leadership / AM\nacts in seconds, not minutes"]
```

**What Flux changes:** One dashboard. Every client's Freshdesk tickets, their linked Jira issues, days open, SLA risk, and unlinked gaps — all visible in a single glance without logging into either Freshdesk or Jira.

---

#### What the dashboard card looks like per ticket

```
┌─────────────────────────────────────────────────────────────────┐
│  FD-1043  •  Client: Acme Corp  •  Priority: High  •  3d open   │
├───────────────────────────┬─────────────────────────────────────┤
│  Freshdesk Status         │  Jira Status                        │
│  ● Waiting on Support     │  PROJ-91  →  In Progress            │
├───────────────────────────┴─────────────────────────────────────┤
│  Subject: Login page throws 500 on SSO redirect                 │
│  Assignee (FD): Ravi S.   │  Assignee (Jira): Priya M.          │
│  SLA: 4h remaining ⚠️                                           │
└─────────────────────────────────────────────────────────────────┘
```

At a glance: what the client raised, where it sits in Freshdesk, where the engineering work is in Jira, who owns it on both sides, and how much SLA headroom is left.

---

## The Full Shift at a Glance

| Persona | Before Flux | With Flux |
|---|---|---|
| **Developer** | Checks 3+ Jira boards to understand priorities | One dashboard — all tasks, all projects |
| **Developer** | Blocked issues sit unnoticed until standup | Staleness alerts surface stuck work automatically |
| **Manager** | Learns about team health in retrospectives | Live team pulse — real-time workload per developer |
| **Manager** | Unplanned work is invisible until plans slip | Dedicated view shows real bandwidth consumption |
| **Manager** | SLA breaches discovered after client complains | Automated detection and escalation before it happens |
| **Manager** | No cross-project delivery view | Org dashboard — velocity and SLA health across all projects |
| **Manager** | Developer performance reviewed on gut feel | Objective delivery metrics per developer |
| **Manager** | Gantt plans always out of sync with reality | Timeline auto-generated from live Jira data |
| **Account Manager** | Checks Freshdesk and Jira separately to get one answer | Both statuses side by side in a single dashboard card |
| **Account Manager** | No visibility into unlinked tickets until a client escalates | Dashboard flags every Freshdesk ticket with no Jira link |
| **Leadership** | No consolidated view of delivery health | One platform — every project, every team, every client ticket |

---

## Who This Is For

```mermaid
flowchart LR
    FLUX["⚡ Flux"]

    FLUX --> DEV["Developers\nClarity on work,\nno context switching"]
    FLUX --> MGR["Engineering Managers\nLive team health,\nSLA enforcement,\nunplanned work visibility"]
    FLUX --> AM["Account Managers\nClient issue dashboard,\nproactive SLA alerts"]
    FLUX --> AM2["Account Managers\nFreshdesk + Jira unified,\nunlinked ticket alerts"]
    FLUX --> CTO["CTO / Leadership\nReal delivery state\nacross every project and client"]
```

---

*For questions or feedback: Nikhil Agarwal — nikhil.agarwal@salescode.ai*

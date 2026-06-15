const BASE_URL = process.env.FRESHDESK_BASE_URL?.replace(/\/$/, "");
const API_KEY = process.env.FRESHDESK_API_KEY;


const FD_STATUS_LABELS: Record<number, string> = {
  2: "Open",
  3: "Pending",
  4: "Resolved",
  5: "Closed",
  6: "Waiting on Customer",
  7: "Waiting on Third Party",
};

const FD_PRIORITY_LABELS: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

export function fdStatusLabel(status: number): string {
  return FD_STATUS_LABELS[status] ?? `Status ${status}`;
}

export function fdPriorityLabel(priority: number): string {
  return FD_PRIORITY_LABELS[priority] ?? `Priority ${priority}`;
}

export interface FdTicket {
  id: number;
  subject: string;
  // Plain-text body of the ticket; `description` (HTML) is also returned by the
  // API but we only persist the text form.
  description_text: string | null;
  status: number;
  priority: number;
  type: string | null;
  company_id: number | null;
  due_by: string | null;
  fr_due_by: string | null;
  is_escalated: boolean;
  fr_escalated: boolean;
  created_at: string;
  updated_at: string;
  requester?: {
    name: string;
    email: string;
  };
  company?: {
    id: number;
    name: string;
  };
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${API_KEY}:X`).toString("base64");
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Freshdesk API error ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

// Fetch all tickets for a Freshdesk company, paginated
export async function fetchCompanyTickets(
  companyId: string | number,
  options?: { updatedSince?: Date }
): Promise<FdTicket[]> {
  const all: FdTicket[] = [];
  let page = 1;
  const updatedSince = options?.updatedSince
    ? `&updated_since=${options.updatedSince.toISOString()}`
    : "";

  while (true) {
    const tickets = await get<FdTicket[]>(
      `/api/v2/tickets?company_id=${companyId}&per_page=100&page=${page}&include=requester,company,description${updatedSince}`
    );
    if (!tickets.length) break;
    all.push(...tickets);
    if (tickets.length < 100) break;
    page++;
  }

  return all;
}

export async function fetchTicket(id: number): Promise<FdTicket> {
  return get<FdTicket>(`/api/v2/tickets/${id}?include=requester,company`);
}

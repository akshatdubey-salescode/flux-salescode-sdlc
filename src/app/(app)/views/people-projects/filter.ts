// Pure filter logic for the People & Projects view, kept free of DB/Next
// imports so it can be unit-tested with the node test runner.
import type { PersonProjectsRow } from "./data";

/**
 * Applies the on-screen filters: a case-insensitive search over person
 * (name, email, department) and their projects (name, key) — a person stays
 * when any field matches — plus a department multiselect (a person stays
 * when their department is one of the selected). Shared by the page and the
 * Excel export so the file always matches the screen.
 */
export function filterPeopleProjects(
  rows: PersonProjectsRow[],
  q: string,
  departments: string[] = []
): PersonProjectsRow[] {
  let filtered = rows;

  if (departments.length) {
    const wanted = new Set(departments.map((d) => d.toLowerCase()));
    filtered = filtered.filter(
      (row) => row.department && wanted.has(row.department.toLowerCase())
    );
  }

  const needle = q.trim().toLowerCase();
  if (needle) {
    filtered = filtered.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle) ||
        (row.department ?? "").toLowerCase().includes(needle) ||
        row.projects.some(
          (p) =>
            p.projectName.toLowerCase().includes(needle) ||
            p.projectKey.toLowerCase().includes(needle)
        )
    );
  }

  return filtered;
}

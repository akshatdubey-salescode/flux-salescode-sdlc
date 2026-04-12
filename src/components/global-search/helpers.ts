import {
  TrackingIssue,
  TrackingFields,
  FilterState,
} from "../project-tracking/helpers";

export type GlobalSearchFields = TrackingFields & {
  projects: { id: string; name: string; key: string }[];
  assignees: { email: string; name: string }[];
};

export type GlobalSearchFilterState = FilterState & {
  projects: string[];
  assignee: string[];
};

export * from "../project-tracking/helpers";

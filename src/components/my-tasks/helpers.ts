import {
  TrackingIssue,
  TrackingFields,
  FilterState,
} from "../project-tracking/helpers";

export type MyTasksFields = TrackingFields & {
  projects: { id: string; name: string; key: string }[];
};

export type MyTasksFilterState = FilterState & {
  projects: string[];
  qstart: string;
  qend: string;
  includeReported: boolean;
  unplannedOnly: boolean;
};

export * from "../project-tracking/helpers";

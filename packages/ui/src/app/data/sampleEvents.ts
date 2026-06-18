import type { HarnessEvent } from "../../client/types";

// A short, representative slice of harness activity used to preview the live
// event-feed styles in the Appearance settings. It spans several event types so
// each per-type color shows, with fixed timestamps so the preview is stable.
export const SAMPLE_FEED_EVENTS: HarnessEvent[] = [
  {
    timestamp: "2026-06-18T12:13:00Z",
    type: "agent",
    message: "Reading the project layout to plan the change.",
  },
  {
    timestamp: "2026-06-18T12:13:02Z",
    type: "read",
    path: "src/components/Button.tsx",
  },
  {
    timestamp: "2026-06-18T12:13:05Z",
    type: "command",
    command: "npm run build",
  },
  {
    timestamp: "2026-06-18T12:13:11Z",
    type: "write",
    path: "src/components/Button.module.css",
  },
];

import type { HarnessEvent } from "../../client/types";

// A short, representative slice of a run's event stream used to preview the live
// event-feed styles in the Appearance settings. It spans several event types —
// including an orchestrator system event — so each per-type color shows, with
// fixed timestamps so the preview is stable.
export const SAMPLE_FEED_EVENTS: HarnessEvent[] = [
  {
    timestamp: "2026-06-18T12:12:58Z",
    type: "system",
    stage: "pull_image",
    status: "started",
    message: "Pulling the run-container image",
  },
  {
    timestamp: "2026-06-18T12:12:59Z",
    type: "reasoning",
    message:
      "The button styles live in a CSS module, so I should read the component first to see which class names it expects before editing anything.",
  },
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

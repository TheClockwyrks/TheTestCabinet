// Shared rendering helpers for the live harness event feed.
//
// This is the single source of truth for how a normalized harness event reads in
// the web UI. The per-type colors live as `--ttc-event-*` tokens in
// `styles/theme.scss` and are applied by event type in the feed's stylesheet;
// they deliberately mirror the CLI's terminal palette in
// `crates/cli/src/commands/event_printer.rs` so a given event type shows up as
// the same hue in the CLI stream and here. Keep the two in lockstep.

import type { HarnessEvent } from "../client/types";

// The detail line for an event: the salient field for its type, with NO type
// label prefixed. The feed renders the type in its own column, so prefixing the
// label here (e.g. "agent: …") would duplicate it on screen. Labeling the
// payload is a presentation concern that belongs only to the CLI renderer, never
// to the event itself or a shared formatter — so it lives nowhere in this path.
export function eventDetail(e: HarnessEvent): string {
  switch (e.type) {
    case "agent":
      return e.message ?? "";
    case "command":
      return e.command ?? "";
    case "read":
    case "write":
    case "list":
    case "skill":
      return e.path ?? "";
    case "search":
      return e.query ?? "";
    case "orchestration":
      return String(e.action ?? "");
    case "error":
    case "warning":
      return e.message ?? "";
    default:
      return JSON.stringify(e.raw ?? e);
  }
}

// The wall-clock time of an event for the feed's gutter (e.g. "12:13:00 PM").
// Returns an empty string for an unparseable timestamp rather than "Invalid Date".
export function formatEventTime(timestamp: string): string {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(at);
}

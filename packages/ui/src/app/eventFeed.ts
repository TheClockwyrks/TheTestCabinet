// Shared rendering helpers for the live harness event feed.
//
// This is the single source of truth for how a normalized harness event reads in
// the web UI. The per-type colors live as `--ttc-event-*` tokens in
// `styles/theme.scss` and are applied by event type in the feed's stylesheet;
// they deliberately mirror the CLI's terminal palette in
// `crates/cli/src/commands/event_printer.rs` so a given event type shows up as
// the same hue in the CLI stream and here. Keep the two in lockstep.

import type { HarnessEvent } from "../client/types";
import type { GgTelemetryEvent } from "@test-cabinet/run-record/gg";

// The detail line for a gg-native telemetry event (`HarnessEvent` of `type: "gg"`).
// gg is headless, so its typed stream is the only live window into a run; the feed
// still shows the alongside-mapped human-facing events (agent/command/…), but this
// renders the salient field of the first-party event so nothing is lost. Kinds
// mirror `GgTelemetryKind`.
function ggEventDetail(event: GgTelemetryEvent): string {
  switch (event.type) {
    case "session_started":
      return "session started";
    case "turn_started":
      return "turn started";
    case "assistant_message":
      return event.text;
    case "tool_call":
      return event.name;
    case "tool_result":
      return `${event.name} ${event.ok ? "ok" : "failed"}${event.summary ? `: ${event.summary}` : ""}`;
    case "usage": {
      const t = event.tokens;
      const total =
        (t.uncachedInput ?? 0) +
        (t.cachedInput ?? 0) +
        (t.output ?? 0) +
        (t.reasoning ?? 0);
      return `${total} tokens`;
    }
    case "log":
      return event.message;
    case "session_ended":
      return `session ${event.status}`;
    default:
      return JSON.stringify(event);
  }
}

// The detail line for an event: the salient field for its type, with NO type
// label prefixed. The feed renders the type in its own column, so prefixing the
// label here (e.g. "agent: …") would duplicate it on screen. Labeling the
// payload is a presentation concern that belongs only to the CLI renderer, never
// to the event itself or a shared formatter — so it lives nowhere in this path.
export function eventDetail(e: HarnessEvent): string {
  switch (e.type) {
    case "agent":
    case "reasoning":
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
    case "system":
      return e.message ?? "";
    case "gg":
      return ggEventDetail(e.event);
    default:
      return JSON.stringify(e.raw ?? e);
  }
}

// A short, single-line preview of a long detail (used as the summary of a
// collapsed reasoning block): whitespace collapsed and truncated with an ellipsis.
const SUMMARY_MAX = 120;
export function eventSummary(detail: string): string {
  const collapsed = detail.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SUMMARY_MAX) return collapsed;
  return `${collapsed.slice(0, SUMMARY_MAX)}…`;
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

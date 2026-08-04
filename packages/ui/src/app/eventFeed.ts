// Shared rendering helpers for the live harness event feed.
//
// This is the single source of truth for how a normalized harness event reads in
// the web UI. The per-type colors live as `--ttc-event-*` tokens in
// `styles/theme.scss` and are applied by event type in the feed's stylesheet;
// they deliberately mirror the CLI's terminal palette in
// `crates/cli/src/commands/event_printer.rs` so a given event type shows up as
// the same hue in the CLI stream and here. Keep the two in lockstep.

import type { HarnessEvent } from "../client/types";
import type {
  GgLimitBreach,
  GgLimitKind,
  GgTelemetryEvent,
} from "@test-cabinet/run-record/gg";

// How each execution ceiling reads in a breach line. Typed as a total record over
// `GgLimitKind` so a ceiling added to the contract is a compile error here rather
// than a run whose stop reason renders as a raw wire value.
const LIMIT_LABELS: Record<GgLimitKind, string> = {
  turns: "turn",
  runtime: "runtime",
  consecutive_errors: "consecutive-error",
  error_rate: "error-rate",
  cost: "cost",
};

// A ceiling's figure, trimmed to two decimals and with trailing zeros dropped, so
// a cost of 25.4 reads as "25.4" and a turn count of 12 as "12" — the units differ
// per ceiling (turns, seconds, a count, a fraction, USD) and one shape carries all
// five.
function limitFigure(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// A breached ceiling as one line: which one, what was observed, and what it was
// set to — "cost ceiling: 25.4 of 25". The rate ceiling additionally names the
// lookback it was measured over, because a rate without its window is not a fact a
// reviewer can act on.
function limitBreachDetail(breach: GgLimitBreach): string {
  // Seconds are the one unit the ceiling's own name does not imply.
  const unit = breach.limit === "runtime" ? "s" : "";
  const window =
    breach.window === undefined ? "" : ` over ${breach.window} turns`;
  return `${LIMIT_LABELS[breach.limit]} ceiling: ${limitFigure(breach.observed)}${unit} of ${limitFigure(breach.threshold)}${unit}${window}`;
}

// A responses-as-code turn as one line: what gg had to do to the reply before it
// could run it, what the program then did, and whether it ended the run.
//
// Under this protocol every assistant message is a page of TypeScript, so this
// event is where a reviewer learns whether that page ran at all — and the healing
// clause is the instruction-following signal the capability exists to measure
// ("still fenced its program after being told not to"), which is why it is on the
// feed rather than only in the aggregate.
function ggCodeExecutionDetail(
  event: Extract<GgTelemetryEvent, { type: "code_execution" }>,
): string {
  const healing = event.healing;
  const parts: string[] = [];
  parts.push(event.ok ? "program ran" : "program failed");
  if (event.toolCalls > 0) {
    parts.push(
      `${event.toolCalls} tool call${event.toolCalls === 1 ? "" : "s"}`,
    );
  }
  if (healing?.strategies?.length) {
    parts.push(`healed: ${healing.strategies.join(", ")}`);
  }
  // The run rollup does not count a reply that defeated the pipeline, so this line
  // is the only place it surfaces.
  if (healing?.didNotConverge) parts.push("healing did not converge");
  // What the program printed is not shown to the model — `console.*` writes to whoever
  // is watching the run, and this event is the only record of it — so the count belongs
  // on the one line that describes the turn. The lines themselves are on the event for
  // a reader who opens it; a one-line feed cannot carry two hundred of them.
  const logged = event.logs?.length ?? 0;
  if (logged > 0) {
    parts.push(`logged ${logged} line${logged === 1 ? "" : "s"}`);
  }
  // The finishing turn is the only one that carries a summary, so this marks the
  // single turn on which the model ended the run of its own accord. The summary
  // itself reaches the feed as its own agent-message event, so it is not repeated.
  if (event.finished !== undefined) parts.push("finished");
  if (!event.ok && event.error) parts.push(event.error);
  return parts.join(" · ");
}

// The detail line for a gg-native telemetry event (`HarnessEvent` of `type: "gg"`).
// gg is headless, so its typed stream is the only live window into a run; the feed
// still shows the alongside-mapped human-facing events (agent/command/…), but this
// renders the salient field of the first-party event so nothing is lost. Kinds
// mirror `GgTelemetryKind`.
//
// The `default` arm below means a new kind is **not** a compile error here — it
// silently degrades to raw JSON — so every kind worth reading has to be added
// deliberately. Anything left to the default is a kind whose payload is its own
// best rendering.
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
    case "code_execution":
      return ggCodeExecutionDetail(event);
    case "limit_exceeded":
      return limitBreachDetail(event.breach);
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
    case "usage": {
      // A per-turn token-usage slice (a diagnostic event, not workspace activity);
      // summarize it as the turn's total across the four normalized classes.
      const t = e.tokens;
      const total =
        (t.uncachedInput ?? 0) +
        (t.cachedInput ?? 0) +
        (t.output ?? 0) +
        (t.reasoning ?? 0);
      return `${total.toLocaleString()} tokens`;
    }
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

// The Requests view: one agent's exact request/response history, message by message.
//
// gg records the precise messages it sends the model as a de-duplicated log — each
// unique message's body once (`context_message`), then each turn's request as a
// sequence of pointers into that pool plus the response (`prompt`); see
// gg/context-visibility. This view resolves those pointers back into the real prompts,
// so a run can be read at the level the context-window graph only summarizes: which
// messages were sent this turn, what band each occupies (colored to match the graph),
// how many tokens each costs, and what the model replied. It is the itemized companion
// to the stacked Context graph — the graph shows the composition, this shows the
// contents.

import type { ReactNode } from "react";
import type { GgContextSource } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { PooledMessage, PromptTurn } from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import { formatCost } from "./GgOverviewWidgets";
import {
  CONTEXT_SOURCE_COLORS,
  CONTEXT_SOURCE_LABELS,
} from "./ContextFillGraph";
import { ExpandablePre } from "./MessageOverlay";

/**
 * Which band a {@link MessageRow} is tagged with: the context source a request message
 * occupies, or one of two states that are not bands at all.
 *
 * The two non-band members are spelled out rather than left as `null` because they mean
 * different things and read differently. `"reply"` is the model's answer — an assistant
 * message not yet placed in a band this turn. `{ unattributed: role }` is a message whose
 * band the *source* does not record: a [replay record](./replayModel) captured before
 * format v2 pins the exact messages but carries no prompt frame, so there is no band to
 * colour it by. It falls back to the message's own **role**, which is a different fact
 * and is labelled as one — inferring a band from a role would put a colour on the row
 * that the record never claimed.
 */
export type MessageBand = GgContextSource | "reply" | { unattributed: string };

// The band a message occupies, resolved to its label and color.
function band(source: MessageBand): {
  label: string;
  color: string;
} {
  if (typeof source === "object") {
    return { label: source.unattributed, color: CONTEXT_SOURCE_COLORS.history };
  }
  if (source === "reply") {
    return { label: "Reply", color: CONTEXT_SOURCE_COLORS.assistant };
  }
  return {
    label: CONTEXT_SOURCE_LABELS[source],
    color: CONTEXT_SOURCE_COLORS[source],
  };
}

// A one-line preview of a message's gist for its collapsed row — its text, or a
// synopsis of the tool calls / images it carries when it has no text of its own.
const PREVIEW_MAX = 200;
function messagePreview(message: PooledMessage): string {
  if (message.content && message.content.trim()) {
    return message.content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_MAX);
  }
  if (message.toolCalls.length > 0) {
    return `→ ${message.toolCalls.map((c) => c.name).join(", ")}`;
  }
  if (message.images.length > 0) {
    return `${message.images.length} image${message.images.length === 1 ? "" : "s"}`;
  }
  return "(empty)";
}

// A human size for an image descriptor's decoded bytes (KB/MB), so an attached mockup
// reads without swamping the row.
function shortBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One message in a turn's request or as its response, an expandable row. The whole row
 * aligns into fixed columns — a colored band tag, the content preview, and the token
 * count — so a request reads as a table, and the leading edge is tinted with the band's
 * color (the same palette the stacked Context graph uses) so the two line up.
 *
 * Shared with the [Replay view](./GgReplayView), which resolves a replay record's pooled
 * bodies into the same {@link PooledMessage} shape and renders them through this one
 * component rather than a second, near-identical one: two renderers of the same thing
 * drift, and the display narrowers the old Replay view needed existed only because it
 * read opaque JSON. `context` is the extra column that view adds.
 */
export function MessageRow({
  message,
  source,
  context,
}: {
  message: PooledMessage | undefined;
  source: MessageBand;
  /**
   * The Context column: where this message sat in the agent's window — its retention,
   * the turn it was pushed on, and a paged file view's `path@offset+limit`. Only a
   * replay record's prompt frame carries these, so the column exists only there and the
   * row keeps its four ordinary columns everywhere else.
   */
  context?: ReactNode;
}) {
  const { label, color } = band(source);
  const hasContext = context != null;
  if (!message) {
    return (
      <li className={panels.reqMessage} style={{ borderLeftColor: color }}>
        <div
          className={panels.reqRow}
          data-context={hasContext ? "" : undefined}
        >
          <span className={panels.reqTag} style={{ color }}>
            {label}
          </span>
          <span className={panels.reqMissing}>message unavailable</span>
          {hasContext && <span className={panels.reqContext}>{context}</span>}
        </div>
      </li>
    );
  }
  const hasBody =
    (message.content != null && message.content !== "") ||
    message.toolCalls.length > 0 ||
    message.images.length > 0;
  return (
    <li className={panels.reqMessage} style={{ borderLeftColor: color }}>
      <details className={panels.reqMessageDetails}>
        <summary
          className={panels.reqRow}
          data-context={hasContext ? "" : undefined}
        >
          <span className={panels.reqCaret} aria-hidden="true">
            ▸
          </span>
          <span className={panels.reqTag} style={{ color }}>
            {label}
          </span>
          <span className={panels.reqPreview}>{messagePreview(message)}</span>
          {/* An empty cell, not a zero: a source that does not estimate tokens has not
              told us this message was free. */}
          <span className={panels.reqTokens}>
            {message.tokens != null ? shortTokens(message.tokens) : ""}
          </span>
          {hasContext && <span className={panels.reqContext}>{context}</span>}
        </summary>
        <div className={panels.reqMessageBody}>
          {/* The pairing back to the call this message answers is the one fact the
              expansion adds that the collapsed row does not already carry — the role
              is the band tag and the cost is the token column, both a line above, so
              restating them here was pure duplication. Most messages answer nothing,
              and an always-rendered paragraph would hold an empty line open on every
              one of them, so it appears only when there is a call to name. */}
          {message.toolCallId != null && (
            <p className={panels.reqMeta}>answers {message.toolCallId}</p>
          )}
          {message.content != null && message.content !== "" && (
            <ExpandablePre
              content={message.content}
              className={panels.reqContent}
              label={`${label} ${message.role} message`}
            />
          )}
          {message.toolCalls.length > 0 && (
            <ul className={panels.reqToolCalls}>
              {message.toolCalls.map((call) => (
                <li key={call.id} className={panels.reqToolCall}>
                  <span className={panels.reqToolName}>{call.name}</span>
                  <pre className={panels.reqToolArgs}>
                    {JSON.stringify(call.args, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
          {/* The picture itself where the source pooled its bytes (a replay record), and
              the descriptor alone where it did not (the telemetry stream, which records
              media type and size and never the payload). A caption rides along either
              way, so the two read as the same row with more or less of the image in it. */}
          {message.images.length > 0 && (
            <ul className={panels.reqImages}>
              {message.images.map((image, i) => (
                <li key={i} className={panels.reqImage}>
                  {image.dataBase64 != null && (
                    <img
                      className={panels.reqImageThumb}
                      src={`data:${image.mediaType};base64,${image.dataBase64}`}
                      alt={`Attached ${image.mediaType} image`}
                    />
                  )}
                  <span className={panels.reqImageMeta}>
                    {image.mediaType} · {shortBytes(image.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!hasBody && <p className={panels.reqEmptyBody}>(no content)</p>}
        </div>
      </details>
    </li>
  );
}

// One stat in a turn header (a value with a muted caption), so the header reads as a
// row of labeled figures rather than a run-on line.
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className={panels.reqStat}>
      <span className={panels.reqStatValue}>{value}</span>
      <span className={panels.reqStatLabel}>{label}</span>
    </span>
  );
}

// One turn — its request (ordered messages, colored by band) and its response, as a
// collapsible entry sitting directly on the view's backdrop, separated from its
// neighbours by a hairline rather than boxed in a card of its own: the messages inside
// it are already tinted, bordered rows, and wrapping that in a second frame nested a
// widget in a widget for no added meaning. The header carries the turn's shape at a
// glance: message count, request size (the fullness numerator, matching the graph at
// this turn), the reply's output tokens and cost, and why the turn stopped.
function TurnEntry({
  prompt,
  pool,
  open,
}: {
  prompt: PromptTurn;
  pool: Map<string, PooledMessage>;
  open: boolean;
}) {
  const response =
    prompt.responseId != null ? pool.get(prompt.responseId) : undefined;
  const outputTokens =
    (prompt.tokens.output ?? 0) + (prompt.tokens.reasoning ?? 0);
  const cost = prompt.cost?.comparable ?? prompt.cost?.actual ?? null;
  return (
    <details className={panels.reqTurn} open={open}>
      <summary className={panels.reqTurnSummary}>
        <span className={panels.reqCaret} aria-hidden="true">
          ▸
        </span>
        <span className={panels.reqTurnLabel}>Turn {prompt.turn + 1}</span>
        <span className={panels.reqTurnStats}>
          <Stat value={String(prompt.request.length)} label="msgs" />
          <Stat value={shortTokens(prompt.totalTokens)} label="in" />
          <Stat value={shortTokens(outputTokens)} label="out" />
          {cost != null && <Stat value={formatCost(cost)} label="cost" />}
        </span>
        <span className={panels.reqFinish} data-finish={prompt.finishReason}>
          {prompt.finishReason}
        </span>
      </summary>
      <div className={panels.reqTurnBody}>
        <div className={panels.reqSectionLabel}>
          Request{" "}
          <span className={panels.reqSectionCount}>
            {prompt.request.length}
          </span>
        </div>
        <ul className={panels.reqMessages}>
          {prompt.request.map((ref, i) => (
            <MessageRow
              key={`${ref.id}-${i}`}
              message={pool.get(ref.id)}
              source={ref.source}
            />
          ))}
        </ul>
        <div className={panels.reqSectionLabel}>Response</div>
        {response ? (
          <ul className={panels.reqMessages}>
            <MessageRow message={response} source="reply" />
          </ul>
        ) : (
          <p className={panels.reqEmptyResponse}>
            No assistant message — the turn produced only a stop.
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * The per-agent Requests view — the exact messages one agent sent the model and the
 * replies it got back, turn by turn, resolved from the de-duplicated message log.
 */
export function RequestsView({
  prompts,
  pool,
  live,
}: {
  prompts: PromptTurn[];
  pool: Map<string, PooledMessage>;
  live: boolean;
}) {
  // Newest turn open by default — the one a live watcher is most likely reading. This
  // takes the last entry's own `turn`, not its index in the list: `turn` is the number
  // the `prompt` event carried, and `open` below compares against that. An agent whose
  // recorded turns don't happen to be a contiguous 0-based run — a resumed agent, or a
  // stream a filter has thinned — would then match no turn at all, and with the turn
  // cards gone a wholly collapsed list is flatter than it used to be.
  const openTurn =
    prompts.length > 0 ? prompts[prompts.length - 1]!.turn : null;

  if (prompts.length === 0) {
    return (
      <p className={panels.empty}>
        {live ? "Waiting for the first request…" : "No requests were recorded."}
      </p>
    );
  }
  return (
    <div className={panels.requests}>
      {prompts.map((prompt) => (
        <TurnEntry
          key={prompt.turn}
          prompt={prompt}
          pool={pool}
          open={prompt.turn === openTurn}
        />
      ))}
    </div>
  );
}

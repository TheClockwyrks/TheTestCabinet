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

import { useMemo } from "react";
import type { GgContextSource } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { PooledMessage, PromptTurn } from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import { formatCost } from "./GgOverviewWidgets";
import {
  CONTEXT_SOURCE_COLORS,
  CONTEXT_SOURCE_LABELS,
} from "./ContextFillGraph";

// The band a message occupies, resolved to its label and color. A request message
// carries its `GgContextSource`; the response is an assistant reply not yet placed in a
// band this turn, so it is shown in the assistant hue under a "Reply" tag.
function band(source: GgContextSource | null): {
  label: string;
  color: string;
} {
  if (source == null) {
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

// One message in a turn's request or as its response, an expandable row. The whole row
// aligns into fixed columns — a colored band tag, the content preview, and the token
// count — so a request reads as a table, and the leading edge is tinted with the band's
// color (the same palette the stacked Context graph uses) so the two line up.
function MessageRow({
  message,
  source,
}: {
  message: PooledMessage | undefined;
  source: GgContextSource | null;
}) {
  const { label, color } = band(source);
  if (!message) {
    return (
      <li className={panels.reqMessage} style={{ borderLeftColor: color }}>
        <div className={panels.reqRow}>
          <span className={panels.reqTag} style={{ color }}>
            {label}
          </span>
          <span className={panels.reqMissing}>message unavailable</span>
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
        <summary className={panels.reqRow}>
          <span className={panels.reqCaret} aria-hidden="true">
            ▸
          </span>
          <span className={panels.reqTag} style={{ color }}>
            {label}
          </span>
          <span className={panels.reqPreview}>{messagePreview(message)}</span>
          <span className={panels.reqTokens}>
            {shortTokens(message.tokens)}
          </span>
        </summary>
        <div className={panels.reqMessageBody}>
          <p className={panels.reqMeta}>
            <span>{message.role}</span>
            <span>{shortTokens(message.tokens)} tokens</span>
            {message.toolCallId != null && (
              <span>answers {message.toolCallId}</span>
            )}
          </p>
          {message.content != null && message.content !== "" && (
            <pre className={panels.reqContent}>{message.content}</pre>
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
          {message.images.length > 0 && (
            <ul className={panels.reqImages}>
              {message.images.map((image, i) => (
                <li key={i} className={panels.reqImage}>
                  {image.mediaType} · {shortBytes(image.bytes)}
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

// One turn — its request (ordered messages, colored by band) and its response, in a
// collapsible card. The header carries the turn's shape at a glance: message count,
// request size (the fullness numerator, matching the graph at this turn), the reply's
// output tokens and cost, and why the turn stopped.
function TurnCard({
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
            <MessageRow message={response} source={null} />
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
  // Newest turn open by default — the one a live watcher is most likely reading.
  const lastTurn = prompts.length - 1;
  const openTurn = useMemo(() => lastTurn, [lastTurn]);

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
        <TurnCard
          key={prompt.turn}
          prompt={prompt}
          pool={pool}
          open={prompt.turn === openTurn}
        />
      ))}
    </div>
  );
}

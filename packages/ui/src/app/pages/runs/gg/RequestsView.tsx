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

// A short, human role label for a pooled message.
const ROLE_LABELS: Record<string, string> = {
  system: "system",
  user: "user",
  assistant: "assistant",
  tool: "tool",
};

// A one-line preview of a message's gist for its collapsed summary — its text, or a
// synopsis of the tool calls / images it carries when it has no text of its own.
const PREVIEW_MAX = 120;
function messagePreview(message: PooledMessage): string {
  if (message.content && message.content.trim()) {
    const text = message.content.replace(/\s+/g, " ").trim();
    return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
  }
  if (message.toolCalls.length > 0) {
    return `calls ${message.toolCalls.map((c) => c.name).join(", ")}`;
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

// One message in a turn's request or as its response. The left edge is tinted with the
// message's context-source color — the same palette the stacked Context graph uses — so
// a request's messages read as the itemization of that graph's bands. `source` is null
// for the response (an assistant reply is not yet placed in a band this turn).
function MessageRow({
  message,
  source,
}: {
  message: PooledMessage | undefined;
  source: GgContextSource | null;
}) {
  if (!message) {
    return (
      <li className={panels.reqMessage} data-missing="">
        <span className={panels.reqMissing}>message unavailable</span>
      </li>
    );
  }
  const color = source ? CONTEXT_SOURCE_COLORS[source] : undefined;
  const bandLabel = source ? CONTEXT_SOURCE_LABELS[source] : "reply";
  return (
    <li className={panels.reqMessage} style={{ borderLeftColor: color }}>
      <details className={panels.reqMessageDetails}>
        <summary className={panels.reqMessageSummary}>
          <span
            className={panels.reqBand}
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className={panels.reqRole}>
            {ROLE_LABELS[message.role] ?? message.role}
          </span>
          <span className={panels.reqBandLabel}>{bandLabel}</span>
          <span className={panels.reqPreview}>{messagePreview(message)}</span>
          <span className={panels.reqTokens}>
            {shortTokens(message.tokens)}
          </span>
        </summary>
        <div className={panels.reqMessageBody}>
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
          {message.toolCallId != null && (
            <p className={panels.reqAnswers}>
              answers call {message.toolCallId}
            </p>
          )}
        </div>
      </details>
    </li>
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
  return (
    <details className={panels.reqTurn} open={open}>
      <summary className={panels.reqTurnSummary}>
        <span className={panels.reqTurnLabel}>Turn {prompt.turn + 1}</span>
        <span className={panels.reqTurnMeta}>
          {prompt.request.length} msg{prompt.request.length === 1 ? "" : "s"}
        </span>
        <span className={panels.reqTurnMeta}>
          {shortTokens(prompt.totalTokens)} in
        </span>
        <span className={panels.reqTurnMeta}>
          {shortTokens(outputTokens)} out
        </span>
        {(prompt.cost?.comparable ?? prompt.cost?.actual) != null && (
          <span className={panels.reqTurnMeta}>
            {formatCost(prompt.cost?.comparable ?? prompt.cost?.actual ?? null)}
          </span>
        )}
        <span className={panels.reqFinish} data-finish={prompt.finishReason}>
          {prompt.finishReason}
        </span>
      </summary>
      <div className={panels.reqTurnBody}>
        <div className={panels.reqSectionLabel}>Request</div>
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
            No assistant message (the turn produced only a stop).
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
  // Stable across re-renders while the list only grows; recomputed only when the count
  // changes (a new turn arrives).
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

// The Prompt view: the instruction one agent was given to begin with — as distinct
// from the tool results, file views, and history that accrue as it works (those are
// what the Requests view itemizes turn by turn).
//
// For a subagent this is the whole point of reading its prompt: the *brief its
// parent handed it* is the direct content of the delegation, so it leads — and it
// comes off the spawn event, so it is present even for an older run that recorded
// no rendered prompt. Beneath it (and, for the root, alone) is the rendered
// opening prompt: the system framing and the build/user prompt the agent actually
// started its first turn from, resolved from the de-duplicated message log.

import type { GgContextSource } from "@test-cabinet/run-record/gg";
import panels from "./GgPanels.module.scss";
import type { AgentNode, PooledMessage, PromptTurn } from "./useGgRunState";
import { shortTokens } from "./useGgRunState";
import {
  CONTEXT_SOURCE_COLORS,
  CONTEXT_SOURCE_LABELS,
} from "./ContextFillGraph";

// The bands that make up "the prompt the agent was given" — its system framing and
// the build/user prompt that set its task. Everything else in a turn's request is
// working state, not the opening instruction.
const PROMPT_SOURCES: readonly GgContextSource[] = ["system", "user_prompt"];

interface PromptMessageRef {
  source: GgContextSource;
  message: PooledMessage;
}

export function PromptView({
  node,
  prompts,
  pool,
  live,
}: {
  node: AgentNode;
  prompts: PromptTurn[];
  pool: Map<string, PooledMessage>;
  live: boolean;
}) {
  const isRoot = node.parentId == null;
  const firstTurn = prompts[0] ?? null;
  const promptMessages: PromptMessageRef[] = firstTurn
    ? firstTurn.request
        .filter((ref) => PROMPT_SOURCES.includes(ref.source))
        .map((ref) => ({ source: ref.source, message: pool.get(ref.id) }))
        .filter((m): m is PromptMessageRef => m.message != null)
    : [];

  const brief = node.brief != null && node.brief !== "" ? node.brief : null;
  const hasPrompt = promptMessages.length > 0;

  return (
    <div className={panels.promptView}>
      {/* A subagent's brief: the direct instruction its parent dispatched it with. */}
      {!isRoot && (
        <section className={panels.promptSection}>
          <span className={panels.subPanelLabel}>Brief from parent</span>
          {brief ? (
            <p className={panels.promptBrief}>{brief}</p>
          ) : (
            <p className={panels.empty}>
              No brief was recorded for this agent.
            </p>
          )}
        </section>
      )}

      {/* The rendered opening prompt: the system framing and build/user prompt the
          agent started from, from the message log. */}
      <section className={panels.promptSection}>
        <span className={panels.subPanelLabel}>
          {isRoot ? "Prompt" : "Rendered prompt"}
        </span>
        {hasPrompt ? (
          <ul className={panels.promptMessages}>
            {promptMessages.map(({ source, message }, i) => (
              <PromptMessage
                key={`${message.id}-${i}`}
                source={source}
                message={message}
              />
            ))}
          </ul>
        ) : (
          <p className={panels.empty}>{emptyPromptNote(live, brief != null)}</p>
        )}
      </section>
    </div>
  );
}

// Why the rendered prompt is missing, in the agent's own terms: still streaming, or
// simply not recorded for this run (in which case a subagent still has its brief above).
function emptyPromptNote(live: boolean, hasBrief: boolean): string {
  if (live) return "Waiting for the first request…";
  if (hasBrief)
    return "The exact prompt isn’t recorded for this run — only the brief above is available.";
  return "The exact prompt isn’t recorded for this run.";
}

// One prompt message: its band tag (colored to match the Context graph), its role
// and token cost, and its full text.
function PromptMessage({
  source,
  message,
}: {
  source: GgContextSource;
  message: PooledMessage;
}) {
  const color = CONTEXT_SOURCE_COLORS[source];
  return (
    <li className={panels.promptMessage} style={{ borderLeftColor: color }}>
      <div className={panels.promptMessageHead}>
        <span className={panels.reqTag} style={{ color }}>
          {CONTEXT_SOURCE_LABELS[source]}
        </span>
        <span className={panels.promptMessageMeta}>
          {message.role} · {shortTokens(message.tokens)} tokens
        </span>
      </div>
      {message.content != null && message.content !== "" ? (
        <pre className={panels.reqContent}>{message.content}</pre>
      ) : (
        <p className={panels.reqEmptyBody}>(no text)</p>
      )}
    </li>
  );
}

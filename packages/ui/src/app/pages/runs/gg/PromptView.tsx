// The Prompt view: the instruction one agent was given to begin with — as distinct
// from the tool results, file views, and history that accrue as it works (those are
// what the Requests view itemizes turn by turn).
//
// For any agent but the main one this is the whole point of reading its prompt: the
// *brief it was dispatched with* — by its parent when an agent spawned it, by the
// board when it was dispatched for an issue — is the direct content of the
// delegation, so it leads, and it comes off the spawn event, so it is there from the
// moment the agent is dispatched. Beneath it (and, for the main agent, alone) is the
// rendered opening prompt: the system framing and the build/user prompt the agent
// actually started its first turn from, resolved from the de-duplicated message log.

import type { CSSProperties } from "react";
import type { GgContextSource } from "@clockwyrks/run-record/gg";
import panels from "./GgPanels.module.scss";
import { useAppSettings } from "../../../store/appSettings";
import { cx } from "./ggFsTree";
import type { AgentNode, PooledMessage, PromptTurn } from "./useGgRunState";
import { ROOT_ID, shortTokens } from "./useGgRunState";
import {
  CONTEXT_SOURCE_COLORS,
  CONTEXT_SOURCE_LABELS,
} from "./ContextFillGraph";
import { ExpandablePre } from "./MessageOverlay";

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
  // Only the main agent has no brief to read: a board-dispatched issue agent is
  // parentless too, but it was dispatched *with* the issue's brief, so keying this on
  // being parentless hid the very instruction it was working from.
  const isRoot = node.id === ROOT_ID;
  const firstTurn = prompts[0] ?? null;
  const promptMessages: PromptMessageRef[] = firstTurn
    ? firstTurn.request
        .filter((ref) => PROMPT_SOURCES.includes(ref.source))
        .map((ref) => ({ source: ref.source, message: pool.get(ref.id) }))
        .filter((m): m is PromptMessageRef => m.message != null)
    : [];

  const brief = node.brief != null && node.brief !== "" ? node.brief : null;
  const hasPrompt = promptMessages.length > 0;

  // The prompt list is a feed of labeled entries in the same sense the activity feed
  // is — a band tag and its meta against a body of text — so it is arranged by the
  // same app-wide preference rather than by a second, prompt-only choice: a reader who
  // set the console to "stacked" because a fixed left column wastes width on their
  // screen means it here too. The three arrangements carry identical information (see
  // the layout blocks in GgPanels.module.scss); only where the label sits differs.
  const feedStyle = useAppSettings((s) => s.eventFeedStyle);

  return (
    <div className={panels.promptView}>
      {/* The brief the agent was dispatched with — from its parent when an agent
          spawned it, from the board when the issue it works was dispatched. */}
      {!isRoot && (
        <section className={panels.promptSection}>
          <span className={panels.subPanelLabel}>
            {node.parentId == null ? "Dispatch brief" : "Brief from parent"}
          </span>
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
          <ul className={panels.promptMessages} data-feed-style={feedStyle}>
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
    return "The exact prompt isn’t recorded for this run; only the brief above is available.";
  return "The exact prompt isn’t recorded for this run.";
}

// One prompt message: its band tag (colored to match the Context graph) over its role
// and token cost, and its full text. The markup is identical in all three feed styles
// — a head and a body, in that document order — and the chosen layout decides whether
// the head becomes a left gutter column or a header row above the body, exactly as
// `FeedView` does for an event line.
//
// The band color is a per-message value (the Context graph's palette, keyed by source)
// rather than one of the `--ttc-event-*` tokens the activity feed's accents come from,
// so it can only reach the stylesheet from here. It rides in as a custom property
// instead of as a `border-left-color`, because each layout draws the accent on a
// different edge — a left bar in "gutter"/"stacked", a rule to the right of the gutter
// column in "divider" — and only a variable can be read by all three.
function PromptMessage({
  source,
  message,
}: {
  source: GgContextSource;
  message: PooledMessage;
}) {
  const color = CONTEXT_SOURCE_COLORS[source];
  return (
    <li
      className={panels.promptMessage}
      style={{ "--band-color": color } as CSSProperties}
    >
      <div className={panels.promptMessageHead}>
        <span className={panels.reqTag} style={{ color }}>
          {CONTEXT_SOURCE_LABELS[source]}
        </span>
        <span className={panels.promptMessageMeta}>
          {message.role}
          {message.tokens != null && ` · ${shortTokens(message.tokens)} tokens`}
        </span>
      </div>
      {message.content != null && message.content !== "" ? (
        <ExpandablePre
          content={message.content}
          className={cx(panels.reqContent, panels.promptContent)}
          label={`${CONTEXT_SOURCE_LABELS[source]} ${message.role} message`}
        />
      ) : (
        <p className={panels.reqEmptyBody}>(no text)</p>
      )}
    </li>
  );
}

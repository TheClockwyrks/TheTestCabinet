/**
 * Hand scoped work to child agents, and hand this session on to another agent.
 *
 * Waiting can dominate a turn's wall clock, because it blocks while real agents run and the run's
 * budget keeps ticking. A program is therefore best shaped to spawn broadly and wait once, rather
 * than to spawn and wait in a loop.
 *
 * The brief is the one place this SDK enforces an "exactly one of" that the native tool-calling
 * schema can only check at dispatch: a child is briefed either with self-contained instructions or
 * with a board issue, and the membrane's variant makes "neither" unrepresentable.
 */

import * as raw from "test-cabinet:gg/delegation";
import type { AgentStatus, SubagentBrief } from "test-cabinet:gg/delegation";
import { call } from "../internal/errors.js";
import { ApiError } from "./core.js";

/** A child agent that was spawned and is now running in parallel. */
export interface SubagentHandle {
  /** The child's id, which `waitForSubagents` and `sendMessage` take. */
  id: string;

  /** The agent profile it runs as. */
  slot: string;

  /** The model actually bound to that agent. */
  modelId: string;

  /**
   * Deliver a message to this child's inbox, with its id already supplied.
   *
   * `gg.delegation.sendMessage` for the common case where the handle is in hand.
   *
   * @ggop delegation.send_message
   * @param message What to put in its inbox. The child reads it at its next turn.
   * @throws `ApiError` with `conflict` when this child has already returned.
   */
  send(message: string): void;
}

/**
 * Dress a membrane handle in the method its own id makes possible.
 *
 * The record crosses the membrane as data, so the method is attached here rather than declared on a
 * class: nothing in a program ever constructs a handle, and a constructible declaration would be one
 * inviting it to. The closure captures the id, which is the whole of what the shorter call saves.
 *
 * @internal
 */
function handle(spawned: raw.SubagentHandle): SubagentHandle {
  return {
    id: spawned.id,
    slot: spawned.slot,
    modelId: spawned.modelId,
    send(message: string): void {
      sendMessage(spawned.id, message);
    },
  };
}

/**
 * How a child agent's loop ended, in the six words the native path also reports.
 *
 * A child stopped by a gg **defect** (`internal_error` natively) has no word here and arrives as
 * `undefined`: this vocabulary is what a program branches on, and there is no branch to write
 * against a bug in the harness running it. The defect is reported to the operator, not to the
 * program.
 */
export type AgentEnding =
  /** It finished normally, and its summary is what it returned. */
  | "completed"
  /** It reached the per-run turn ceiling. */
  | "exhausted"
  /** It passed its wall-clock deadline. */
  | "timed_out"
  /** A model turn failed. */
  | "model_error"
  /** The run's credential was refused. */
  | "auth_error"
  /** An execution ceiling stopped it: consecutive errors, error rate, or cost. */
  | "limit_exceeded";

/** One child agent's collected result. */
export interface SubagentResult {
  /** The child's id. */
  id: string;

  /** How it finished; `undefined` when it produced no return value at all. */
  status: AgentEnding | undefined;

  /** Its final message. */
  summary: string;
}

/**
 * What a child agent is briefed with: written instructions, or a board issue.
 *
 * Spelled out again in the exported signature rather than referenced by name, so the documentation
 * shows the choice itself instead of an alias to look up.
 *
 * @internal
 */
type BriefInput = { prompt: string } | { issueId: string };

/**
 * Lower a brief onto the membrane's variant.
 *
 * The check is explicit rather than delegated to the bindings because "neither" is the mistake that
 * actually happens — the native JSON schema declares both fields optional and enforces the choice
 * only at dispatch — and the message that comes back has to name both options.
 *
 * @internal
 */
function brief(fn: string, request: BriefInput): SubagentBrief {
  const candidate = request as { prompt?: unknown; issueId?: unknown };
  if (typeof candidate.prompt === "string") return { tag: "prompt", val: candidate.prompt };
  if (typeof candidate.issueId === "string") return { tag: "issue", val: candidate.issueId };
  throw new ApiError(fn, "invalid-argument", "expected exactly one of `prompt` or `issueId`");
}

/**
 * Lift a child's ending from the membrane's spelling to gg's own.
 *
 * WIT identifiers cannot contain an underscore, so the membrane says `timed-out`, `model-error`,
 * `auth-error` and `limit-exceeded` while everywhere else gg reports an ending — the native
 * `wait_for_subagents` output included — says `timed_out`, `model_error`, `auth_error` and
 * `limit_exceeded`. Translating here is what keeps a program comparing against the same six words
 * both execution modes use. It matters more than the two-line fix suggests: a literal that does not
 * match is not an error, it is a branch that quietly never runs, and a program that concludes "no
 * child timed out" is worse than one that fails.
 *
 * @internal
 */
function ending(status: AgentStatus | undefined): AgentEnding | undefined {
  switch (status) {
    case "timed-out":
      return "timed_out";
    case "model-error":
      return "model_error";
    case "auth-error":
      return "auth_error";
    case "limit-exceeded":
      return "limit_exceeded";
    default:
      return status;
  }
}

/**
 * Delegate scoped work to a child agent, and hand back its handle at once.
 *
 * The child runs in parallel while the program continues. `agent` selects the child's model, tools
 * and instructions, and must be one of the agents this one may spawn — the system prompt lists them.
 * The brief is exactly one of self-contained instructions or a board issue. The child shares this
 * workspace.
 *
 * @ggop delegation.spawn_subagent
 * @param request The agent to run and the brief to run it on.
 * @param request.agent The agent profile to run the child as, from the ones this agent may spawn. It
 * selects the child's model, tools and instructions.
 * @param request.prompt Self-contained instructions for the child. This or `issueId`, never both and
 * never neither.
 * @param request.issueId The board issue to brief the child from. This or `prompt`, never both and
 * never neither.
 * @returns the child's handle: the id to wait on or message, and the agent and model it runs as.
 * @throws `ApiError` with `limit-exceeded` at the delegation depth cap, and `invalid-argument`
 * when `agent` is not one this agent may spawn or the brief is neither a prompt nor an issue.
 */
export function spawnSubagent(
  request: { agent: string } & ({ prompt: string } | { issueId: string }),
): SubagentHandle {
  return handle(
    call(() => raw.spawnSubagent({ agent: request.agent, task: brief("spawnSubagent", request) })),
  );
}

/**
 * Block until the named children have finished, and collect their results in dispatch order.
 *
 * With no argument it waits for every child still outstanding. The run's wall-clock budget keeps
 * running throughout, so one wait for many children costs far less than one wait per child.
 *
 * @ggop delegation.wait_for_subagents
 * @param ids The children to wait for. Omit it to wait for every one still outstanding.
 * @returns one result per child, in dispatch order: how each finished, and the summary it ended
 * with.
 * @throws `ApiError` with `not-found` for an unknown id.
 */
export function waitForSubagents(ids?: string[]): SubagentResult[] {
  const results = call(() => raw.waitForSubagents(ids));
  return results.map((result) => ({
    id: result.id,
    status: ending(result.status),
    summary: result.summary,
  }));
}

/**
 * Deliver a message to a running child agent's inbox, which it reads at its next turn.
 *
 * @ggop delegation.send_message
 * @param agentId The child to deliver to, as `spawnSubagent` returned it.
 * @param message What to put in its inbox. The child reads it at its next turn.
 * @throws `ApiError` with `not-found` for an unknown agent id, and `conflict` when that child has
 * already returned.
 */
export function sendMessage(agentId: string, message: string): void {
  call(() => raw.sendMessage(agentId, message));
}

/**
 * Move the process this agent runs inside on to another of its states.
 *
 * A state is named the way an agent to spawn is named, and the note is the opening message the next
 * state's agent sees. The call is bound only when a state machine is driving this session and the
 * current state has somewhere to go.
 *
 * Like a compaction it is registered rather than performed: the call validates the target, returns,
 * and the program runs on to its end, because replacing the agent and its window mid-program would
 * pull every remaining call out from under it. The first declaration stands and a second is refused.
 *
 * @ggop delegation.transition_state
 * @param state The state to move on to, named the way an agent to spawn is named.
 * @param note The opening message the next state's agent sees.
 * @throws `ApiError` with `invalid-argument` for a state this agent may not move to, and `refused`
 * for a second declaration in one turn.
 */
export function transitionState(state: string, note?: string): void {
  call(() => raw.transitionState(state, note));
}

/**
 * Continue this session as a different agent from the next turn on.
 *
 * The named agent takes over with its own model, tools and instructions, keeping every capability the
 * two of them share — the whole conversation above all, so it needs no catching up. The prompt is its
 * opening instruction rather than a briefing.
 *
 * Registered rather than performed, exactly as a state transition is and for the same reason. A
 * session makes one succession per turn, so a second one is refused. The call is bound only when this
 * agent may make agent transitions and has agents it may become, and never while a state machine is
 * driving the session.
 *
 * @ggop delegation.exec
 * @param agent The agent to become, from the ones this agent may become.
 * @param prompt Its opening message. It already holds the whole conversation, so this is the
 * instruction rather than a briefing.
 * @throws `ApiError` with `invalid-argument` for an agent this one may not become, and `refused`
 * for a second succession in one turn.
 */
export function exec(agent: string, prompt?: string): void {
  call(() => raw.exec(agent, prompt));
}

/**
 * Run a copy of this agent, in parallel, on something this one will not do itself.
 *
 * The copy has the same model, the same tools and a private copy of the whole conversation, so the
 * prompt is the *difference* rather than a briefing: everything already worked out is already there.
 *
 * Its handle comes back at once, but the copy starts only once this turn's results are recorded,
 * because the conversation it inherits has to be a complete one. So it can be collected only on a
 * later turn, and waiting on it in the program that made it never returns it.
 *
 * @ggop delegation.fork
 * @param prompt What the copy is to do instead. It holds the whole conversation already, so the
 * difference is what to write.
 * @returns the copy's handle, which only a later turn can collect.
 * @throws `ApiError` with `limit-exceeded` at the delegation depth cap.
 */
export function fork(prompt: string): SubagentHandle {
  return handle(call(() => raw.fork(prompt)));
}

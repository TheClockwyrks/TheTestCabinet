/**
 * The `delegation` family: handing scoped work to child agents.
 *
 * These are the calls that can dominate a turn's wall clock — `waitForSubagents`, `runWorkflow` and
 * `speculate` all block while real agents run — and the run's budget keeps ticking while they do.
 * A program should therefore spawn broadly and wait once, not spawn-and-wait in a loop.
 *
 * The brief is the one place the SDK enforces an "exactly one of" that the native tool-calling
 * schema can only check at run time: a child is briefed either with a self-contained `prompt` or
 * with a board `issueId`, and the membrane's variant makes "neither" unrepresentable.
 */

import * as raw from "test-cabinet:gg/delegation";
import type { AgentStatus, SubagentBrief } from "test-cabinet:gg/delegation";
import { ToolError, U8_MAX, call, list, uint } from "../errors.js";
import type {
  AgentEnding,
  SpeculationReport,
  SubagentHandle,
  SubagentResult,
  WorkflowReport,
} from "../types.js";

/**
 * What a child agent is briefed with: written instructions, or a board issue.
 *
 * Spelled out again in the two exported signatures rather than referenced by name, so the prompt
 * shows a model the choice itself instead of an alias it would have to look up.
 */
type BriefInput = { prompt: string } | { issueId: string };

/**
 * Lower a brief onto the membrane's variant.
 *
 * The check is explicit rather than delegated to the bindings because "neither" is the mistake that
 * actually happens — the native JSON schema declares both fields optional and enforces the choice
 * only at dispatch — and the message a model gets back has to name both options.
 */
function brief(fn: string, request: BriefInput): SubagentBrief {
  const candidate = request as { prompt?: unknown; issueId?: unknown };
  if (typeof candidate.prompt === "string")
    return { tag: "prompt", val: candidate.prompt };
  if (typeof candidate.issueId === "string")
    return { tag: "issue", val: candidate.issueId };
  throw new ToolError(
    fn,
    "invalid-argument",
    `${fn}(…) needs exactly one of \`prompt\` (a self-contained brief) or \`issueId\` (a board issue).`,
  );
}

/**
 * Delegate scoped work to a child agent and return its handle immediately — the child runs in
 * parallel while your program continues. Name the `agent` to run it as (one of the agents you may
 * spawn — the system prompt lists them; it selects the child's model, tools, and instructions) and
 * brief it with exactly one of `prompt` (self-contained instructions) or `issueId` (a board issue).
 * The child shares your workspace. Throws `refused` at the delegation depth cap, and
 * `invalid-argument` if `agent` is not one you may spawn.
 */
export function spawnSubagent(
  request: { agent: string } & ({ prompt: string } | { issueId: string }),
): SubagentHandle {
  return call(() =>
    raw.spawnSubagent({
      agent: request.agent,
      task: brief("spawnSubagent", request),
    }),
  );
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
 * Block until the named children have finished — or, with no argument, until every outstanding child
 * has — and collect their results in dispatch order. The run's wall-clock budget keeps running while
 * you wait, so wait once for many children rather than once per child. Throws `not-found` for an
 * unknown id.
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
 * Deliver a message to a running child agent's inbox; it reads the message at its next turn. Throws
 * `not-found` for an unknown agent id and `conflict` when that child has already returned.
 */
export function sendMessage(agentId: string, message: string): void {
  call(() => raw.sendMessage(agentId, message));
}

/**
 * Run a declared multi-stage fan-out as one unit and return the final stage's results. Each stage
 * names the `agent` to run its children as (one of the agents you may spawn), and its `prompt` is a
 * template in which `{{item}}` is the item being worked and `{{prior}}` is the previous stage's
 * collected results; the first stage must supply `items`, and a later stage that omits them fans out
 * over the previous stage's results instead. Blocks until every stage is done.
 */
export function runWorkflow(
  stages: {
    name?: string;
    prompt: string;
    items?: string[];
    agent: string;
  }[],
): WorkflowReport {
  return call(() =>
    raw.runWorkflow(
      list<(typeof stages)[number]>("runWorkflow", "stages", stages).map(
        (stage) => ({
          name: stage.name,
          prompt: stage.prompt,
          items: stage.items,
          agent: stage.agent,
        }),
      ),
    ),
  );
}

/**
 * Attempt the same task K times in parallel isolated worktrees, judge the attempts, then merge the
 * winner and discard the losers. Name the `agent` to run every attempt as (one of the agents you may
 * spawn). `attempts` is clamped to 2–6 and defaults to 2; `approaches` are positional per-attempt
 * hints, and attempts past the end of the list get none. Blocks until the winner is merged.
 */
export function speculate(
  request: { agent: string } & ({ prompt: string } | { issueId: string }) & {
      attempts?: number;
      approaches?: string[];
    },
): SpeculationReport {
  return call(() =>
    raw.speculate({
      agent: request.agent,
      task: brief("speculate", request),
      attempts: uint("speculate", "attempts", request.attempts, U8_MAX),
      approaches: list("speculate", "approaches", request.approaches),
    }),
  );
}

/**
 * Move the process you are running inside on to another of its states, naming the state the way you
 * name an agent to spawn; `note` is the opening message the next state's agent sees. Bound only when
 * a state machine is driving you and the state you are in has somewhere to go. Like `compact` it is
 * registered rather than performed: the call validates the target, returns, and your program runs on
 * to its end — the transition happens after that, because replacing your agent (and your window)
 * mid-program would pull every remaining call out from under it. The FIRST declaration stands, and a
 * second throws `refused`. Throws `invalid-argument` for a state you may not move to.
 */
export function transitionState(state: string, note?: string): void {
  call(() => raw.transitionState(state, note));
}

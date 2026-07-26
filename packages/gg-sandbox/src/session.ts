/**
 * Ending the run — the one model-facing function that is not a gg tool.
 *
 * It lives beside the tools rather than among them because nothing about it is a tool: no capability
 * offers it, it dispatches nothing, and it is bound into every program's scope including one in a run
 * that enables no tools at all. Keeping it out of `TOOL_CATALOGUE` is what keeps the catalogue in
 * exact bijection with the gg tool vocabulary the component is checked against.
 *
 * **Why the run needs it at all.** Under responses-as-code every reply is a program, so there is no
 * prose turn that could mean "I am done" — a model that answers "task complete" has written a reply
 * that failed to be a program, not a completion. {@link finish} is the only thing that ends a session.
 *
 * **Why it is one line.** Ending the run is a fact about the *agent*, not about the program that
 * declared it, so the flag lives in the agent's host-side context and this module holds none of it:
 * no module state to reset between programs, no sentinel class, no unwind. The host records the
 * declaration, keeps it while the program runs on, and revokes it if the program then fails —
 * decisions that belong where the run is owned rather than inside a sandbox the program shares a
 * scope with.
 */

import * as raw from "test-cabinet:gg/session";
import { ToolError, call } from "./errors.js";

/** The gg name this module reports its one failure under. It is not a tool name; nothing dispatches it. */
const FINISH = "finish";

/**
 * End this run. The `summary` is gg's final word on the task: what you did, in a sentence or two.
 * This is the ONLY thing that ends a run — prose does not, an empty reply does not. It does NOT stop
 * your program: it returns like any other call, and whatever you write after it still runs, so call
 * it last, from a program that has just checked with the tools that the work is really done. If your
 * program then fails, the ending is cancelled and you get another turn.
 */
export function finish(summary: string): void {
  // The one check that can only happen here. TypeScript is stripped, not enforced, so `finish(42)`
  // is a program a model really writes — and by the time the call crosses the membrane the WIT has
  // declared the parameter a string, so the host cannot tell a number from the text of one. Whether
  // the summary is *usable* is the host's question and is asked there.
  if (typeof summary !== "string") {
    throw new ToolError(
      FINISH,
      "invalid-argument",
      `${FINISH}(…) takes a summary string — one or two sentences saying what you did. The run is ` +
        "NOT finished; write the summary and call it again.",
    );
  }
  call(() => raw.finish(summary));
}

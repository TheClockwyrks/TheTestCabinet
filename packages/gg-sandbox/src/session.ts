/**
 * Ending the session — the model-facing functions that are not gg tools.
 *
 * They live beside the tools rather than among them because nothing about them is a tool: no
 * capability offers them, they dispatch nothing, and one group of them is bound into every program's
 * scope including one in a run that enables no tools at all. Keeping them out of `TOOL_CATALOGUE` is
 * what keeps the catalogue in exact bijection with the gg tool vocabulary the component is checked
 * against.
 *
 * **Why a session needs them at all.** Under responses-as-code every reply is a program, so there is
 * no prose turn that could mean "I am done" — a model that answers "task complete" has written a
 * reply that failed to be a program, not an ending.
 *
 * **Why there is more than one.** An ending is a *result*, and different roles produce different
 * results: an agent doing work reports what it did, and a reviewer returns a
 * winner. Each is a different shape, so each is a different call whose signature carries exactly what
 * that result is made of, and the host binds one group per program. A role's ending is therefore the
 * only ending its program can express — and nothing has to be read back out of prose.
 *
 * **Why they are one line each.** Ending is a fact about the *agent*, not about the program that
 * declared it, so the flag lives in the agent's host-side context and this module holds none of it:
 * no module state to reset between programs, no sentinel class, no unwind. The host records the
 * declaration, keeps it while the program runs on, and revokes it if the program then fails —
 * decisions that belong where the session is owned rather than inside a sandbox the program shares a
 * scope with.
 *
 * Every JSDoc block below is **model-facing**: it is reflected into the signature catalogue and is
 * what `fn.docs()` answers with. It says what to call and when, and nothing about the harness.
 */

import * as raw from "test-cabinet:gg/session";
import { ToolError, call, typeName } from "./errors.js";

/** The names this module reports its failures under. They are not tool names; nothing dispatches them. */
const FINISH = "finish";
const REQUEST_CHANGES = "requestChanges";

/**
 * Reject a mistyped argument here in the guest, which is the only place that can see it: TypeScript
 * is stripped rather than enforced, so `finish(42)` is a program a model really writes — and by the
 * time the call crosses the membrane the WIT has declared the parameter a string, so the host cannot
 * tell a number from the text of one. Whether a value is *usable* is the host's question.
 */
function requireString(fn: string, expected: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new ToolError(
      fn,
      "invalid-argument",
      `expected ${expected}, got ${typeName(value)}`,
    );
  }
}

/**
 * End your session, reporting what you did in a sentence or two. This is the only thing that ends it.
 *
 * It does not stop your program — whatever follows it still runs — so call it last, once the tools
 * have confirmed the work is really done. If your program then fails, the ending is cancelled and you
 * get another turn.
 *
 * @param summary What you did, in a sentence or two.
 */
export function finish(summary: string): void {
  requireString(FINISH, "a summary string", summary);
  call(() => raw.finish(summary));
}

/**
 * Accept the work you are reviewing: it meets every completion criterion and stays in scope. This
 * ends your session.
 *
 * It does not stop your program — whatever follows it still runs — so call it last, once you have
 * actually read the change.
 */
export function approve(): void {
  call(() => raw.approve());
}

/**
 * Reject the work you are reviewing, listing every change that must be made before it can be
 * accepted. Each item says what is wrong and what to change; the list may not be empty. This ends
 * your session, and does not stop your program.
 *
 * @param items Every change that must be made before the work can be accepted, one per entry:
 * what is wrong, and what to change. It may not be empty.
 */
export function requestChanges(items: string[]): void {
  if (!Array.isArray(items)) {
    throw new ToolError(
      REQUEST_CHANGES,
      "invalid-argument",
      `expected an array of strings, got ${typeName(items)}`,
    );
  }
  const listed = items.map((item) => (typeof item === "string" ? item : String(item)));
  call(() => raw.requestChanges(listed));
}


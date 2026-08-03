/**
 * The error type every tool function throws, and the argument validators every wrapper runs first.
 *
 * **Why an error type at all.** A `result<T, tool-error>` surfaces in JavaScript as a *throw*, so
 * the happy path of a program is already unwrapped — `const text = readTextFile(p)` is a string, not
 * something to unwrap — and a failure stops the program instead of poisoning it with `undefined`.
 * What the component model throws, though, is a bare record: `e instanceof Error` is `false`,
 * `String(e)` is `"Error: [object Object] (see error.payload)"`, and the fields are hidden one level
 * down under a non-enumerable `payload`. {@link asToolError} normalises that into a real
 * {@link ToolError}, which is what a program catches and what the shim reports.
 *
 * **Why the validators.** The host type-*strips* a model's TypeScript with `oxc`; it does not
 * type-*check* it. Nothing between the model and the membrane rejects a wrong argument, and three
 * mistakes are otherwise silent or unreadable:
 *
 * - `shell("npm test", 300)` reads `options.timeoutSecs` off a number, gets `undefined`, and quietly
 *   uses the 120 s default — the model never learns its timeout was ignored.
 * - `readFile("a.ts", { offset: -1 })` lowers to `offset: 4292870144` by two's-complement wrap, and
 *   the read fails for a reason that has nothing to do with what was written.
 * - A missing `list<T>` record field throws `TypeError: can't access property "length", vec6 is
 *   undefined` — an opaque message that names neither the tool nor the field.
 *
 * Bad *enum* strings and bad *variant tags* already produce good messages from the generated
 * bindings (`TypeError: "bogus" is not one of the cases of task-status`), so the validators here
 * cover exactly the gap and nothing more.
 */

import type { ErrorCode } from "test-cabinet:gg/types";
import type { ToolErrorCode } from "./types.js";

export type { ToolErrorCode } from "./types.js";

/**
 * A gg tool that failed.
 *
 * Thrown by every tool function. Catch it when a failure is expected and branch on
 * {@link ToolError.code}; let it escape when it is not, and gg reports which tool failed and on
 * which line of the program.
 */
export class ToolError extends Error {
  /** The gg tool that failed (`read_file`, `spawn_subagent`, …). */
  readonly tool: string;
  /** The failure class, so a catch site branches on a value rather than on prose. */
  readonly code: ToolErrorCode;

  constructor(tool: string, code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.tool = tool;
    this.code = code;
  }

  /**
   * The JSON form of the failure.
   *
   * `Error.prototype.message` is **non-enumerable**, so without this `JSON.stringify(e)`,
   * `console.log({ err: e })` and `console.log(failures.map((f) => f.error))` all silently drop the
   * one field the system prompt tells the model to read. Logging is a program's only channel and
   * every logged value is rendered through `JSON.stringify`, so this is the difference between a
   * reported failure and `{}`.
   */
  toJSON(): { name: string; tool: string; code: ToolErrorCode; message: string } {
    return { name: this.name, tool: this.tool, code: this.code, message: this.message };
  }
}

/**
 * The failure fields, dug out of whatever the binding threw.
 *
 * Both the thrown value itself and its nested `payload` are inspected, because a failing
 * `result<T, tool-error>` arrives as an object whose only own key is `payload`. Anything that does
 * not carry all three fields is not a membrane failure and is left alone.
 */
function unwrap(thrown: unknown): { tool: string; code: ErrorCode; message: string } | undefined {
  const nested =
    thrown === null || thrown === undefined ? undefined : (thrown as { payload?: unknown }).payload;
  for (const candidate of [thrown, nested]) {
    if (candidate === null || typeof candidate !== "object") continue;
    const record = candidate as { tool?: unknown; code?: unknown; message?: unknown };
    if (
      typeof record.tool === "string" &&
      typeof record.code === "string" &&
      typeof record.message === "string"
    ) {
      // The one place the membrane's `ErrorCode` becomes the model-facing `ToolErrorCode`: the
      // assignment below is what makes `tsc` reject a WIT arm `src/types.ts` has not learned about.
      return { tool: record.tool, code: record.code as ErrorCode, message: record.message };
    }
  }
  return undefined;
}

/**
 * Normalise whatever the component-model binding threw into a {@link ToolError}.
 *
 * A value that is not a membrane failure — a `TypeError` from the program itself, a thrown string —
 * is returned unchanged, so the shim can describe it on its own terms.
 */
export function asToolError(thrown: unknown): unknown {
  // Already normalised: return it untouched rather than rebuilding an identical one. The rebuild
  // was not free — a fresh `Error` captures a fresh stack, and this function is called a second
  // time by the shim, from a frame the model's program is nowhere near. Re-wrapping there replaced
  // the stack that knew which line of the program called the tool, and every tool failure lost its
  // reported location.
  if (thrown instanceof ToolError) return thrown;
  const record = unwrap(thrown);
  return record ? new ToolError(record.tool, record.code, record.message) : thrown;
}

/**
 * Whether a thrown value is an `Error`, **whichever realm made it**.
 *
 * `instanceof Error` is not enough here, and getting that wrong cost every binding-level fault its
 * message. The generated component bindings live in `initializer.js`, which this engine evaluates
 * against a *different* `Error` intrinsic than the one this module and the model's program see — so
 * the `TypeError: expected a string, received [undefined]` that a mistyped argument raises answers
 * `false` to `instanceof Error`, falls past every branch that reads `.name` and `.message`, and is
 * reported by {@link "./shim.js".describe} as whatever `JSON.stringify` makes of it. An `Error`'s
 * own fields are non-enumerable, so that is the literal string `{}` — a runtime error carrying no
 * information at all, for the single most common mistake a model makes against this API.
 *
 * The brand check is realm-independent: `Object.prototype.toString` reads the internal slot every
 * `Error` carries whatever intrinsic constructed it.
 */
export function isErrorLike(thrown: unknown): thrown is Error {
  if (thrown instanceof Error) return true;
  return (
    typeof thrown === "object" &&
    thrown !== null &&
    Object.prototype.toString.call(thrown) === "[object Error]"
  );
}

/** An error-like value's `name`, defaulting to `Error` when it carries nothing usable. */
export function errorName(error: Error): string {
  return typeof error.name === "string" && error.name !== "" ? error.name : "Error";
}

/** An error-like value's `message`, coerced, so a cross-realm error is never rendered as `{}`. */
export function errorMessage(error: Error): string {
  return typeof error.message === "string" ? error.message : String(error);
}

/**
 * A thrown value that is **not** an error, as a line of text that says something.
 *
 * `JSON.stringify` alone is not enough: a `Map`, a `Set`, a class instance with only accessor
 * properties and an `Error` from another realm all serialise to `{}`, which tells the model
 * precisely nothing. When that happens the value is described instead — what it stringifies to, and
 * which own properties it carries — so the model can at least recognise what it threw.
 */
export function describeThrown(thrown: unknown): string {
  if (typeof thrown === "string") return thrown;
  let json: string | undefined;
  try {
    json = JSON.stringify(thrown);
  } catch {
    json = undefined;
  }
  if (json !== undefined && json !== "{}") return json;
  const text = String(thrown);
  if (thrown === null || typeof thrown !== "object") return text;
  const own = Object.getOwnPropertyNames(thrown);
  const fields = own.length > 0 ? `, own properties: ${own.join(", ")}` : "";
  return `your program threw a value that is not an Error: ${text}${fields}`;
}

/** Run one membrane call, converting a thrown WIT record into a {@link ToolError}. */
export function call<T>(fn: () => T): T {
  try {
    return fn();
  } catch (thrown) {
    throw asToolError(thrown);
  }
}

/**
 * An options object, or a {@link ToolError} naming the positional mistake.
 *
 * Every optional argument in this SDK travels in a trailing options object, so a model that writes
 * `shell("npm test", 300)` — the shape the native tool-calling schema would have taken — is told
 * exactly that, instead of silently getting the default.
 */
export function opts<T extends object>(fn: string, value: unknown): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(
      fn,
      "invalid-argument",
      `${fn}(…) takes an options object for its optional arguments, not a bare value — ` +
        `write ${fn}(…, { … }).`,
    );
  }
  return value as T;
}

/** The `u32` range, so no wrapper inlines the magic number. */
export const U32_MAX = 4_294_967_295;

/** The `u8` range, so no wrapper inlines the magic number. */
export const U8_MAX = 255;

/**
 * A whole number in `[0, max]`, or a {@link ToolError}.
 *
 * The membrane lowers a negative or fractional number by silently wrapping it — `-1` arrives as
 * `4294967295` — so the range check has to happen on this side of it.
 */
export function uint(
  fn: string,
  name: string,
  value: unknown,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new ToolError(
      fn,
      "invalid-argument",
      `${fn}(…): \`${name}\` must be a whole number between 0 and ${max}, got ${String(value)}.`,
    );
  }
  return value;
}

/** A finite positive number, or a {@link ToolError}. */
export function positive(fn: string, name: string, value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ToolError(
      fn,
      "invalid-argument",
      `${fn}(…): \`${name}\` must be a positive number, got ${String(value)}.`,
    );
  }
  return value;
}

/**
 * A list argument, defaulted to `[]`, or a {@link ToolError}.
 *
 * Every `list<T>` field of a membrane record goes through this. A record field left off entirely
 * does not arrive as an empty list: it arrives as `undefined` and the lowering code trips over it
 * with a message that names neither the tool nor the field.
 *
 * The element type is a parameter because most lists are lists of ids but one — a workflow's stages
 * — is a list of records; the check itself is the same, and it is deliberately shallow, because the
 * bindings already reject a wrong element with a message that names the offending case.
 */
export function list<T = string>(fn: string, name: string, value: unknown): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ToolError(fn, "invalid-argument", `${fn}(…): \`${name}\` must be an array.`);
  }
  return value as T[];
}

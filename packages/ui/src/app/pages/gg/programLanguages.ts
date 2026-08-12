import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";

/**
 * How each [program language](GgProgramLanguage) — each SDK **arm** — is named to a
 * reader.
 *
 * A `Record` over the union rather than a lookup with a fallback, so a language gg
 * registers without naming it here is a TypeScript error rather than an arm a picker
 * spells with a wire id. That property is the reason this lives in a module of its own
 * and not beside the one component that first needed it: the Reference page's header, its
 * arm picker and its "loading the … surface" line all name an arm, and three fallbacks are
 * three places for a new arm to look half-added.
 *
 * **This is the only table of these names**, which is why it sits a level above the
 * Reference page that first needed it. The run-configuration editor's language picker
 * (`pages/runs/gg/ggCatalog.ts`) is a spread of this with one key overridden — the
 * JavaScript arm's "(no type check)" annotation, which matters when you are choosing an arm
 * and not when you are reading one. Two exhaustive `Record`s over the same union would
 * still be two spellings of eleven names; exhaustiveness catches a missing arm, never a
 * disagreeing one.
 *
 * These are the names the languages' own communities write, not the ids: `C#` rather
 * than `csharp`, `C++` rather than `cpp`. The id is what the address bar and the wire
 * carry, and it is not what a reader is looking for in a row of eleven buttons.
 */
export const PROGRAM_LANGUAGE_NAMES: Record<GgProgramLanguage, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  ruby: "Ruby",
  purescript: "PureScript",
  java: "Java",
  kotlin: "Kotlin",
  rust: "Rust",
  swift: "Swift",
  cpp: "C++",
  csharp: "C#",
};

/**
 * Whether a string off the address bar is a [program language](GgProgramLanguage) id at
 * all, narrowing it to one when it is.
 *
 * The check is against {@link PROGRAM_LANGUAGE_NAMES}'s keys rather than against the
 * arms a deployment happens to list, because the two questions are different and the page
 * answers them differently: a spelling that is not a language id at all, and a language
 * id this deployment's gg does not register, are both refused — but only the second is
 * worth telling a reader which arms *are* here.
 */
export function isProgramLanguage(value: string): value is GgProgramLanguage {
  return Object.prototype.hasOwnProperty.call(PROGRAM_LANGUAGE_NAMES, value);
}

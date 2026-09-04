// Deepcore — a host with nowhere to save, for the checks that are about that.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// specs/expedition.md: "The save is held in the browser. The game runs correctly
// when that storage is unavailable, simply without saving." A browser refuses the
// storage in ordinary circumstances — a private window, third-party cookies
// blocked, a quota already spent — so this is a path real players walk.
//
// HOW THE STORAGE IS TAKEN AWAY. Every door is shut before the engine is built,
// so the build initializes against a host that never had one, and shut the way a
// browser shuts them: reading `localStorage` or `sessionStorage` THROWS a
// `SecurityError`, which is what Chromium does when site data is blocked, and
// `indexedDB` is simply not there. A getter that throws is deliberately harsher
// than an absent global, because a build guarding with `typeof localStorage` and
// nothing else passes the absent case and still dies in a real browser.
//
// A THROW IS REPORTED RATHER THAN RAISED. {@link ran} runs a step inside a catch,
// so a build that dies on the storage fails the point that ran it with the
// specification on the `Expected:` line and its own error beside it, rather than
// with a stack the reviewer has to interpret.

import { fail } from "../assert";
import { removeStorage } from "../harness";

/** What the specification requires of a build on a host with no storage. */
export const REQUIREMENT =
  "specs/expedition.md: the game runs correctly when the browser storage is " +
  "unavailable, simply without saving";

/** Shut every store the save could be held in, the way a browser shuts them. */
export function denyStorage(): void {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get(): never {
        const refusal = new Error("storage is unavailable");
        refusal.name = "SecurityError";
        throw refusal;
      },
    });
  }
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get: () => undefined,
  });
}

/** Put the stores back as a Node process leaves them: absent, and quiet about it. */
export function restoreStorage(): void {
  removeStorage();
  for (const name of ["sessionStorage", "indexedDB"]) {
    Object.defineProperty(globalThis, name, {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
}

/** How a thrown value reads on the `Actual:` line. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Run `step`, reporting anything it threw as the running point's failure. */
export async function ran<T>(what: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    fail(REQUIREMENT, `${what} threw ${describe(error)}`);
  }
}

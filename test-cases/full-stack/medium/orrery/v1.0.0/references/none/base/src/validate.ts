// Orrery — the debug surface's argument checks (specs/instrumentation.md).
//
// "An argument outside the domain its operation states is invalid, and the
// call fails loudly rather than guessing what was meant." Every check below
// raises a plain `Error` naming the operation, the argument, and the domain it
// left, and raises it BEFORE anything is written, so a refused call changes
// nothing.

/** Raise the surface's error for one operation and argument. */
export function invalid(
  operation: string,
  argument: string,
  domain: string,
  got: unknown,
): never {
  throw new Error(
    `${operation}: ${argument} must be ${domain}; got ${describe(got)}`,
  );
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

/** A boolean, or the call fails. */
export function requireBoolean(
  operation: string,
  argument: string,
  value: unknown,
): boolean {
  if (typeof value !== "boolean") {
    invalid(operation, argument, "a boolean", value);
  }
  return value;
}

/** A finite number, or the call fails. */
export function requireNumber(
  operation: string,
  argument: string,
  value: unknown,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(operation, argument, "a finite number", value);
  }
  return value;
}

/** A whole number of at least `least`, or the call fails. */
export function requireWhole(
  operation: string,
  argument: string,
  value: unknown,
  least = 0,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < least) {
    invalid(operation, argument, `a whole number of at least ${least}`, value);
  }
  return value;
}

/** A whole number from `least` to `most`, or the call fails. */
export function requireRange(
  operation: string,
  argument: string,
  value: unknown,
  least: number,
  most: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < least ||
    value > most
  ) {
    invalid(operation, argument, `a whole number ${least} to ${most}`, value);
  }
  return value;
}

/** One of a fixed list of names, or the call fails. */
export function requireOneOf<T extends string>(
  operation: string,
  argument: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(operation, argument, `one of ${allowed.join(", ")}`, value);
  }
  return value as T;
}

// How a check calls a surface, which is the one thing the four engines really
// disagree about.
//
// A case's `surface.ts` states the surface the SPECIFICATION requires. What a
// check holds is a DRIVER: that surface as it is actually called, over the engine
// that holds the state. Three shapes of driver exist in the tree, and which one a
// case needs falls out of its engine's state model rather than out of anything
// the case chose:
//
//   IDENTITY — a structured engine's surface is already imperative. A pose takes
//   only its own arguments and returns nothing, a reading takes nothing and
//   returns plain data, and the object the build returned IS the driver. Nothing
//   stands between a check and it.
//
//   PROMISE-WRAP — the same imperative surface, with every member answering a
//   promise. Not because anything is asynchronous: because a case whose OTHER
//   engine needs an asynchronous driver writes one suite for both, and a suite
//   that awaits a member reads identically over an engine that had nothing to
//   wait for. The cost of the wrap is one microtask; the cost of not having it is
//   two copies of every check.
//
//   APPLY-THREADED — a simple engine holds the state by value, so the surface is
//   PURE: a pose is `(state, ...args) => State` and a reading is `(state) => R`.
//   Neither can be called by a check directly, because neither has the state. The
//   driver supplies it: a reading is handed `engine.state` and its answer comes
//   straight back, and a pose is run through `engine.apply`, so the state it
//   returns is the state the next frame receives.
//
// WHICH MEMBERS ARE READINGS IS THE CASE'S TO SAY. Nothing about a pure surface
// distinguishes a pose from a reading at run time — both are functions of the
// state — so the apply-threaded driver takes the case's own `READINGS` list, the
// one its `surface.ts` already declares for exactly this reason. A member not on
// it is a pose.
//
// EVERY DRIVER IS LAZY, AND THAT IS DELIBERATE. The member is read off the raw
// surface at the moment a check reaches for it, so a build that returned no
// surface, or a surface missing an operation, fails the CHECK that needed it and
// never the `beforeEach` that built the harness. See `./surface`.

/** A member that is not a function comes back untouched — `version`, and an
 * operation the build left out, which is what lets a check test for one by
 * `typeof`. */
function passthrough(value: unknown): boolean {
  return typeof value !== "function";
}

/** The keys that belong to the machinery rather than to a check. */
function machineryKey(property: string | symbol): boolean {
  return (
    typeof property === "symbol" ||
    property === "then" ||
    property === "constructor"
  );
}

/**
 * The surface as it stands: a structured engine's surface is already what a check
 * calls.
 *
 * Kept as a named function rather than left implicit at each call site, because
 * naming it is what makes the three strategies read as three strategies — a case
 * on a structured engine states which one it is using, and its `Driver` type
 * alias says the same thing in the type system.
 */
export function identityDriver<D>(raw: D): D {
  return raw;
}

/** Every member of `D`, answering a promise of what the raw member answers. */
export type Awaited<D> = {
  [K in keyof D]: D[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : D[K];
};

/**
 * The imperative surface with every member answering a promise.
 *
 * For a case that shares one suite across an engine whose driver must be
 * asynchronous and one whose need not be: the suite awaits, and both drivers
 * satisfy it. A member that is not a function is answered as it is, so a `typeof`
 * probe reads the same through this driver as through the raw surface.
 */
export function promiseDriver<
  Raw extends object,
  D extends object = Awaited<Raw>,
>(raw: Raw): D {
  return new Proxy({} as D, {
    get: (_target, property): unknown => {
      if (machineryKey(property)) return undefined;
      const member = (raw as unknown as Record<string, unknown>)[
        property as string
      ];
      if (passthrough(member)) return member;
      const op = member as (...args: unknown[]) => unknown;
      return async (...args: unknown[]): Promise<unknown> =>
        op.apply(raw, args);
    },
  });
}

/**
 * One member of a PURE surface, as a check calls it.
 *
 * A pose `(state, ...args) => Write` becomes `(...args) => void`: the driver runs
 * it through `apply`, so the state it returns is the state the next frame
 * receives, and there is nothing for a caller to do with the return. A reading
 * `(state) => R` becomes `() => R`: the driver hands it the current state.
 * Anything else — a `version` number — is carried as it is.
 *
 * `Read` and `Write` are the two faces of the case's state: the deep-readonly
 * view an engine hands out, and the value a transition returns. They are
 * separate parameters because the case knows both and this package names
 * neither — the deep-readonly type is the ENGINE's, and importing it here would
 * be importing an engine.
 */
export type DrivenMember<Read, Write, M> = M extends (
  state: Read,
  ...args: infer A
) => Write
  ? (...args: A) => void
  : M extends (state: Read) => infer R
    ? () => R
    : M;

/**
 * The imperative reading of a pure surface `D`: every member, minus its state
 * argument.
 *
 * The TYPE the {@link applyDriver} value produces, written once here so a case
 * declares `type CaseDriver = PureDriver<DeepReadonly<State>, State, CaseSurface>`
 * rather than restating the conditional mapping.
 */
export type PureDriver<Read, Write, D> = {
  [K in keyof D]: DrivenMember<Read, Write, NonNullable<D[K]>>;
};

/**
 * As much of a simple engine as the apply-threaded driver needs.
 *
 * `Read` is the state as the engine hands it out — a deep-readonly view, under
 * every simple engine — and `Write` is the state a transition returns. The two
 * are different types and the case knows both, so they are parameters here rather
 * than one type this package would have to name.
 */
export interface ApplyEngine<Read, Write> {
  /** The current state, as a read-only view. */
  readonly state: Read;
  /** Replace the state with the one `transition` returns from the current one. */
  apply(transition: (state: Read) => Write): unknown;
}

/** What the apply-threaded driver needs to know about the case's surface. */
export interface ApplyDriverOptions {
  /**
   * The members of the surface that are READINGS rather than poses — the case's
   * own `READINGS`, from its `surface.ts`.
   *
   * A reading is handed `engine.state` and its answer comes back; everything else
   * is a pose and is run through `engine.apply`.
   */
  readings: readonly string[];
  /**
   * A reading's answer, narrowed before it reaches the check.
   *
   * The one place a case's snapshot projection belongs on this engine: every read
   * of the surface goes through this driver, so narrowing here narrows the direct
   * `h.debug.snapshot()` and the reads a sweep makes alike, and there is nowhere
   * else a projection could be applied that would catch both. Answers the value
   * unchanged for an operation it does not narrow.
   */
  project?: (op: string, value: unknown) => unknown;
}

/**
 * The imperative reading of a PURE surface, over the engine that holds the state.
 *
 * A pose that returns nothing is refused by the engine itself, with a message
 * naming the rule — this driver does not second-guess it, because the rule is the
 * engine's and its message is the one a build's author needs.
 */
export function applyDriver<Read, Write, D extends object>(
  engine: ApplyEngine<Read, Write>,
  raw: object,
  options: ApplyDriverOptions,
): D {
  const readings = new Set(options.readings);
  const project = options.project;
  return new Proxy({} as D, {
    get: (_target, property): unknown => {
      if (machineryKey(property)) return undefined;
      const name = property as string;
      const member = (raw as Record<string, unknown>)[name];
      if (passthrough(member)) return member;
      const op = member as (state: Read, ...args: unknown[]) => unknown;
      if (readings.has(name)) {
        return (): unknown => {
          const value = op.call(raw, engine.state);
          return project === undefined ? value : project(name, value);
        };
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as Write);
      };
    },
  });
}

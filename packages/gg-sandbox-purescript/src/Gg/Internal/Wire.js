// The JavaScript half of the bridge: the only file in this SDK that names the guest's own objects.
//
// A compiled PureScript program is evaluated by the shared ECMAScript guest as the body of a
// function whose PARAMETERS are gg's modules. So `fs`, `system`, `view` and the rest are free
// identifiers here, resolved at call time against the scope the guest built — which is exactly why
// every reference below is inside a function body rather than at the top level: evaluating this
// bundle must not touch a name before the scope carrying it exists.
//
// THE GUEST BINDS EVERY MODULE, WHATEVER THE RUN ENABLED. It did not always: the scope used to be
// built from the run's enabled tools, so a withheld capability arrived here as an absent object and
// this file synthesized the refusal for it. The host is the gate now, on every arm, so what is
// absent below is drift between this SDK and the guest artifact rather than a capability the run
// withheld — which is why the fallback says so in those words.

// The API object `name`, or `undefined` when the guest does not export it under that name.
//
// A switch rather than a lookup on `globalThis`, and that is forced rather than chosen: these names
// are the enclosing function's parameters, so nothing can reach them by string. `typeof` is what
// makes an absent one answerable at all — reading an undeclared identifier throws, and `typeof` on
// one does not.
const objectFor = (name) => {
  switch (name) {
    case "fs":
      return typeof fs === "undefined" ? undefined : fs;
    case "system":
      return typeof system === "undefined" ? undefined : system;
    case "project":
      return typeof project === "undefined" ? undefined : project;
    case "tasks":
      return typeof tasks === "undefined" ? undefined : tasks;
    case "memory":
      return typeof memory === "undefined" ? undefined : memory;
    case "view":
      return typeof view === "undefined" ? undefined : view;
    case "context":
      return typeof context === "undefined" ? undefined : context;
    case "agents":
      return typeof agents === "undefined" ? undefined : agents;
    case "skills":
      return typeof skills === "undefined" ? undefined : skills;
    case "programs":
      return typeof programs === "undefined" ? undefined : programs;
    case "harness":
      return typeof harness === "undefined" ? undefined : harness;
    case "review":
      return typeof review === "undefined" ? undefined : review;
    default:
      return undefined;
  }
};

// The code gg reports a call that could not be made under. Not `unavailable`, which is the host's
// word for a capability this agent was not granted: this file cannot produce that case any more,
// and reusing its code would put a second, differently-worded refusal into the one class a study
// counts withheld capabilities in.
const NOT_EXPORTED = "other";

// What a call the guest does not export throws — an SDK and a guest artifact that disagree.
//
// It is NOT a withheld capability, and the message must not say it is. Every module is bound in
// every program and every function on it is the host's to permit or refuse, so the only way the
// lookup below fails is that this SDK names something `packages/gg-sandbox`'s guest does not
// export: one of the two was rebuilt without the other. A model told its *capability set* was the
// problem would go looking for a tool to enable, which is a turn spent on the wrong thing.
//
// The alternative is a bare `TypeError: fn is not a function`, which says nothing about which call
// failed. `ToolError` is bound into every program's scope by the guest, so this is the same class a
// program's `attempt` catches; the fallback is for a scope that somehow has not got it, where a
// plain error beats no error at all.
const notExported = (tool, written) => {
  const message =
    `\`${written}\` did not reach the guest: gg's SDK declares it and this run's guest does ` +
    "not export it, which is a mismatch between the two rather than anything this program did";
  return typeof ToolError === "function"
    ? new ToolError(tool, NOT_EXPORTED, message)
    : new Error(message);
};

// `written` is the fully-qualified name a PureScript program writes — `Gg.Files.readFile` — and its
// last segment is the guest's own name for the same function. One string rather than two because
// the two halves are the same word: what differs is the qualifier, which is `Gg.Files` on the side
// the model reads and an object in this scope on the side the call lands in.
export const callImpl = (tool) => (namespace) => (written) => (args) => () => {
  const target = objectFor(namespace);
  const name = written.slice(written.lastIndexOf(".") + 1);
  const fn = target === undefined ? undefined : target[name];
  if (typeof fn !== "function") throw notExported(tool, written);
  return fn.apply(target, args);
};

export const boundImpl = (name) => () => objectFor(name) !== undefined;

export const lowerImpl = (converters) => (record) => {
  const lowered = {};
  // `Object.keys` rather than `for … in`: only the fields the PureScript record really carries, so
  // an argument the program left out stays left out.
  for (const key of Object.keys(record)) {
    const convert = converters[key];
    lowered[key] = convert === undefined ? record[key] : convert(record[key]);
  }
  return lowered;
};

export const fieldImpl = (name) => (value) => value[name];

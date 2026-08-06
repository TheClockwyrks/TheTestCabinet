// The JavaScript half of the bridge: the only file in this SDK that names the guest's own objects.
//
// A compiled PureScript program is evaluated by the shared ECMAScript guest as the body of a
// function whose PARAMETERS are the API objects this run enabled. So `fs`, `system`, `view` and the
// rest are free identifiers here, resolved at call time against the scope the guest built — which
// is exactly why every reference below is inside a function body rather than at the top level:
// evaluating this bundle must not touch a name a run may not have bound.

// The API object `name`, or `undefined` when this run did not bind it.
//
// A switch rather than a lookup on `globalThis`, and that is forced rather than chosen: these names
// are the enclosing function's parameters, so nothing can reach them by string. `typeof` is what
// makes an unbound one answerable at all — reading an undeclared identifier throws, and `typeof` on
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

// The code every language's host refuses an out-of-set call with, so a capability this run withheld
// reads the same way in every arm.
const UNAVAILABLE = "unavailable";

// What a call on a capability this run did not offer throws.
//
// The alternative is a bare `ReferenceError: fs is not defined`, which says nothing about which
// call was refused and is classified as a name the model got wrong rather than as a capability it
// was never given. `ToolError` is bound into every program's scope by the guest, so this is the
// same class a program's `attempt` catches; the fallback is for a scope that somehow has not got
// it, where a plain error beats no error at all.
const unavailable = (tool, object, name) => {
  const message =
    `\`${object}.${name}\` is not available in this run: this program's capability set does not ` +
    "offer it";
  return typeof ToolError === "function"
    ? new ToolError(tool, UNAVAILABLE, message)
    : new Error(message);
};

export const callImpl = (tool) => (object) => (name) => (args) => () => {
  const target = objectFor(object);
  const fn = target === undefined ? undefined : target[name];
  if (typeof fn !== "function") throw unavailable(tool, object, name);
  return fn.apply(target, args);
};

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

// The JavaScript half of the bridge: the one file in this SDK that names gg's own SDK.
//
// A compiled PureScript program is an ES module the ECMAScript guest declares under the model's own
// name, so gg's surface is reached the way every other module reaches it — through an `import` line
// written in the source. That line is the one below. `esbuild` is told `gg` is external, so it
// survives into the bundle unchanged, and the guest's loader resolves it to the same SDK instance a
// TypeScript program imports. One instance is what makes `ToolError` one class.
//
// `gg` binds every family whatever the run enabled. A capability this run withheld is refused by the
// host, as a `ToolError` carrying `unavailable`, exactly as it is for every other arm — so a family
// missing here is drift between this SDK and the guest artifact rather than a capability the run
// withheld, which is what the fallback below says.
import * as gg from "gg";
import { ToolError } from "gg";

// The code gg reports a call that could not be made under. Not `unavailable`, which is the host's
// word for a capability this agent was not granted: this file cannot produce that case, and reusing
// its code would put a second, differently-worded refusal into the one class a study counts withheld
// capabilities in.
const NOT_EXPORTED = "other";

// What a call gg's SDK does not export throws — this SDK and the guest's SDK disagreeing.
//
// It is NOT a withheld capability, and the message must not say it is. Every family is bound in
// every program and every function on it is the host's to permit or refuse, so the only way the
// lookup below fails is that this SDK names something `packages/gg-sandbox`'s SDK does not export:
// one of the two was written without the other. A model told its capability set was the problem
// would go looking for a tool to enable, which is a turn spent on the wrong thing.
const notExported = (tool, written) =>
  new ToolError(
    tool,
    NOT_EXPORTED,
    `\`${written}\` did not reach gg's SDK: this SDK declares it and the SDK the guest carries ` +
      "does not export it, which is a mismatch between the two rather than anything this program did",
  );

// `namespace` is gg's own name for the family holding the function; `written` is the
// fully-qualified name a PureScript program writes — `Gg.Files.readTextFile` — and its last segment
// is the family's own name for the same function. One string rather than two because the two halves
// are the same word: what differs is the qualifier.
export const callImpl = (tool) => (namespace) => (written) => (args) => () => {
  const family = gg[namespace];
  const name = written.slice(written.lastIndexOf(".") + 1);
  const fn = family === undefined ? undefined : family[name];
  if (typeof fn !== "function") throw notExported(tool, written);
  return fn.apply(family, args);
};

// The code modules this turn was given, by the key each is bound at.
//
// A program cannot import one: `Gg.Core.lib` names a module and an export as strings, because a code
// module is compiled separately and there is no import for `purs` to check the two against. So the
// entry module gg generates imports each of them by its `lib:<key>` specifier and hands the set over
// here before it calls the program's `main`.
let libraries = {};

export const registerLib = (modules) => () => {
  libraries = modules;
};

export const libImpl = (key) => (name) => {
  const module_ = libraries[key];
  if (module_ === undefined || module_ === null) return null;
  const value = module_[name];
  return value === undefined ? null : value;
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

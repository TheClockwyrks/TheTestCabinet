/**
 * The one thing this arm's SOURCES cannot say: which modules the surface is divided into, and in
 * what order a reader meets them.
 *
 * Everything else that used to live here is gone. A function's gg operation id is written in the
 * `# Operation` section of the doc comment on the declaration it belongs to, which is the same place
 * that declaration's `# Arguments` list already lived; a side table naming every function twice was
 * precisely the second copy that drifts, and it does not exist any more.
 *
 * What is left is a table of thirteen module identities, and it is here rather than in `src/` for two
 * reasons. The ORDER is model-facing — it is the sequence a documentation index and the run's agent
 * surface present the modules in — and the PATH is the string gg matches a fully-qualified name's
 * prefix against, so a module that misspelled its own path would be reporting names nothing could
 * open. `signatures.mjs` asserts that `purs` documented exactly these modules, in both directions.
 *
 * The path is the PureScript module name itself, and on this arm those are one string rather than
 * two: a program writes `import Gg.Files as Gg.Files`, so `Gg.Files.readFile` is both the key a
 * documentation view is opened by and the expression a call site writes.
 */

/**
 * The modules the surface is divided into, IN THE ORDER IT IS PRESENTED IN.
 *
 * It runs from the modules almost every run has to the ones a particular shape of agent has, because
 * a model reads a list from the top. `Gg.Docs` is first because it is the one module no run can
 * withhold and the one a session begins in: the prompt names modules and no function, so finding a
 * name is the first thing a program does and every other module is reached through it. `Gg.Core` is
 * last and deliberately: it binds no operation at all, only the two failure types and the three
 * helpers that read a failure.
 */
export const MODULES = [
  { id: "docs", path: "Gg.Docs" },
  { id: "files", path: "Gg.Files" },
  { id: "shell", path: "Gg.Shell" },
  { id: "board", path: "Gg.Board" },
  { id: "tasks", path: "Gg.Tasks" },
  { id: "memories", path: "Gg.Memories" },
  { id: "views", path: "Gg.Views" },
  { id: "context", path: "Gg.Context" },
  { id: "delegation", path: "Gg.Delegation" },
  { id: "skills", path: "Gg.Skills" },
  { id: "programs", path: "Gg.Programs" },
  { id: "session", path: "Gg.Session" },
  { id: "core", path: "Gg.Core" },
];

/**
 * gg's id for the one module that binds no operation, and therefore the one module allowed to
 * export values that name no operation.
 *
 * Named rather than derived, so that a capability module which lost every operation id fails as the
 * defect it is instead of quietly reclassifying itself as this one.
 */
export const CORE = "core";

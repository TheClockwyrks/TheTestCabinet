//
// **gg's surface, in one place.**
//
// ```
// val entries = fs.listDir("src")
// val built = system.shell("cargo build")
// view.openText("build", built.output)
// harness.finish("looked at ${entries.size} sources")
// ```
//
// Everything a program may call hangs off one of a handful of **API objects** — `fs`, `system`,
// `project`, `tasks`, `memory`, `view`, `context`, `agents`, `skills`, `programs`, `harness`,
// `review` — and each of them is a top-level value of this SDK, so `fs.readFile` is an ordinary call
// on an ordinary object and there is **nothing to import**. Each object also carries a `list()`, which
// is the directory of what that object really bound for this run.
//
// The objects a run does **not** offer are still values: a program that calls one gets a [ToolError]
// carrying [ToolErrorCode.UNAVAILABLE] rather than a compile error, because what a run enables is
// decided per run and this SDK is compiled once. What every object's `list()` reports, and what the
// system prompt describes, is what this run actually has.
//
// Three things every program here obeys, and none of them is a preference:
//
// - **Every call is synchronous.** There is no dispatcher, no coroutine and no event loop; a call is
//   done when it returns, `suspend` buys nothing, and a thread you start is refused.
// - **A returned value is discarded.** The way a program shows itself something is `view.openText`;
//   `println` goes to the run's operator, not to you.
// - **A failure is thrown, not returned.** Catch the ones you expect with `catch (failure: ToolError)`
//   and branch on `failure.code`; let the rest escape, and gg reports which call failed.
//

/** read, write, and edit workspace files */
public val fs: Fs = Fs()

/** run shell commands in the workspace */
public val system: Shell = Shell()

/** the epic/issue board — decompose work into dispatchable issues */
public val project: Project = Project()

/** your task list */
public val tasks: Tasks = Tasks()

/** durable memories that survive context compaction */
public val memory: Memory = Memory()

/**
 * show yourself a file, a value, or a function's documentation — the only way material enters your
 * context
 */
public val view: View = View()

/** manage your own context window */
public val context: Context = Context()

/** delegate work to child agents */
public val agents: Agents = Agents()

/** read authored skills */
public val skills: Skills = Skills()

/** fetch a program you already ran, and hand a patched copy back to be run */
public val programs: Programs = Programs()

/** end your session */
public val harness: Harness = Harness()

/** return your verdict on the work you are reviewing */
public val review: Review = Review()

/** reach the code a skill or a memory carried, bound at `lib.<key>` */
public val lib: Lib = Lib()

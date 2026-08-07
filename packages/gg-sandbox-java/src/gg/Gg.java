package gg;

/**
 * <b>gg's surface, in one place.</b>
 *
 * <pre>{@code
 * List<DirEntry> entries = fs.listDir("src");
 * ShellOutput built = system.shell("cargo build");
 * view.openText("build", built.output());
 * harness.finish("looked at " + entries.size() + " sources");
 * }</pre>
 *
 * <p>Everything a program may call hangs off one of a handful of <b>API objects</b> —
 * {@code fs}, {@code system}, {@code project}, {@code tasks}, {@code memory}, {@code view},
 * {@code context}, {@code agents}, {@code skills}, {@code programs}, {@code harness},
 * {@code review} — and each of them is a field of this class, statically imported into every
 * program, so {@code fs.readFile} is an ordinary method call on an ordinary object. Each object
 * also carries a {@code list()}, which is the directory of what that object really bound for this
 * run.
 *
 * <p>The objects a run does <b>not</b> offer are still fields: a program that calls one gets a
 * {@link ToolError} carrying {@link ToolErrorCode#UNAVAILABLE} rather than a compile error,
 * because what a run enables is decided per run and this SDK is compiled once. What every object's
 * {@code list()} reports, and what the system prompt describes, is what this run actually has.
 *
 * <p>Three things every program here obeys, and none of them is a preference:
 *
 * <ul>
 *   <li><b>Every call is synchronous.</b> There is no executor and no event loop; a call is done
 *       when it returns, and a {@code Thread} you start is refused.
 *   <li><b>A returned value is discarded.</b> The way a program shows itself something is
 *       {@code view.openText}; {@code System.out.println} goes to the run's operator, not to you.
 *   <li><b>A failure is thrown, not returned.</b> Catch the ones you expect with
 *       {@code catch (ToolError failure)} and branch on {@code failure.code()}; let the rest
 *       escape, and gg reports which call failed.
 * </ul>
 */
public final class Gg {
    private Gg() {
    }

    /** read, write, and edit workspace files */
    public static final Fs fs = new Fs();

    /** run shell commands in the workspace */
    public static final Shell system = new Shell();

    /** the epic/issue board — decompose work into dispatchable issues */
    public static final Project project = new Project();

    /** your task list */
    public static final Tasks tasks = new Tasks();

    /** durable memories that survive context compaction */
    public static final Memory memory = new Memory();

    /**
     * show yourself a file, a value, or a function's documentation — the only way material enters
     * your context
     */
    public static final View view = new View();

    /** manage your own context window */
    public static final Context context = new Context();

    /** delegate work to child agents */
    public static final Agents agents = new Agents();

    /** read authored skills */
    public static final Skills skills = new Skills();

    /** fetch a program you already ran, and hand a patched copy back to be run */
    public static final Programs programs = new Programs();

    /** end your session */
    public static final Harness harness = new Harness();

    /** return your verdict on the work you are reviewing */
    public static final Review review = new Review();

    /** reach the code a skill or a memory carried, bound at {@code lib.<key>} */
    public static final Lib lib = new Lib();
}

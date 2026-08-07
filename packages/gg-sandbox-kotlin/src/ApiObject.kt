import org.teavm.jso.JSObject

/**
 * What every API object is: a namespace of typed calls, plus the one function that belongs to all of
 * them.
 *
 * A program never names this class — it writes `fs.readFile(…)` and `view.list()` — but every object
 * inherits [list] from here, which is what makes that function *one* declaration rather than twelve
 * identical ones.
 */
public abstract class ApiObject internal constructor(
    /** This object's own name, which a refusal names and which its `list` is bound with. */
    internal val owner: String,
) {
    /** The guest's object this one stands in front of, or `null` when the run withheld it. */
    internal abstract fun target(): JSObject?

    /**
     * List the functions available on this API object, each with a one-line summary.
     *
     * Only the functions this run actually bound are returned, so the directory never names a call
     * your program cannot make. Open a view of one function's full signature, argument descriptions
     * and types with `view.openDocsView`.
     *
     * @return every function this object really bound, each with one line saying what it does
     */
    public fun list(): List<FunctionSummary> =
        Read.functionSummaries(ggCall("list", target(), owner, "list", ggArgs()))
}

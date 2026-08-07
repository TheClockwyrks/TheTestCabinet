package gg;

import gg.internal.Read;
import gg.internal.Wire;
import java.util.List;
import org.teavm.jso.JSObject;

/**
 * What every API object is: a namespace of typed calls, plus the one function that belongs to all
 * of them.
 *
 * <p>A program never names this class — it writes {@code fs.readFile(…)} and
 * {@code view.list()} — but every object inherits {@link #list()} from here, which is what makes
 * that function <em>one</em> declaration rather than twelve identical ones.
 */
public abstract class ApiObject {
    /** This object's own name, which a refusal names and which its {@code list} is bound with. */
    private final String object;

    /**
     * Build one.
     *
     * @param object the object's own name, as a program writes it
     */
    ApiObject(String object) {
        this.object = object;
    }

    /** The guest's object this one stands in front of, or {@code null} when the run withheld it. */
    abstract JSObject target();

    /** This object's name, as a program writes it. */
    final String object() {
        return object;
    }

    /**
     * List the functions available on this API object, each with a one-line summary.
     *
     * <p>Only the functions this run actually bound are returned, so the directory never names a
     * call your program cannot make. Open a view of one function's full signature, argument
     * descriptions and types with {@code view.openDocsView}.
     *
     * @return every function this object really bound, each with one line saying what it does
     */
    public final List<FunctionSummary> list() {
        return Read.functionSummaries(
                Wire.call("list", target(), object, "list", Wire.args()));
    }
}

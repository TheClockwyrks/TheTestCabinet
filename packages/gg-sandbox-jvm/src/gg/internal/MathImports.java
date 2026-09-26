package gg.internal;

import org.teavm.model.AnnotationHolder;
import org.teavm.model.AnnotationValue;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.MethodHolder;

/**
 * <b>Make {@code java.lang.Math} reach gg</b> — the one class in either JVM arm's SDK that runs
 * inside the <i>compiler</i> rather than inside a program.
 *
 * <h2>The problem, measured</h2>
 *
 * <p>TeaVM's {@code WEBASSEMBLY_WASI} backend does not lower {@code Math.sin} to anything.
 * {@code org.teavm.classlib.java.lang.TMath} declares fourteen methods {@code native} and annotates
 * each {@code @Import(module = "teavmMath", …)}, so the backend emits them as <b>core imports of a
 * module named {@code teavmMath}</b> for a host to answer. Its own C runtime answers them with
 * {@code #define teavmMath_sqrt sqrt} — that is, with libc — and a WebAssembly component has no
 * libc.
 *
 * <p>What that costs without this class was measured on the production route: a program whose only
 * unusual line was {@code sqrt(16.0)} produced a core module gg could not encode at all —
 * <i>"failed to resolve import {@code teavmMath::sqrt}: module requires an import interface named
 * {@code teavmMath}"</i>. Every {@code Math.sqrt}, {@code Math.pow} and {@code Math.atan2} on both
 * arms, unreachable.
 *
 * <h2>The fix, and why it is a transformer</h2>
 *
 * <p>gg declares those fourteen functions as {@code test-cabinet:gg/math} and implements them in its
 * own host ({@code crates/gg/src/sandbox/membrane/math.rs}). All that is left is for the emitted
 * import to carry a module name {@code wit-component} can resolve — which is what this does, by
 * rewriting the annotation's {@code module} on the way past.
 *
 * <p>A transformer rather than a replacement classlib class, and that is the whole argument for it:
 * overriding {@code TMath} from the classpath — the trick the vendored
 * {@code org.teavm.runtime.ExceptionHandling} beside this uses — would mean gg carrying a whole
 * implementation of {@code java.lang.Math}, including the fifty methods that have nothing wrong with
 * them. This changes one string per method and leaves the classlib as its authors wrote it.
 *
 * <p><b>It is named to TeaVM by the shared driver</b> ({@code checkers/jvm.backend.java}), which is
 * also why it lives in an SDK jar rather than beside the driver: {@code setTransformers} takes class
 * names TeaVM loads out of the build's own classpath, and gg's SDK jar is on it.
 *
 * <p>Nothing here is model-facing, and nothing describes it to a model — see {@link Abi}'s class
 * note. It is never translated either: a program's call graph does not reach it, so TeaVM strips it.
 */
public final class MathImports implements ClassHolderTransformer {
    /** TeaVM's own annotation for a method a host implements. */
    private static final String IMPORT = "org.teavm.interop.Import";

    /** The module name the classlib asks for, which no host of a WebAssembly component can be. */
    private static final String TEAVM_MODULE = "teavmMath";

    /** gg's own interface id, which is one {@code wit-component} resolves against the world. */
    private static final String GG_MODULE = "test-cabinet:gg/math";

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        for (MethodHolder method : cls.getMethods()) {
            AnnotationHolder imported = method.getAnnotations().get(IMPORT);
            if (imported == null) {
                continue;
            }
            AnnotationValue module = imported.getValue("module");
            // Only that one module. `TMath` also declares imports for the C backend's own names
            // (`teavm_rand`, `fabs`), and those belong to a target gg does not build for.
            if (module == null || !TEAVM_MODULE.equals(module.getString())) {
                continue;
            }
            imported.getValues().put("module", new AnnotationValue(GG_MODULE));
        }
    }
}

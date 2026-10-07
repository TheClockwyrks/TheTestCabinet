package gg.internal;

import org.teavm.dependency.AbstractDependencyListener;
import org.teavm.dependency.DependencyAgent;
import org.teavm.model.MethodReference;
import org.teavm.model.ValueType;
import org.teavm.vm.spi.TeaVMPlugin;
import org.teavm.vm.spi.TeaVMHost;

/**
 * <b>Make every failure say what it was</b> — the second of the two classes in either JVM arm's SDK
 * that run inside the <i>compiler</i> rather than inside a program, beside {@link MathImports}.
 *
 * <h2>The problem, measured</h2>
 *
 * <p>TeaVM emits a class's <b>name string</b> into the binary only for the classes its dependency
 * analysis sees reaching {@code Class.getName()}. The uncaught path gg reads a failure off —
 * {@code org.teavm.runtime.ExceptionHandling.printHeader}, vendored beside this package — asks for
 * exactly that, and the only assignments to {@code thrownException} the analysis can see are the
 * three faults the runtime raises itself: TeaVM lowers {@code athrow} into a call to
 * {@code throwException} <i>after</i> the analysis has run, so a type a program threw itself is
 * invisible to it.
 *
 * <p>What that cost, measured on the production route before this class existed: a program whose
 * only line was {@code throw new java.util.EmptyStackException();} died with
 * {@code an exception carrying no message} and a correct stack — which is
 * <a href="https://docs.testcabinet.ai/gg/responses-as-code/invariants/">ruling D8a</a>'s
 * <i>where</i> with none of its <i>what</i>. A model declaring an exception class of its own, which
 * is what a Java author does, got the same.
 *
 * <h2>The fix, and why it is a plugin</h2>
 *
 * <p>The analysis is told the answer directly: for <b>every class it reaches that is a
 * {@code Throwable}</b>, this propagates that class into the class-value node of
 * {@code Class.getName()}'s receiver — which is the one input
 * {@code org.teavm.model.analysis.ClassMetadataRequirements} reads when it decides whose name to
 * emit. Nothing about failure handling changes: no catch is added, no control flow moves, and the
 * program still dies the way TeaVM kills it. What changes is whether the string exists in the
 * binary at all.
 *
 * <p>A plugin rather than a list gg carries, and that is the whole argument for it. A list is a
 * judgement about which classes a program fails with, it cannot include the exception classes a
 * <i>model</i> declares — which is where a Java program's own failures live — and a class that
 * fell off it failed silently, with a blank header and no test able to see it. This is derived from
 * the program actually being compiled, so the model's own {@code class OutOfCoffee extends
 * RuntimeException} is named in its own failure exactly as {@code java.lang.IllegalStateException}
 * is.
 *
 * <p><b>It is named to TeaVM by a service descriptor</b> — {@code META-INF/services/}{@code
 * org.teavm.vm.spi.TeaVMPlugin}, written into each arm's SDK jar by that arm's {@code build.sh} —
 * because {@code TeaVMPluginLoader} reads plugins off the build's own class loader and gg's SDK jar
 * is on it. That is the same reason {@link MathImports} lives in the jar rather than beside the
 * driver.
 *
 * <p>Nothing here is model-facing, and nothing describes it to a model — see {@link Abi}'s class
 * note. It is never translated either: a program's call graph does not reach it, so TeaVM strips it.
 */
public final class ThrowableNames implements TeaVMPlugin {
    /** The method whose receiver decides whose name is emitted. */
    private static final MethodReference GET_NAME =
            new MethodReference("java.lang.Class", "getName", ValueType.object("java.lang.String"));

    /** The root of everything a program can die of. */
    private static final String THROWABLE = "java.lang.Throwable";

    @Override
    public void install(TeaVMHost host) {
        host.add(new Listener());
    }

    /** Propagates each reached {@code Throwable} into {@code Class.getName()}'s receiver. */
    private static final class Listener extends AbstractDependencyListener {
        @Override
        public void classReached(DependencyAgent agent, String className) {
            if (!agent.getClassHierarchy().isSuperType(THROWABLE, className, false)) {
                return;
            }
            // `linkMethod` rather than `use()`: the method is already reachable on any program that
            // can fail at all, and forcing it on one that cannot would be gg deciding a program
            // needs reflection it never asked for.
            agent.linkMethod(GET_NAME)
                    .getVariable(0)
                    .getClassValueNode()
                    .propagate(agent.getType(ValueType.object(className)));
        }
    }
}

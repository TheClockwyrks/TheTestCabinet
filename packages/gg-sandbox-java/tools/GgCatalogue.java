package tools;

/**
 * <b>The one thing this arm's sources cannot say: which modules the surface is divided into, and in
 * what order a reader meets them.</b>
 *
 * <p>Everything else that used to live here is gone. A function's gg operation id is written on the
 * declaration it belongs to, as a {@code @ggop} block tag in that declaration's own doc comment, and
 * a type's module is the module class that encloses it. A side table naming every function twice was
 * precisely the second copy that drifts, and it does not exist any more.
 *
 * <p>What is left is a table of twelve module identities, and it is here rather than on the classes
 * for two reasons: the <b>order</b> is model-facing — it is the sequence a documentation index and
 * the run's agent surface present the modules in — and the <b>path</b> is the string gg matches a
 * fully-qualified name's prefix against, so a class that misspelled its own package would be
 * reporting a name nothing could open. Each class's own {@code @ggmodule} says which of these rows it
 * is, and {@link GgSignatures} asserts the two sets are equal in both directions.
 */
final class GgCatalogue {
    private GgCatalogue() {
    }

    /**
     * One module's identity: gg's cross-arm id for it, and how Java spells it.
     *
     * @param id gg's language-independent module id, and the namespace its operations are written
     *     under
     * @param type the fully-qualified module class, or the empty string for the one module that has
     *     none
     * @param path what a program writes in front of everything the module holds
     */
    record Module(String id, String type, String path) {
    }

    /**
     * The modules the surface is divided into, <b>in the order it is presented in</b>.
     *
     * <p>It runs from the modules almost every run has to the ones a particular shape of agent has,
     * because a model reads a list from the top. {@code core} is last and deliberately: it declares
     * no function at all, only the types and the exception every other module's signatures name.
     *
     * <p>The path is the module <b>class</b> rather than its package, and that is the one place this
     * arm differs from every other. Java has no free functions, so an operation each other arm
     * spells as one is a {@code static} method here — and the thing a program writes in front of it
     * is the class. A path of {@code gg.files} would name a package no call site can mention.
     */
    static final Module[] MODULES = {
        new Module("files", "gg.files.Files", "gg.files.Files"),
        new Module("shell", "gg.shell.Shell", "gg.shell.Shell"),
        new Module("board", "gg.board.Board", "gg.board.Board"),
        new Module("tasks", "gg.tasks.Tasks", "gg.tasks.Tasks"),
        new Module("memories", "gg.memories.Memories", "gg.memories.Memories"),
        new Module("views", "gg.views.Views", "gg.views.Views"),
        new Module("context", "gg.context.Context", "gg.context.Context"),
        new Module("delegation", "gg.delegation.Delegation", "gg.delegation.Delegation"),
        new Module("skills", "gg.skills.Skills", "gg.skills.Skills"),
        new Module("programs", "gg.programs.Programs", "gg.programs.Programs"),
        new Module("session", "gg.session.Session", "gg.session.Session"),
        // The one module with no class of its own: the types and the exception that live directly in
        // package `gg`, because every other module's signatures name them. Its empty class name is
        // what says so, and is what keeps it out of the function walk — its documentation is written
        // on the package, in `gg/package-info.java`, which is where Java documents a package.
        new Module("core", "", "gg"),
    };

    /** The package the {@code core} module is, and the root every other module's package sits in. */
    static final String CORE_PACKAGE = "gg";

    /** The package holding the bridge, which is not model-facing and is walked by nothing here. */
    static final String INTERNAL_PACKAGE = "gg.internal";
}

package tools

/**
 * The one thing this arm's sources cannot say: which modules the surface is divided into, and in what
 * order a reader meets them.
 *
 * Everything else that used to live here is gone. A function's gg operation id is now written on the
 * declaration it belongs to, as an `@ggop` tag in that declaration's own KDoc, and a module's gg id
 * as an `@ggmodule` tag in the file-level KDoc above its `package` line. A side table naming every
 * function twice was precisely the second copy that drifts, and it does not exist any more.
 *
 * What is left is a table of thirteen module identities, and it is here rather than in `src/` for two
 * reasons: the **order** is model-facing — it is the sequence a documentation index and the run's
 * agent surface present the modules in — and the **path** is the string gg matches a fully-qualified
 * name's prefix against, so a module that misspelled its own path would be reporting names nothing
 * could open. Each module's own `@ggmodule` tag says which of these rows it is, and [GgSignatures]
 * asserts the two sets are equal in both directions.
 */
internal object GgCatalogue {
    /** One module's identity: gg's cross-arm id for it, and the Kotlin package that carries it. */
    data class Module(
        /** gg's language-independent module id, and the namespace its operations are written under. */
        val id: String,
        /** The Kotlin package, which is the prefix every name in this module is qualified by. */
        val path: String,
    )

    /**
     * The modules the surface is divided into, **in the order it is presented in**.
     *
     * It runs from the modules almost every run has to the ones a particular shape of agent has,
     * because a model reads a list from the top. `core` is last and deliberately: it catalogues no
     * capability at all, only the failure type, the failure codes and the small values every other
     * module's signatures name.
     */
    val MODULES: List<Module> =
        listOf(
            Module("files", "gg.files"),
            Module("shell", "gg.shell"),
            Module("board", "gg.board"),
            Module("tasks", "gg.tasks"),
            Module("memories", "gg.memories"),
            Module("docs", "gg.docs"),
            Module("views", "gg.views"),
            Module("context", "gg.context"),
            Module("delegation", "gg.delegation"),
            Module("skills", "gg.skills"),
            Module("programs", "gg.programs"),
            Module("session", "gg.session"),
            Module("core", "gg.core"),
        )

    /**
     * The package holding the bridge, which is reflected out of nothing.
     *
     * Every declaration in it is `internal`, so a model cannot name one, and a catalogue that picked
     * it up would put the crossing itself in front of a model instead of the surface.
     */
    const val BRIDGE: String = "gg.internal"

    /**
     * The root package, which holds exactly one public declaration and is reflected out of nothing.
     *
     * `gg.log` is this arm's `console.log`: a line for whoever is watching the run, which no
     * capability offers and no gg tool answers. Every other arm keeps its own out of the catalogue
     * too, and the reason is the same — the catalogue describes the **capability** modules, and this
     * belongs to none of them. It is named here rather than merely omitted because the index refuses
     * a package holding model-facing declarations that [MODULES] does not name, which is what stops a
     * whole module from going undescribed by accident.
     */
    const val UNCATALOGUED: String = "gg"
}

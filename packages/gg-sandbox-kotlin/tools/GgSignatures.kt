@file:OptIn(
    org.jetbrains.kotlin.config.CompilerConfiguration.Internals::class,
    org.jetbrains.kotlin.K1Deprecation::class,
)

package tools

import java.io.File
import org.jetbrains.kotlin.cli.common.messages.MessageCollector
import org.jetbrains.kotlin.cli.jvm.compiler.EnvironmentConfigFiles
import org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment
import org.jetbrains.kotlin.com.intellij.openapi.util.Disposer
import org.jetbrains.kotlin.com.intellij.psi.PsiFileFactory
import org.jetbrains.kotlin.com.intellij.psi.util.PsiTreeUtil
import org.jetbrains.kotlin.config.CommonConfigurationKeys
import org.jetbrains.kotlin.config.CompilerConfiguration
import org.jetbrains.kotlin.idea.KotlinFileType
import org.jetbrains.kotlin.kdoc.psi.api.KDoc
import org.jetbrains.kotlin.kdoc.psi.impl.KDocSection
import org.jetbrains.kotlin.kdoc.psi.impl.KDocTag
import org.jetbrains.kotlin.lexer.KtTokens
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtClassOrObject
import org.jetbrains.kotlin.psi.KtDeclaration
import org.jetbrains.kotlin.psi.KtEnumEntry
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtObjectDeclaration
import org.jetbrains.kotlin.psi.KtProperty
import org.jetbrains.kotlin.psi.psiUtil.isPublic

/**
 * **The Kotlin arm's signature catalogue, reflected out of the SDK's own KDoc.**
 *
 * ## Which documentation tool this is, and why it is not Dokka
 *
 * Kotlin's documentation tool is **Dokka**, and Dokka has no JSON output: its formats are HTML, GFM,
 * Jekyll and Javadoc, and emitting anything else means writing a Dokka *plugin* — a second Kotlin
 * artifact, compiled against `dokka-core`, run through `dokka-cli` with a plugins classpath, and
 * pinned separately from the compiler that actually compiles a model's program. Dokka reads KDoc by
 * asking the **compiler's own front end** for it; so does this. The difference is a dependency, not a
 * reading.
 *
 * So this reflector drives the front end directly: `KotlinCoreEnvironment` builds the compiler's own
 * project, `PsiFileFactory` parses each SDK file into the same `KtFile` the compiler compiles, and
 * `KDoc` is the compiler's own KDoc parser rather than a regular expression over comments. That is
 * exactly what PureScript's arm does — its documentation tool *is* its compiler — and it has the
 * property this seam cares about most: **the release that describes the surface is the release that
 * compiles a program against it**, because both come out of `kotlin-version.sh`'s one pinned
 * `kotlin-compiler-embeddable`.
 *
 * ## How a type reference is resolved without an analysis
 *
 * It is a **parse** rather than a semantic analysis, and the second schema asks for something a parse
 * does not hand over for free: a type reference recorded as the declaration it *names* rather than as
 * the identifier the author happened to write. PSI's reference API cannot answer that here —
 * `KotlinReferenceProvidersService` is unregistered in a bare `KotlinCoreEnvironment`, so
 * `PsiElement.references` is empty and `mainReference` throws — and moving the whole reflector onto
 * the analysis API to recover it would replace a parse of twenty files with a resolve of the standard
 * library.
 *
 * So the resolution is done the way the language's own rules describe it, against a table of every
 * type the SDK declares, keyed by fully-qualified name. [Names] applies Kotlin's four-step lookup — a
 * name already written in full, then explicit imports and their aliases, then the file's own package,
 * then star imports — which is all the SDK ever uses. It is a **closed** world: nothing outside these
 * twenty files is resolved, and nothing outside them needs to be, because the only names this
 * catalogue records are the ones it also declares.
 *
 * A resolved reference is then written back into the signature **fully qualified**, and that is not
 * decoration. A model's program has no `import` line above it and is compiled in the root package, so
 * `gg.files.FileRead` is the only spelling of that type that resolves in the place the model is
 * writing — a bare `FileRead` copied out of a signature would not compile.
 *
 * ## What it refuses to emit
 *
 * A blank, a paragraph where a brief belongs, and a declaration nobody can reach. Every function,
 * argument, type and member must carry documentation; the first line of that documentation is the
 * brief and must be one line and short; every public top-level function in a catalogued package must
 * name the gg operation it binds; and every module the table names must declare itself. The
 * [register gate](crates/gg/src/sandbox/language/register.rs) and the
 * [name rule](crates/gg/src/sandbox/signatures.fqn.rs) make the same checks over the emitted JSON,
 * for every language; this makes them where the author is standing, with a file and a name.
 */
private const val GENERATED_FROM: String =
    "packages/gg-sandbox-kotlin/src, read through the pinned Kotlin compiler's own front end " +
        "(tools/GgSignatures.kt)"

/** The schema this catalogue is written in: the normalized doc model. */
private const val SCHEMA: Int = 2

/** The longest a brief may be, which is the cap the register gate holds every arm to. */
private const val BRIEF_CAP: Int = 120

/** The KDoc tag naming the gg operation a declaration binds. */
private const val OPERATION_TAG: String = "ggop"

/** The KDoc tag naming the operation a declaration is a *second* way to reach. */
private const val ALIAS_TAG: String = "ggalias"

/** The file-level KDoc tag naming which of gg's modules a package is. */
private const val MODULE_TAG: String = "ggmodule"

/**
 * KDoc's own tag for what a call hands back.
 *
 * It carries no subject — `@return` is followed by prose, not by a name the way `@param` and
 * `@throws` are — so it arrives beside gg's identity tags rather than beside the named ones, and it
 * has to be picked out there by name or it is read as a tag nobody asked for and dropped.
 */
private const val RETURN_TAG: String = "return"

/**
 * The types every failure arm names, closed over on every entry.
 *
 * Every function in this SDK raises `ToolError` and every catch site reads its `ToolErrorCode`, and
 * Kotlin says neither in a signature — this language has no checked exceptions, so there is no
 * `throws` clause for the reflector to read them out of. Naming them here is what keeps the two types
 * reachable from every call, which is what decides whether a documentation view of either can be
 * opened at all.
 */
private val ALWAYS_REFERENCED: List<String> = listOf("gg.core.ToolError", "gg.core.ToolErrorCode")

fun main(args: Array<String>) {
    val options = args.toList().chunked(2).associate { it[0] to it[1] }
    val source = File(options.getValue("--src"))
    val libraries = File(options.getValue("--libraries"))
    val out = File(options.getValue("--out"))
    val index = Index.of(source)
    val json = Catalogue(index, Libraries.read(libraries)).emit()
    out.writeText(json)
    println("wrote ${out.path} (${json.length} bytes)")
}

/** Stop, saying what the author has to fix. */
private fun fail(why: String): Nothing {
    System.err.println("error: $why")
    kotlin.system.exitProcess(1)
}

// -------------------------------------------------------------------------------------------
// Reading the SDK
// -------------------------------------------------------------------------------------------

/** One type the SDK declares, and where it lives. */
private class Declared(
    /** The module the declaring package is. */
    val module: GgCatalogue.Module,
    /** The name a program writes after the module path, nesting included: `Patch.Replace`. */
    val name: String,
    /** The fully-qualified name, which is what a documentation view of it is opened by. */
    val fqn: String,
    /** The declaration itself. */
    val declaration: KtClassOrObject,
    /** The file it was declared in, whose imports its own member types resolve against. */
    val file: KtFile,
)

/** Every model-facing declaration the SDK makes, indexed the way a name is looked up. */
private class Index(
    /** Each catalogued module's files, in the order they were read. */
    val files: Map<String, List<KtFile>>,
    /**
     * Every **top-level** declared type, by fully-qualified name.
     *
     * A type written *inside* another — the arms Kotlin lets a sealed type declare in its own body —
     * is deliberately not one of these, and that is the name rule's decision rather than a
     * convenience. A fully-qualified name has exactly three shapes, and `module ∘ Type ∘ Type` is
     * none of them: `gg.core.Patch.Clear` would read as a member of `Patch` and open nothing. So a
     * nested arm is documented as a member of the type that declares it, with its own properties
     * listed under it, and a program still writes `gg.core.Patch.Clear` because that is what
     * qualifying the outer name produces.
     */
    val types: Map<String, Declared>,
) {
    companion object {
        /**
         * Parse every model-facing file under `root`, and hold the module table to the sources.
         *
         * The bridge package is left out by name: every declaration in it is `internal`, a model
         * cannot reach one, and reflecting it would put the crossing itself in front of a model.
         */
        fun of(root: File): Index {
            // The environment is deliberately NOT disposed. PSI is lazy: a `KtFile`'s declarations
            // are built on demand out of the project this environment owns, so disposing it here
            // makes every later read fail inside IntelliJ's own extension lookup. The process is a
            // build step that exits, which is what frees it.
            val disposable = Disposer.newDisposable()
            for (name in listOf("config", "system", "plugins")) {
                System.setProperty(
                    "idea.$name.path",
                    File(System.getProperty("java.io.tmpdir"), "gg-kdoc/$name").absolutePath,
                )
            }
            val configuration = CompilerConfiguration()
            configuration.put(CommonConfigurationKeys.MESSAGE_COLLECTOR_KEY, MessageCollector.NONE)
            configuration.put(CommonConfigurationKeys.MODULE_NAME, "gg-signatures")
            val environment =
                KotlinCoreEnvironment.createForProduction(
                    disposable,
                    configuration,
                    EnvironmentConfigFiles.JVM_CONFIG_FILES,
                )
            val factory = PsiFileFactory.getInstance(environment.project)

            val byPackage = LinkedHashMap<String, MutableList<KtFile>>()
            val sources =
                root.walkTopDown().filter { it.isFile && it.extension == "kt" }.sortedBy { it.path }
            for (file in sources) {
                val parsed =
                    factory.createFileFromText(file.name, KotlinFileType.INSTANCE, file.readText())
                        as KtFile
                val packaged = parsed.packageFqName.asString()
                if (packaged.isEmpty()) {
                    fail("`${file.name}` declares no package, and every name here is qualified by one")
                }
                if (packaged == GgCatalogue.BRIDGE) {
                    continue
                }
                byPackage.getOrPut(packaged) { ArrayList() }.add(parsed)
            }

            val known = GgCatalogue.MODULES.associateBy { it.path }
            for (packaged in byPackage.keys) {
                if (!known.containsKey(packaged)) {
                    fail(
                        "`$packaged` holds model-facing declarations and `GgCatalogue.MODULES` does " +
                            "not name it, so nothing would tell a model the module exists",
                    )
                }
            }
            for (module in GgCatalogue.MODULES) {
                if (!byPackage.containsKey(module.path)) {
                    fail("`GgCatalogue.MODULES` names `${module.path}`, and no file declares it")
                }
                val claiming =
                    byPackage.getValue(module.path).filter { moduleTag(it) != null }
                if (claiming.isEmpty()) {
                    fail(
                        "no file in `${module.path}` carries a `@$MODULE_TAG` in its file-level KDoc, " +
                            "so the module has no description of its own",
                    )
                }
                if (claiming.size > 1) {
                    fail("${claiming.size} files in `${module.path}` claim to be the module's own")
                }
                val claimed = moduleTag(claiming.single())
                if (claimed != module.id) {
                    fail(
                        "`${module.path}` declares itself gg's `$claimed` module, which " +
                            "`GgCatalogue.MODULES` calls `${module.id}` — the table and the " +
                            "declarations must agree in both directions",
                    )
                }
            }

            val types = LinkedHashMap<String, Declared>()
            for (module in GgCatalogue.MODULES) {
                for (file in byPackage.getValue(module.path)) {
                    for (declaration in file.declarations.filterIsInstance<KtClassOrObject>()) {
                        if (!declaration.isPublic) {
                            continue
                        }
                        val name = declaration.name.orEmpty()
                        val fqn = "${module.path}.$name"
                        if (types.containsKey(fqn)) {
                            fail("two declarations claim the name `$fqn`")
                        }
                        types[fqn] = Declared(module, name, fqn, declaration, file)
                    }
                }
            }
            return Index(
                GgCatalogue.MODULES.associate { it.path to byPackage.getValue(it.path) },
                types,
            )
        }

        /** The gg module id a file's own file-level KDoc claims, or `null`. */
        private fun moduleTag(file: KtFile): String? =
            fileDocumentation(file)?.tags?.get(MODULE_TAG)
    }
}

// -------------------------------------------------------------------------------------------
// Name resolution
// -------------------------------------------------------------------------------------------

/**
 * Kotlin's own name lookup, over the types this SDK declares and nothing else.
 *
 * The four steps are the language's, in the language's order: a name already written in full, then an
 * explicit `import` (its alias included), then a type in the file's own package, then a star import.
 * Anything that resolves to none of those is not this SDK's and is left exactly as the author wrote
 * it — `String`, `Int`, `List`, `IntRange` all pass straight through.
 */
private class Names(file: KtFile, private val types: Map<String, Declared>) {
    /** The file's own package, which is step three. */
    private val packaged: String = file.packageFqName.asString()

    /** Each explicit import's fully-qualified name, by the simple name it binds. */
    private val imported: Map<String, String>

    /** Each star import's package. */
    private val starred: List<String>

    init {
        val explicit = LinkedHashMap<String, String>()
        val stars = ArrayList<String>()
        for (directive in file.importDirectives) {
            val imported = directive.importedFqName?.asString() ?: continue
            if (directive.isAllUnder) {
                stars.add(imported)
                continue
            }
            explicit[directive.aliasName ?: imported.substringAfterLast('.')] = imported
        }
        this.imported = explicit
        this.starred = stars
    }

    /**
     * The declared type a written name refers to, or `null` when it refers to none.
     *
     * A dotted name is tried whole first and then by successively shorter prefixes, so
     * `Patch.Replace` resolves as a nested type while `ToolError.code` resolves its type and keeps
     * the member after it — which is what an intra-doc link to a property needs.
     */
    fun resolve(written: String): Resolution? {
        val segments = written.split('.')
        for (taken in segments.size downTo 1) {
            val head = segments.take(taken).joinToString(".")
            val rest = segments.drop(taken)
            val fqn = qualify(head) ?: continue
            return Resolution(types.getValue(fqn), rest.joinToString(".") { it })
        }
        return null
    }

    /** The fully-qualified name a written name resolves to, by Kotlin's four steps. */
    private fun qualify(written: String): String? {
        if (types.containsKey(written)) {
            return written
        }
        val head = written.substringBefore('.')
        val rest = written.removePrefix(head)
        val bases = ArrayList<String>()
        imported[head]?.let { bases.add(it) }
        bases.add("$packaged.$head")
        for (star in starred) {
            bases.add("$star.$head")
        }
        return bases.map { it + rest }.firstOrNull { types.containsKey(it) }
    }
}

/** One resolved name: the declaration it names, and whatever was written after it. */
private class Resolution(val declared: Declared, val member: String) {
    /** The name written in full, which is the only spelling that resolves in a model's program. */
    fun qualified(): String =
        if (member.isEmpty()) declared.fqn else "${declared.fqn}.$member"
}

// -------------------------------------------------------------------------------------------
// KDoc
// -------------------------------------------------------------------------------------------

/** One declaration's documentation, split the way the catalogue carries it. */
private class Doc(
    /** The prose above the tags, as paragraphs separated by a blank line. */
    val body: String,
    /** Each `@param`'s or `@property`'s prose, by subject. */
    val named: Map<String, String>,
    /** Each `@throws`'s prose, by the type it names. */
    val thrown: Map<String, String>,
    /** What the `@return` says, or nothing where the author wrote none. */
    val returns: String?,
    /** Each tag that carries no subject, by name — the gg identity tags. */
    val tags: Map<String, String>,
)

/** Read a declaration's KDoc, or nothing at all when it carries none. */
private fun documentation(declaration: KtDeclaration): Doc? = read(declaration.docComment)

/**
 * The **file-level** KDoc: the one written above a `package` line, which is where a module's own
 * description lives.
 *
 * Kotlin has no package declaration to hang a doc comment off — Dokka reads a separate `package.md`
 * for this — so the comment above the package line is the nearest thing the language has, and PSI
 * hands it back as a `KDoc` whose parent is the file and whose owner is nothing. Measured, rather
 * than assumed: a declaration's own KDoc always answers an owner, so the two cannot be confused.
 */
private fun fileDocumentation(file: KtFile): Doc? {
    val doc =
        PsiTreeUtil.findChildrenOfType(file, KDoc::class.java).firstOrNull {
            it.parent === file && it.getOwner() == null
        }
    return read(doc)
}

/**
 * One KDoc, split into its body, its subject tags and its bare ones.
 *
 * ## Where a gg tag has to be written, and why the reflector says so
 *
 * A gg identity tag is written **first**, before `@param`, and that is a measured constraint rather
 * than a style. KDoc's parser starts a new tag at an `@` it does not know — an `@ggop` after a
 * `@param` or a `@return` arrives as its own `KDocTag` — but it does **not** after a `@throws`: that
 * tag's content swallows every following line to the end of the comment, blank lines included, and
 * the operation id disappears into the failure prose.
 *
 * A swallowed tag would otherwise be reported as *this declaration names no gg operation*, on a
 * declaration that plainly does, so the swallowed case is detected and named for what it is.
 *
 * ## Subjectless does not mean unwanted
 *
 * KDoc sorts its tags by whether they name a subject, and gg's identity tags and `@return` land on
 * the same side of that line: neither is followed by a name. That is a fact about KDoc's grammar and
 * not about what a model needs, so `@return` is picked out here by name — what a call hands back is
 * one of the most useful sentences a model reads about it, and the author was writing it for the
 * model rather than for the reflector.
 */
private fun read(doc: KDoc?): Doc? {
    if (doc == null) {
        return null
    }
    val named = LinkedHashMap<String, String>()
    val thrown = LinkedHashMap<String, String>()
    val tags = LinkedHashMap<String, String>()
    var returns: String? = null
    for (tag in PsiTreeUtil.findChildrenOfType(doc, KDocTag::class.java)) {
        if (tag is KDocSection) {
            continue
        }
        for (line in tag.getContent().lines()) {
            val swallowed = line.trim().removePrefix("@").substringBefore(' ')
            if (swallowed in listOf(OPERATION_TAG, ALIAS_TAG, MODULE_TAG, RETURN_TAG) &&
                line.trim().startsWith("@")
            ) {
                fail(
                    "a `@$swallowed` is written after `@${tag.name}`, which swallows it — KDoc runs a " +
                        "`@throws` tag to the end of the comment, so gg's identity tags are written " +
                        "first, before `@param`, and `@$RETURN_TAG` is written before `@throws`",
                )
            }
        }
        val subject = tag.getSubjectName()
        when {
            subject == null ->
                when (tag.name) {
                    OPERATION_TAG, ALIAS_TAG, MODULE_TAG -> tags[tag.name!!] = tag.getContent().trim()
                    RETURN_TAG -> {
                        val said = paragraphs(tag.getContent())
                        if (said.isBlank()) {
                            fail("a `@$RETURN_TAG` is written that says nothing")
                        }
                        returns = said
                    }
                    else -> Unit
                }
            tag.name == "param" || tag.name == "property" -> named[subject] = paragraphs(tag.getContent())
            tag.name == "throws" || tag.name == "exception" -> thrown[subject] = paragraphs(tag.getContent())
            else -> Unit
        }
    }
    return Doc(paragraphs(doc.getDefaultSection().getContent()), named, thrown, returns, tags)
}

/**
 * KDoc's own text, as the paragraphs the catalogue carries.
 *
 * The SDK's comments are wrapped to a column, so a paragraph arrives as several lines and has to be
 * rejoined — but a fenced code block must not be, since its line breaks are the code's, and a list
 * item must not be either. Blank lines separate paragraphs, which is what `\n\n` means downstream,
 * and is what makes the **brief** the first paragraph and one line without the author having to keep
 * a sentence inside the source's line width.
 */
private fun paragraphs(content: String): String {
    val out = StringBuilder()
    val paragraph = StringBuilder()
    var fenced = false
    fun flush() {
        if (paragraph.isNotEmpty()) {
            if (out.isNotEmpty()) {
                out.append("\n\n")
            }
            out.append(paragraph.trimEnd())
            paragraph.setLength(0)
        }
    }
    for (raw in content.trim().lines()) {
        val line = raw.trim()
        if (line.startsWith("```")) {
            if (!fenced) {
                flush()
            }
            fenced = !fenced
            if (paragraph.isNotEmpty()) {
                paragraph.append('\n')
            }
            paragraph.append(line)
            if (!fenced) {
                flush()
            }
            continue
        }
        if (fenced) {
            paragraph.append('\n').append(raw.trimEnd())
            continue
        }
        if (line.isEmpty()) {
            flush()
            continue
        }
        if (line.startsWith("- ") || line.startsWith("* ") || line.startsWith("| ")) {
            if (paragraph.isNotEmpty()) {
                paragraph.append('\n')
            }
            paragraph.append(line)
            continue
        }
        if (paragraph.isNotEmpty() && !paragraph.endsWith("\n")) {
            paragraph.append(' ')
        }
        paragraph.append(line)
    }
    flush()
    return out.toString()
}

/**
 * KDoc's `[Name]` link, as the model-facing text it stands for.
 *
 * A link whose target this SDK declares becomes a code span holding the **fully-qualified** name,
 * because that is the spelling a program can write; anything else keeps the words the author put
 * between the brackets. A markdown link — `[text](url)` — is left alone, since its target is a real
 * one and its text is prose.
 */
private fun links(text: String, names: Names): String {
    val out = StringBuilder()
    var at = 0
    while (at < text.length) {
        val open = text.indexOf('[', at)
        if (open < 0) {
            out.append(text, at, text.length)
            break
        }
        val close = text.indexOf(']', open)
        val inner = if (close < 0) null else text.substring(open + 1, close)
        val linked = close + 1 < text.length && text[close + 1] == '('
        if (inner == null ||
            linked ||
            inner.isEmpty() ||
            !inner.all { it.isLetterOrDigit() || it == '.' || it == '_' } ||
            !inner.first().isLetter()
        ) {
            out.append(text, at, (if (close < 0) text.length else close + 1))
            at = if (close < 0) text.length else close + 1
            continue
        }
        val written = names.resolve(inner)?.qualified() ?: inner
        out.append(text, at, open).append('`').append(written).append('`')
        at = close + 1
    }
    return out.toString()
}

/**
 * One piece of settled prose as a brief and an optional detail: the first paragraph, and the rest.
 *
 * The split is on the blank line the author put there, never on a full stop, so an opening paragraph
 * that is really three sentences of narrative fails **here**, at the declaration, as the paragraph it
 * is — rather than several steps later in a gate that can only name the entry.
 */
private fun split(text: String, what: String): Pair<String, String?> {
    if (text.isBlank()) {
        fail("$what has no documentation on its declaration")
    }
    val brief = text.substringBefore("\n\n").trim()
    val detail = text.substringAfter("\n\n", "").trim().ifEmpty { null }
    if (brief.contains('\n')) {
        fail(
            "$what opens with a paragraph of more than one line — the first line is the brief and " +
                "the rest is the detail, so an opening paragraph that wraps is a brief a model " +
                "reads where it expected one line",
        )
    }
    if (brief.length > BRIEF_CAP) {
        fail("$what has a ${brief.length}-character brief, and a brief is capped at $BRIEF_CAP")
    }
    return brief to detail
}

// -------------------------------------------------------------------------------------------
// The libraries
// -------------------------------------------------------------------------------------------

/** One group of packages a program may import, as `libraries.txt` groups them. */
private class Libraries(val groups: List<Pair<String, List<String>>>) {
    companion object {
        /** Read `libraries.txt`, refusing a package that sits under no heading. */
        fun read(file: File): Libraries {
            val groups = ArrayList<Pair<String, ArrayList<String>>>()
            for (raw in file.readLines()) {
                val line = raw.trim()
                if (line.isEmpty()) {
                    continue
                }
                val heading = Regex("^# --- (.+) ---$").find(line)
                if (heading != null) {
                    groups.add(heading.groupValues[1] to ArrayList())
                    continue
                }
                if (line.startsWith("#")) {
                    continue
                }
                val group =
                    groups.lastOrNull()
                        ?: fail("`$line` in ${file.name} sits under no `# --- heading ---`")
                if (group.second.contains(line)) {
                    fail("`$line` is listed twice in ${file.name}")
                }
                group.second.add(line)
            }
            if (groups.any { it.second.isEmpty() }) {
                fail("a heading in ${file.name} has no packages under it")
            }
            return Libraries(groups.map { it.first to it.second.toList() })
        }
    }
}

// -------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------

/** One catalogued call, in the shape the second schema carries it. */
private class Entry(
    val operation: String,
    val aliasOf: String?,
    val module: String,
    val kind: String,
    val receiver: String?,
    val name: String,
    val fqn: String,
    val brief: String,
    val detail: String?,
    val signature: String,
    val parameters: List<Parameter>,
    val returns: List<String>,
    val types: List<String>,
)

/** One argument, as the catalogue's schema carries it. */
private class Parameter(
    val name: String,
    val type: String,
    val optional: Boolean,
    val kind: String,
    val default: String?,
    val doc: String,
) {
    fun write(json: Json) {
        with(json) {
            field("name", name)
            field("type", type)
            field("optional", optional)
            field("kind", kind)
            if (default == null) nullField("default") else field("default", default)
            field("doc", doc)
            key("fields")
            array {}
        }
    }
}

/** One member of a declared type: a property, or an arm of a sealed one. */
private class Member(
    val name: String,
    val type: String?,
    val kind: String,
    val brief: String,
    val detail: String?,
)

/** One line of a type's menu: a member function, reachable as its own documentation view. */
private class MemberFunction(
    val operation: String,
    val name: String,
    val fqn: String,
    val brief: String,
)

/** The whole catalogue, built out of the module table and the SDK the index read. */
private class Catalogue(val index: Index, val libraries: Libraries) {
    /** Every type any signature reached, transitively, keyed by fully-qualified name. */
    private val reached = LinkedHashSet<String>()

    /** The menu each declared type offers, filled in by the member walk. */
    private val members = LinkedHashMap<String, MutableList<MemberFunction>>()

    fun emit(): String {
        val functions = functions()
        val declared = reached.sorted().map { type(it) }

        val json = Json()
        json.obj {
            field("schema", SCHEMA)
            field("language", "kotlin")
            field("generatedFrom", GENERATED_FROM)
            key("libraries")
            array {
                for ((group, modules) in libraries.groups) {
                    obj {
                        field("group", group)
                        key("modules")
                        array { for (module in modules) value(module) }
                    }
                }
            }
            key("modules")
            array {
                for (module in GgCatalogue.MODULES) {
                    val file =
                        index.files.getValue(module.path).first {
                            fileDocumentation(it)?.tags?.containsKey(MODULE_TAG) == true
                        }
                    val doc = fileDocumentation(file)!!
                    val names = Names(file, index.types)
                    val (brief, detail) = split(links(doc.body, names), "the `${module.path}` module")
                    obj {
                        field("id", module.id)
                        field("path", module.path)
                        field("brief", brief)
                        if (detail == null) nullField("detail") else field("detail", detail)
                        // `null`, and truthfully. A Kotlin name written in full resolves with nothing
                        // above it, and a model's program is compiled in the root package — so
                        // `gg.files.readFile(…)` is a call it can write as it stands, and an import
                        // line here would be one gg told it to write and does not need.
                        nullField("import")
                    }
                }
            }
            key("functions")
            array {
                for (entry in functions) {
                    obj { write(entry) }
                }
            }
            key("types")
            array {
                for (type in declared) {
                    obj { write(type) }
                }
            }
        }
        return json.finish()
    }

    // ---------------------------------------------------------------------------------------
    // Functions
    // ---------------------------------------------------------------------------------------

    /**
     * Every catalogued call, module by module: the module's own functions, then the member functions
     * declared inside the types that module hands back.
     *
     * A member function is a real declaration with its own operation id, its own signature and its
     * own documentation, so it is read from the declaration rather than listed off the type it hangs
     * on — a renderer that listed a type's methods from the type would emit entries nobody had
     * written an id on.
     *
     * # Why a member function has to be a **member**, and an extension is refused
     *
     * `fun SubagentHandle.send(…)` reads like the same thing and is not, and the difference is fatal
     * rather than stylistic. A top-level extension is in scope only where it has been **imported**:
     * measured against this arm's own toolchain, `handle.send("more")` in a model's program is
     * `unresolved reference 'send'` without `import gg.delegation.send`, and there is no
     * fully-qualified spelling of an extension call to fall back on — `gg.delegation.send(handle)`
     * and `gg.delegation.SubagentHandle.send(handle)` are both refused too. A program is compiled in
     * the root package with no header of gg's own — gg's `kotlin.source.rs` injects none — and this
     * arm's prompt tells the model in as many words that gg's surface needs no `import`. So a
     * catalogued extension is a name the documentation advertises and no program can write, which is
     * the one thing a fully-qualified name may never be.
     *
     * A member declared in the type's own body has none of that: `handle.send("more")` resolves
     * because the receiver's type carries it, with nothing imported. That is what the other arms
     * that carry member functions ship, and the refusal below is what keeps this arm on it.
     */
    private fun functions(): List<Entry> {
        val out = ArrayList<Entry>()
        for (module in GgCatalogue.MODULES) {
            for (file in index.files.getValue(module.path)) {
                val names = Names(file, index.types)
                for (declared in file.declarations.filterIsInstance<KtNamedFunction>()) {
                    if (!declared.isPublic) {
                        continue
                    }
                    val name = declared.name.orEmpty()
                    val doc =
                        documentation(declared)
                            ?: fail("`${module.path}.$name` has no documentation on its declaration")
                    val operation = doc.tags[OPERATION_TAG]
                    val alias = doc.tags[ALIAS_TAG]
                    if (operation == null && alias == null) {
                        fail(
                            "`${module.path}.$name` is public and names no gg operation, so a model " +
                                "would never be told it exists — write `@$OPERATION_TAG " +
                                "<namespace>.<key>` in its KDoc",
                        )
                    }
                    if (operation != null && alias != null) {
                        fail("`${module.path}.$name` is both an operation and an alias of one")
                    }
                    if (declared.receiverTypeReference != null) {
                        fail(
                            "`${module.path}.$name` is a top-level extension function and names a gg " +
                                "operation, and a model could not call it: an extension is in scope " +
                                "only where it has been imported, and a program writes gg's surface " +
                                "with no `import` of its own. Declare it in the body of the type it " +
                                "hangs off instead",
                        )
                    }
                    out.add(entry(module, names, declared, null, operation ?: alias!!, alias))
                }
            }
        }
        // The separate walk: one entry per public function declared in the body of a catalogued type,
        // in the order the type declares them. Nothing here reads the module's own functions, and
        // nothing above reads a type's, so neither renderer can quietly grow the other's cases.
        for (module in GgCatalogue.MODULES) {
            for (declared in index.types.values) {
                if (declared.module.id != module.id) {
                    continue
                }
                val names = Names(declared.file, index.types)
                for (method in declared.declaration.declarations.filterIsInstance<KtNamedFunction>()) {
                    if (!method.isPublic) {
                        continue
                    }
                    val doc = documentation(method) ?: continue
                    val operation = doc.tags[OPERATION_TAG]
                    val alias = doc.tags[ALIAS_TAG]
                    if (operation == null && alias == null) {
                        continue
                    }
                    if (operation != null && alias != null) {
                        fail(
                            "`${declared.fqn}.${method.name}` is both an operation and an alias of one",
                        )
                    }
                    val entry =
                        entry(module, names, method, declared, operation ?: alias!!, alias)
                    out.add(entry)
                    members
                        .getOrPut(declared.fqn) { ArrayList() }
                        .add(MemberFunction(entry.operation, entry.name, entry.fqn, entry.brief))
                }
            }
        }
        return out
    }

    /** One public function, read out of its own declaration: a module's own, or a type's member. */
    private fun entry(
        module: GgCatalogue.Module,
        names: Names,
        declared: KtNamedFunction,
        owner: Declared?,
        operation: String,
        alias: String?,
    ): Entry {
        val name = declared.name.orEmpty()
        val receiver = owner?.name
        val fqn =
            if (receiver == null) "${module.path}.$name" else "${module.path}.$receiver.$name"
        val what = "`$fqn`"
        val doc = documentation(declared) ?: fail("$what has no documentation on its declaration")

        val parameters = ArrayList<Parameter>()
        val reachedHere = LinkedHashSet<String>()
        val rendered = ArrayList<String>()
        for (parameter in declared.valueParameters) {
            val argument = parameter.name ?: fail("an argument of $what has no name")
            val written =
                parameter.typeReference?.text ?: fail("$what's `$argument` states no type")
            val type = render(written, names, reachedHere)
            val default = parameter.defaultValue?.text
            val prose =
                doc.named[argument]?.takeIf { it.isNotBlank() }
                    ?: fail("$what documents no `@param $argument`")
            parameters.add(
                Parameter(
                    name = argument,
                    type = if (parameter.isVarArg) "vararg $type" else type,
                    optional = default != null || parameter.isVarArg,
                    kind = if (default != null) "keyword" else "positional",
                    default = default,
                    doc = links(prose, names),
                ),
            )
            val prefix = if (parameter.isVarArg) "vararg " else ""
            val suffix = default?.let { " = $it" } ?: ""
            rendered.add("$prefix$argument: $type$suffix")
        }
        for (documented in doc.named.keys) {
            if (declared.valueParameters.none { it.name == documented }) {
                fail("$what documents an argument `$documented` it does not take")
            }
        }

        // A block-bodied function with no stated type returns `Unit`, and the signature says so out
        // loud: that a call returns nothing is exactly what tells a model the rest of its program
        // still runs after it.
        val returned = LinkedHashSet<String>()
        val returns = declared.typeReference?.text?.let { render(it, names, returned) } ?: "Unit"
        reachedHere.addAll(returned)

        val (brief, body) = split(links(doc.body, names), what)
        val detail = StringBuilder(body.orEmpty())
        // What the call hands back, then how it fails — the order every other arm's catalogue writes
        // them in, and the order an author reads a declaration in.
        doc.returns?.let { said ->
            if (detail.isNotEmpty()) {
                detail.append("\n\n")
            }
            detail.append("Returns: ").append(links(said, names))
        }
        for ((thrown, prose) in doc.thrown) {
            val resolved = names.resolve(thrown)
            if (detail.isNotEmpty()) {
                detail.append("\n\n")
            }
            detail
                .append("Raises `")
                .append(resolved?.qualified() ?: thrown)
                .append("`: ")
                .append(links(prose, names))
            resolved?.let { reachedHere.add(it.declared.fqn) }
        }

        reachedHere.addAll(ALWAYS_REFERENCED)
        return Entry(
            operation = operation,
            aliasOf = alias,
            module = module.id,
            kind = if (receiver == null) "function" else "method",
            receiver = receiver,
            name = name,
            fqn = fqn,
            brief = brief,
            detail = detail.toString().ifEmpty { null },
            signature = "$name(${rendered.joinToString(", ")}): $returns",
            parameters = parameters,
            // The direct return position and nothing beyond it, because what it feeds is a one-level
            // rule about which types a documentation view opens beside a function. The transitive
            // half is `types`, and the closure below is what records both.
            returns = returned.toList(),
            types = closure(reachedHere).toList(),
        )
    }

    private fun Json.write(entry: Entry) {
        field("operation", entry.operation)
        if (entry.aliasOf == null) nullField("aliasOf") else field("aliasOf", entry.aliasOf)
        field("module", entry.module)
        field("kind", entry.kind)
        if (entry.receiver == null) nullField("receiver") else field("receiver", entry.receiver)
        field("name", entry.name)
        field("fqn", entry.fqn)
        // `null`, because on this arm the fully-qualified name IS what a program writes: a Kotlin
        // name written in full resolves from the root package a model's program is compiled in.
        nullField("call")
        field("brief", entry.brief)
        if (entry.detail == null) nullField("detail") else field("detail", entry.detail)
        key("signatures")
        array {
            obj {
                field("signature", entry.signature)
                key("parameters")
                array { for (parameter in entry.parameters) obj { parameter.write(this) } }
            }
        }
        key("returns")
        array { for (fqn in entry.returns) obj { reference(fqn) } }
        key("types")
        array { for (fqn in entry.types) obj { reference(fqn) } }
    }

    /**
     * One resolved type reference: the spelling a signature writes, and the name it resolves to.
     *
     * They are the same string on this arm, and that is a fact rather than a shortcut: a signature
     * here writes every declared type in full, because a bare name copied out of one would not
     * resolve in the root package a model's program is compiled in.
     */
    private fun Json.reference(fqn: String) {
        field("spelled", fqn)
        field("fqn", fqn)
    }

    // ---------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------

    /**
     * Every declared type a written type mentions, rewritten fully qualified, recording what it
     * reached.
     */
    private fun render(written: String, names: Names, into: MutableSet<String>): String {
        val out = StringBuilder()
        var at = 0
        while (at < written.length) {
            val character = written[at]
            if (!character.isLetter() && character != '_') {
                out.append(character)
                at += 1
                continue
            }
            var end = at
            while (end < written.length &&
                (written[end].isLetterOrDigit() || written[end] == '_' || written[end] == '.')
            ) {
                end += 1
            }
            val token = written.substring(at, end).trimEnd('.')
            val resolved = names.resolve(token)
            if (resolved == null) {
                out.append(token)
            } else {
                out.append(resolved.qualified())
                into.add(resolved.declared.fqn)
            }
            at = at + token.length
        }
        return out.toString()
    }

    /**
     * A set of declared types, transitively closed over everything their members and arms name.
     *
     * Transitive because the list answers *which declarations does this call put within reach*, and
     * that is what decides whether a documentation view of one can be opened at all. A depth-one
     * answer leaves a type that only another type names undiscoverable and unopenable.
     */
    private fun closure(seed: Collection<String>): LinkedHashSet<String> {
        val found = LinkedHashSet(seed)
        val queue = ArrayDeque(seed)
        while (queue.isNotEmpty()) {
            val fqn = queue.removeFirst()
            reached.add(fqn)
            for (next in mentions(fqn)) {
                if (found.add(next)) {
                    queue.addLast(next)
                }
            }
        }
        return found
    }

    /** Every declared type one declaration's own members and arms name. */
    private fun mentions(fqn: String): List<String> {
        val declared = index.types[fqn] ?: return emptyList()
        val names = Names(declared.file, index.types)
        val out = LinkedHashSet<String>()
        for ((_, written) in properties(declared.declaration)) {
            render(written, names, out)
        }
        for (arm in nestedArms(declared)) {
            for ((_, written) in properties(arm)) {
                render(written, names, out)
            }
        }
        for (arm in siblingArms(declared)) {
            out.add(arm.fqn)
        }
        return out.toList()
    }

    /**
     * The arms a sealed type declares **beside** it, each a declaration in its own right.
     *
     * Restricted to the declaring module, which is what Kotlin restricts a sealed hierarchy to
     * anyway: an arm is a subtype in the same package, so a match found elsewhere would be a
     * coincidence of names rather than an arm.
     */
    private fun siblingArms(declared: Declared): List<Declared> =
        index.types.values.filter { candidate ->
            candidate.fqn != declared.fqn &&
                candidate.module.id == declared.module.id &&
                extendsName(candidate.declaration, declared.declaration.name)
        }

    /**
     * The arms a sealed type declares **inside** itself, which Kotlin allows and Java does not.
     *
     * An enum's entries are `KtClassOrObject`s too and are deliberately not among them: they are
     * members in their own right and are read as such, so counting them here would list every
     * constant twice.
     */
    private fun nestedArms(declared: Declared): List<KtClassOrObject> =
        declared.declaration.declarations
            .filterIsInstance<KtClassOrObject>()
            .filterNot { it is KtEnumEntry }
            .filter { it.isPublic && extendsName(it, declared.declaration.name) }

    /** Whether a declaration names `name` among its supertypes, generics and arguments stripped. */
    private fun extendsName(declaration: KtClassOrObject, name: String?): Boolean =
        declaration.superTypeListEntries.any {
            it.text.substringBefore('(').substringBefore('<').substringAfterLast('.').trim() == name
        }

    /** One declared type, with a line per member and a menu of what a value of it offers. */
    private fun type(fqn: String): Declared2 {
        val declared = index.types[fqn] ?: fail("nothing declares the type `$fqn`")
        val names = Names(declared.file, index.types)
        val doc =
            documentation(declared.declaration)
                ?: fail("the type `$fqn` has no documentation on its declaration")
        val (brief, detail) = split(links(doc.body, names), "the type `$fqn`")

        val out = ArrayList<Member>()
        val entries = declared.declaration.declarations.filterIsInstance<KtEnumEntry>()
        for (entry in entries) {
            val prose =
                documentation(entry)?.body?.takeIf { it.isNotBlank() }
                    ?: fail("`$fqn.${entry.name}` has no documentation")
            val (line, rest) = split(links(prose, names), "`$fqn.${entry.name}`")
            out.add(Member(entry.name.orEmpty(), null, "variant", line, rest))
        }
        for ((property, written) in properties(declared.declaration)) {
            val prose =
                doc.named[property]?.takeIf { it.isNotBlank() }
                    ?: fail("`$fqn` documents no `@property $property`")
            val (line, rest) = split(links(prose, names), "`$fqn.$property`")
            out.add(
                Member(property, render(written, names, LinkedHashSet()), "field", line, rest),
            )
        }
        // An arm written inside the type is not a declaration of its own — see `Index.types` — so it
        // is listed here, and its own properties are listed under it. That is what keeps a model
        // reading `gg.delegation.Brief.Prompt` able to find out what goes in it.
        for (arm in nestedArms(declared)) {
            val armName = arm.name.orEmpty()
            val armDoc =
                documentation(arm) ?: fail("the arm `$fqn.$armName` has no documentation")
            val (line, rest) = split(links(armDoc.body, names), "`$fqn.$armName`")
            out.add(Member(armName, null, "variant", line, rest))
            for ((property, written) in properties(arm)) {
                val prose =
                    armDoc.named[property]?.takeIf { it.isNotBlank() }
                        ?: fail("`$fqn.$armName` documents no `@property $property`")
                val (held, more) = split(links(prose, names), "`$fqn.$armName.$property`")
                out.add(
                    Member(
                        "$armName.$property",
                        render(written, names, LinkedHashSet()),
                        "field",
                        held,
                        more,
                    ),
                )
            }
        }
        for (arm in siblingArms(declared)) {
            val prose =
                documentation(arm.declaration)?.body?.takeIf { it.isNotBlank() }
                    ?: fail("the arm `${arm.fqn}` of `$fqn` has no documentation")
            val (line, rest) = split(links(prose, names), "`${arm.fqn}`")
            out.add(Member(arm.name, arm.fqn, "variant", line, rest))
        }
        for (documented in doc.named.keys) {
            if (properties(declared.declaration).none { it.first == documented }) {
                fail("`$fqn` documents a `@property $documented` it does not declare")
            }
        }
        if (out.isEmpty()) {
            fail("the type `$fqn` has no members to describe")
        }
        return Declared2(
            fqn = fqn,
            module = declared.module.id,
            name = declared.name,
            declaration = declare(declared, names, entries),
            brief = brief,
            detail = detail,
            members = out,
            memberFunctions = members[fqn].orEmpty(),
        )
    }

    /** One type declaration, in the shape the second schema carries it. */
    private class Declared2(
        val fqn: String,
        val module: String,
        val name: String,
        val declaration: String,
        val brief: String,
        val detail: String?,
        val members: List<Member>,
        val memberFunctions: List<MemberFunction>,
    )

    private fun Json.write(type: Declared2) {
        field("fqn", type.fqn)
        field("module", type.module)
        field("name", type.name)
        field("declaration", type.declaration)
        field("brief", type.brief)
        if (type.detail == null) nullField("detail") else field("detail", type.detail)
        key("members")
        array {
            for (member in type.members) {
                obj {
                    field("name", member.name)
                    if (member.type == null) nullField("type") else field("type", member.type)
                    field("kind", member.kind)
                    field("brief", member.brief)
                    if (member.detail == null) nullField("detail") else field("detail", member.detail)
                }
            }
        }
        key("memberFunctions")
        array {
            for (member in type.memberFunctions) {
                obj {
                    field("operation", member.operation)
                    field("name", member.name)
                    field("fqn", member.fqn)
                    field("brief", member.brief)
                }
            }
        }
    }

    /** Every public property a declaration offers, as `name to written type`. */
    private fun properties(declaration: KtClassOrObject): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        for (parameter in declaration.primaryConstructorParameters) {
            if (!parameter.hasValOrVar() || !parameter.isPublic) {
                continue
            }
            out.add(
                (parameter.name ?: continue) to
                    (parameter.typeReference?.text ?: fail("a property states no type")),
            )
        }
        for (property in declaration.declarations.filterIsInstance<KtProperty>()) {
            if (!property.isPublic) {
                continue
            }
            out.add(
                (property.name ?: continue) to
                    (property.typeReference?.text ?: fail("a property states no type")),
            )
        }
        return out
    }

    /** The declaration line a model reads: what the SDK wrote, without its bodies. */
    private fun declare(
        declared: Declared,
        names: Names,
        entries: List<KtEnumEntry>,
    ): String {
        val declaration = declared.declaration
        val data = if (declaration.hasModifier(KtTokens.DATA_KEYWORD)) "data " else ""
        val sealed = if (declaration.hasModifier(KtTokens.SEALED_KEYWORD)) "sealed " else ""
        val keyword =
            when {
                declaration is KtObjectDeclaration -> "object"
                declaration is KtClass && declaration.isEnum() -> "enum class"
                declaration is KtClass && declaration.isInterface() -> "interface"
                else -> "class"
            }
        val parameters = (declaration as? KtClass)?.typeParameterList?.text.orEmpty()
        val constructor =
            declaration.primaryConstructorParameters
                .takeIf { it.isNotEmpty() }
                ?.joinToString(", ", "(", ")") { parameter ->
                    val held = if (parameter.hasValOrVar()) "val " else ""
                    val written = parameter.typeReference?.text.orEmpty()
                    "$held${parameter.name}: ${render(written, names, LinkedHashSet())}"
                }
                .orEmpty()
        val supertypes =
            declaration.superTypeListEntries
                .map { render(it.text.substringBefore('('), names, LinkedHashSet()) }
                .takeIf { it.isNotEmpty() }
                ?.joinToString(", ", " : ")
                .orEmpty()
        val body =
            when {
                entries.isNotEmpty() -> entries.joinToString(", ", " { ", " }") { it.name.orEmpty() }
                nestedArms(declared).isNotEmpty() ->
                    nestedArms(declared).joinToString("; ", " { ", " }") { arm ->
                        val record = if (arm.hasModifier(KtTokens.DATA_KEYWORD)) "data " else ""
                        val shape = if (arm is KtObjectDeclaration) "object" else "class"
                        val held =
                            arm.primaryConstructorParameters
                                .takeIf { it.isNotEmpty() }
                                ?.joinToString(", ", "(", ")") { parameter ->
                                    val name = parameter.name
                                    val written = parameter.typeReference?.text.orEmpty()
                                    "val $name: ${render(written, names, LinkedHashSet())}"
                                }
                                .orEmpty()
                        "$record$shape ${arm.name}$held"
                    }
                else -> ""
            }
        return "$sealed$data$keyword ${declared.name}$parameters$constructor$supertypes$body"
    }
}

// -------------------------------------------------------------------------------------------
// JSON
// -------------------------------------------------------------------------------------------

/**
 * The smallest JSON writer that can produce the catalogue's shape.
 *
 * Hand-written for the reason the Java arm's doclet has one: this tool is compiled by the pinned
 * Kotlin compiler out of two files and nothing else, so a dependency on a JSON library would mean a
 * resolver in an install step and one more thing to pin.
 */
private class Json {
    private val out = StringBuilder()
    private val first = ArrayDeque<Boolean>()
    private var indent = 0
    private var afterKey = false

    fun finish(): String = out.append('\n').toString()

    fun obj(write: Json.() -> Unit) {
        open('{')
        write()
        close('}')
    }

    fun array(write: Json.() -> Unit) {
        open('[')
        write()
        close(']')
    }

    fun key(name: String) {
        item()
        out.append(quote(name)).append(": ")
        afterKey = true
    }

    fun field(name: String, value: String) {
        key(name)
        item()
        out.append(quote(value))
    }

    fun field(name: String, value: Boolean) {
        key(name)
        item()
        out.append(value)
    }

    fun field(name: String, value: Int) {
        key(name)
        item()
        out.append(value)
    }

    fun nullField(name: String) {
        key(name)
        item()
        out.append("null")
    }

    fun value(text: String) {
        item()
        out.append(quote(text))
    }

    /** Write whatever separator this position needs, and remember that it is no longer the first. */
    private fun item() {
        if (afterKey) {
            afterKey = false
            return
        }
        if (first.isEmpty()) {
            return
        }
        if (first.last()) {
            first[first.lastIndex] = false
        } else {
            out.append(',')
        }
        newline(indent)
    }

    private fun open(bracket: Char) {
        item()
        out.append(bracket)
        first.addLast(true)
        indent += 1
    }

    private fun close(bracket: Char) {
        indent -= 1
        if (!first.removeLast()) {
            newline(indent)
        }
        out.append(bracket)
    }

    private fun newline(depth: Int) {
        out.append('\n')
        repeat(depth) { out.append(' ') }
    }

    private fun quote(text: String): String {
        val quoted = StringBuilder("\"")
        for (character in text) {
            when {
                character == '"' -> quoted.append("\\\"")
                character == '\\' -> quoted.append("\\\\")
                character == '\n' -> quoted.append("\\n")
                character == '\r' -> quoted.append("\\r")
                character == '\t' -> quoted.append("\\t")
                character < ' ' -> quoted.append("\\u%04x".format(character.code))
                else -> quoted.append(character)
            }
        }
        return quoted.append('"').toString()
    }
}

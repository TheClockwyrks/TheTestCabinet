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
import org.jetbrains.kotlin.psi.KtClass
import org.jetbrains.kotlin.psi.KtClassOrObject
import org.jetbrains.kotlin.psi.KtDeclaration
import org.jetbrains.kotlin.psi.KtEnumEntry
import org.jetbrains.kotlin.psi.KtFile
import org.jetbrains.kotlin.psi.KtNamedFunction
import org.jetbrains.kotlin.psi.KtObjectDeclaration
import org.jetbrains.kotlin.psi.KtParameter
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
 * `kotlin-compiler-embeddable`. A Dokka pinned separately could read a KDoc dialect the compiler no
 * longer does.
 *
 * It is a **parse** rather than an analysis, and that is deliberate: what a model needs to read is the
 * type the SDK's author *wrote* — `Patch<String>?`, `List<DirEntry>` — rather than a resolver's fully
 * qualified expansion of it.
 *
 * ## What it refuses to emit
 *
 * A blank. Every function, every argument, every type and every member of a type must carry
 * documentation, and every identity in [GgCatalogue] must resolve to a declaration; the reverse holds
 * too, so a public function of an API object that the identity table never names fails here rather
 * than reaching a model as a call nobody was told about. The
 * [agreement gate](crates/gg/src/sandbox/language/agreement.rs) makes the same checks over the emitted
 * JSON, for every language; this makes them where the author is, with a file and a name.
 */
private const val GENERATED_FROM: String =
    "packages/gg-sandbox-kotlin/src, read through the pinned Kotlin compiler's own front end " +
        "(tools/GgSignatures.kt)"

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

// -------------------------------------------------------------------------------------------
// Reading the SDK
// -------------------------------------------------------------------------------------------

/** Every model-facing declaration the SDK makes, indexed by the name a signature writes. */
private class Index(
    /** Every top-level class, interface and object, by name. */
    val classes: Map<String, KtClassOrObject>,
    /** Every top-level value, by name — which is where an API object's own description lives. */
    val values: Map<String, KtProperty>,
) {
    companion object {
        /**
         * Parse every model-facing file under `root`.
         *
         * `internal/` is left out by name: it is [the bridge](../src/internal/Wire.kt), every
         * declaration in it is `internal`, and a model cannot reach one — so reflecting it would put
         * the crossing itself in front of a model.
         */
        fun of(root: File): Index {
            // The environment is deliberately NOT disposed. PSI is lazy: a `KtFile`'s declarations
            // are built on demand out of the project this environment owns, so disposing it here
            // makes every later read fail inside IntelliJ's own extension lookup. The process is a
            // build step that exits, which is what frees it.
            val disposable = Disposer.newDisposable()
            run {
                for (name in listOf("config", "system", "plugins")) {
                    System.setProperty(
                        "idea.$name.path",
                        File(System.getProperty("java.io.tmpdir"), "gg-kdoc/$name").absolutePath,
                    )
                }
                val configuration = CompilerConfiguration()
                configuration.put(
                    CommonConfigurationKeys.MESSAGE_COLLECTOR_KEY,
                    MessageCollector.NONE,
                )
                configuration.put(CommonConfigurationKeys.MODULE_NAME, "gg-signatures")
                val environment =
                    KotlinCoreEnvironment.createForProduction(
                        disposable,
                        configuration,
                        EnvironmentConfigFiles.JVM_CONFIG_FILES,
                    )
                val factory = PsiFileFactory.getInstance(environment.project)
                val classes = LinkedHashMap<String, KtClassOrObject>()
                val values = LinkedHashMap<String, KtProperty>()
                val files =
                    root
                        .walkTopDown()
                        .filter { it.isFile && it.extension == "kt" }
                        .filterNot { it.parentFile.name == "internal" }
                        .sortedBy { it.name }
                for (file in files) {
                    val parsed =
                        factory.createFileFromText(
                            file.name,
                            KotlinFileType.INSTANCE,
                            file.readText(),
                        ) as KtFile
                    for (declaration in parsed.declarations) {
                        when (declaration) {
                            is KtClassOrObject ->
                                declaration.name?.let { classes[it] = declaration }
                            is KtProperty -> declaration.name?.let { values[it] = declaration }
                            else -> Unit
                        }
                    }
                }
                return Index(classes, values)
            }
        }
    }

    /** The class an identity names, or a failure saying which entry has no declaration. */
    fun classOf(name: String): KtClassOrObject =
        classes[name] ?: fail("the identity table names `$name` and no file declares it")

    /** The public function `name` declares on `owner`. */
    fun functionOf(owner: KtClassOrObject, name: String): KtNamedFunction =
        owner.declarations.filterIsInstance<KtNamedFunction>().firstOrNull {
            it.name == name && it.isPublic
        } ?: fail("`${owner.name}` declares no public `$name`")
}

/** Stop, saying what the author has to fix. */
private fun fail(why: String): Nothing {
    System.err.println("error: $why")
    kotlin.system.exitProcess(1)
}

// -------------------------------------------------------------------------------------------
// KDoc
// -------------------------------------------------------------------------------------------

/** One declaration's documentation, split the way the catalogue carries it. */
private class Doc(
    /** The prose above the tags, as paragraphs. */
    val body: String,
    /** Each `@param`'s or `@property`'s prose, by subject. */
    val named: Map<String, String>,
    /** Each `@throws`'s prose, by the type it names. */
    val thrown: Map<String, String>,
)

/** Read a declaration's KDoc, or nothing at all when it carries none. */
private fun documentation(declaration: KtDeclaration): Doc? {
    val doc: KDoc = declaration.docComment ?: return null
    val named = LinkedHashMap<String, String>()
    val thrown = LinkedHashMap<String, String>()
    for (tag in PsiTreeUtil.findChildrenOfType(doc, KDocTag::class.java)) {
        if (tag is KDocSection) {
            continue
        }
        val subject = tag.getSubjectName() ?: continue
        when (tag.name) {
            "param", "property" -> named[subject] = paragraphs(tag.getContent())
            "throws", "exception" -> thrown[subject] = paragraphs(tag.getContent())
            else -> Unit
        }
    }
    return Doc(paragraphs(doc.getDefaultSection().getContent()), named, thrown)
}

/**
 * KDoc's own text, as the paragraphs the catalogue carries.
 *
 * The SDK's comments are wrapped to a column, so a paragraph arrives as several lines and has to be
 * rejoined — but a fenced code block must not be, since its line breaks are the code's, and a list item
 * must not be either. Blank lines separate paragraphs, which is what `\n\n` means downstream.
 *
 * KDoc's `[Name]` link is rendered as `` `Name` ``: the catalogue's prose is markdown a prompt renders
 * verbatim, and a bare `[Name]` there reads as a broken link rather than as the type it names.
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
    return links(out.toString())
}

/** `[Name]` and `[Name.MEMBER]` as code spans; a markdown link is left alone. */
private fun links(text: String): String {
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
        out.append(text, at, open).append('`').append(inner).append('`')
        at = close + 1
    }
    return out.toString()
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

/** The whole catalogue, built out of the identity table and the SDK the index read. */
private class Catalogue(val index: Index, val libraries: Libraries) {
    /** Every type name any signature reached, in the order they were first reached. */
    private val referenced = LinkedHashSet<String>()

    fun emit(): String {
        val entries = GgCatalogue.ALL.map { entry -> entry to function(entry) }
        // The types are folded after every entry has been rendered, because what a type section must
        // declare is exactly what a signature reached.
        val types = closure().map { type(it) }
        checkNothingIsUnnamed()

        val json = Json()
        json.obj {
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
            key("objects")
            array {
                for ((name, _) in GgCatalogue.OBJECTS) {
                    val held =
                        index.values[name]
                            ?: fail("`src/Gg.kt` declares no top-level `$name` to describe")
                    val doc =
                        documentation(held)?.body?.takeIf { it.isNotBlank() }
                            ?: fail("the API object `$name` has no description on its value")
                    obj {
                        field("object", name)
                        field("doc", doc)
                    }
                }
            }
            for (section in listOf("meta", "session", "views", "programs", "tools", "helpers")) {
                key(section)
                array {
                    for ((entry, rendered) in entries.filter { it.first.section == section }) {
                        obj { rendered.write(this, entry) }
                    }
                }
            }
            key("types")
            array { for (declared in types) obj { declared.write(this) } }
        }
        return json.finish()
    }

    // ---------------------------------------------------------------------------------------
    // Functions
    // ---------------------------------------------------------------------------------------

    /** What one identity's declaration says. */
    private inner class Rendered(
        val signature: String,
        val parameters: List<Parameter>,
        val doc: String,
        val types: List<String>,
    ) {
        fun write(json: Json, entry: GgCatalogue.Entry) {
            with(json) {
                if (entry.section == "tools") {
                    field("tool", entry.key)
                } else {
                    field("key", entry.key)
                }
                entry.gate?.takeIf { entry.section != "tools" }?.let { field("requires", it) }
                field("name", entry.name)
                entry.owner?.let { field("object", it) }
                entry.ending?.let { field("ending", it) }
                key("signatures")
                array {
                    obj {
                        field("signature", signature)
                        key("parameters")
                        array { for (parameter in parameters) obj { parameter.write(this) } }
                    }
                }
                field("doc", doc)
                key("types")
                array { for (type in types) value(type) }
            }
        }
    }

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
                if (default == null) json.nullField("default") else field("default", default)
                field("doc", doc)
                key("fields")
                array {}
            }
        }
    }

    /** Read one identity's declaration out of the SDK. */
    private fun function(entry: GgCatalogue.Entry): Rendered {
        val owner = index.classOf(entry.className)
        val declared = index.functionOf(owner, entry.name)
        val where = "${entry.owner ?: entry.className}.${entry.name}"
        val doc =
            documentation(declared) ?: fail("`$where` has no documentation on its declaration")
        if (doc.body.isBlank()) {
            fail("`$where` has no documentation on its declaration")
        }

        val parameters =
            declared.valueParameters.map { parameter ->
                val name =
                    parameter.name ?: fail("an argument of `$where` has no name")
                val declaredType =
                    parameter.typeReference?.text
                        ?: fail("`$where`'s `$name` states no type")
                val default = parameter.defaultValue?.text
                val vararg = parameter.isVarArg
                val prose =
                    doc.named[name]?.takeIf { it.isNotBlank() }
                        ?: fail("`$where` documents no `@param $name`")
                for (mentioned in typeNames(declaredType)) {
                    if (index.classes.containsKey(mentioned)) {
                        referenced.add(mentioned)
                    }
                }
                Parameter(
                    name = name,
                    type = if (vararg) "vararg $declaredType" else declaredType,
                    optional = default != null || vararg,
                    kind = if (default != null) "keyword" else "positional",
                    default = default,
                    doc = prose,
                )
            }
        for (name in doc.named.keys) {
            if (declared.valueParameters.none { it.name == name }) {
                fail("`$where` documents an argument `$name` it does not take")
            }
        }

        // A block-bodied function with no stated type returns `Unit`, and the signature says so out
        // loud: that a call returns nothing is exactly what tells a model the rest of its program
        // still runs after it.
        val returns = declared.typeReference?.text ?: "Unit"
        for (mentioned in typeNames(returns)) {
            if (index.classes.containsKey(mentioned)) {
                referenced.add(mentioned)
            }
        }
        val rendered =
            declared.valueParameters.joinToString(", ") { parameter ->
                val prefix = if (parameter.isVarArg) "vararg " else ""
                val default = parameter.defaultValue?.text?.let { " = $it" } ?: ""
                "$prefix${parameter.name}: ${parameter.typeReference?.text}$default"
            }
        val signature = "${entry.name}($rendered): $returns"

        val body = StringBuilder(doc.body)
        for ((type, prose) in doc.thrown) {
            body.append("\n\nRaises `").append(type).append("`: ").append(prose)
            if (index.classes.containsKey(type)) {
                referenced.add(type)
            }
        }
        val reached = LinkedHashSet<String>()
        for (mentioned in typeNames(returns) + declared.valueParameters.flatMap {
            typeNames(it.typeReference?.text ?: "")
        } + doc.thrown.keys) {
            if (index.classes.containsKey(mentioned)) {
                reached.add(mentioned)
            }
        }
        return Rendered(signature, parameters, body.toString(), expand(reached).toList())
    }

    // ---------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------

    /** One type declaration, with a line per member. */
    private class Declared(
        val name: String,
        val doc: String,
        val declaration: String,
        val members: List<Triple<String, String?, String>>,
    ) {
        fun write(json: Json) {
            with(json) {
                field("name", name)
                field("doc", doc)
                field("declaration", declaration)
                key("members")
                array {
                    for ((member, type, prose) in members) {
                        obj {
                            field("name", member)
                            if (type == null) nullField("type") else field("type", type)
                            field("doc", prose)
                        }
                    }
                }
            }
        }
    }

    /** Every type the surface reached, and everything those in turn refer to. */
    private fun closure(): List<String> = expand(referenced).toList()

    /** `seed`, plus every declared type its members and its sealed arms refer to. */
    private fun expand(seed: Collection<String>): LinkedHashSet<String> {
        val found = LinkedHashSet(seed)
        val queue = ArrayDeque(seed)
        while (queue.isNotEmpty()) {
            val name = queue.removeFirst()
            val declaration = index.classes[name] ?: continue
            for (next in memberTypes(declaration) + arms(name).map { it.first }) {
                if (index.classes.containsKey(next) && found.add(next)) {
                    queue.addLast(next)
                }
            }
        }
        return found
    }

    /** Every type named by a declaration's own properties. */
    private fun memberTypes(declaration: KtClassOrObject): List<String> =
        properties(declaration).flatMap { typeNames(it.second) }

    /** The **top-level** subtypes of a sealed type, as `name to declaration`. */
    private fun arms(name: String): List<Pair<String, KtClassOrObject>> =
        index.classes.entries
            .filter { (_, declared) ->
                declared.superTypeListEntries.any { it.text.substringBefore('(') == name }
            }
            .map { it.key to it.value }

    /** One declared type, rendered the way Kotlin declares it. */
    private fun type(name: String): Declared {
        val declaration = index.classOf(name)
        val doc =
            documentation(declaration)?.takeIf { it.body.isNotBlank() }
                ?: fail("the type `$name` has no documentation")
        val members = ArrayList<Triple<String, String?, String>>()

        val enumEntries = declaration.declarations.filterIsInstance<KtEnumEntry>()
        for (entry in enumEntries) {
            val prose =
                documentation(entry)?.body?.takeIf { it.isNotBlank() }
                    ?: fail("`$name.${entry.name}` has no documentation")
            members.add(Triple(entry.name ?: fail("an entry of `$name` has no name"), null, prose))
        }
        for ((property, declaredType) in properties(declaration)) {
            val prose =
                doc.named[property]?.takeIf { it.isNotBlank() }
                    ?: fail("`$name` documents no `@property $property`")
            members.add(Triple(property, declaredType, prose))
        }
        val nested = nestedArms(declaration)
        for ((armName, armDeclaration) in nested + arms(name)) {
            val prose =
                documentation(armDeclaration)?.body?.takeIf { it.isNotBlank() }
                    ?: fail("the arm `$armName` of `$name` has no documentation")
            members.add(Triple(armName, armName, sentence(prose)))
        }
        if (members.isEmpty()) {
            fail("the type `$name` has no members to describe")
        }
        for (documented in doc.named.keys) {
            if (properties(declaration).none { it.first == documented }) {
                fail("`$name` documents a `@property $documented` it does not declare")
            }
        }
        return Declared(name, doc.body, declare(name, declaration, enumEntries, nested), members)
    }

    /**
     * The arms a sealed type declares **inside itself**, which Kotlin allows and Java does not.
     *
     * An enum's entries are `KtClassOrObject`s too and are deliberately not among them: they are
     * members in their own right and are read as such, so counting them here would list every
     * constant twice.
     */
    private fun nestedArms(declaration: KtClassOrObject): List<Pair<String, KtClassOrObject>> =
        declaration.declarations
            .filterIsInstance<KtClassOrObject>()
            .filterNot { it is KtEnumEntry }
            .filter { nested ->
                nested.isPublic &&
                    nested.superTypeListEntries.any {
                        it.text.substringBefore('(').substringBefore('<') == declaration.name
                    }
            }
            .map { "${declaration.name}.${it.name}" to it }

    /** Every public property a declaration offers, as `name to type`. */
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
        name: String,
        declaration: KtClassOrObject,
        enumEntries: List<KtEnumEntry>,
        nested: List<Pair<String, KtClassOrObject>>,
    ): String {
        val data =
            if (declaration.hasModifier(org.jetbrains.kotlin.lexer.KtTokens.DATA_KEYWORD)) {
                "data "
            } else {
                ""
            }
        val keyword =
            when {
                declaration is KtObjectDeclaration -> "object"
                declaration is KtClass && declaration.isEnum() -> "enum class"
                declaration is KtClass && declaration.isInterface() -> "interface"
                else -> "class"
            }
        val sealed = if (declaration.hasModifier(org.jetbrains.kotlin.lexer.KtTokens.SEALED_KEYWORD)) "sealed " else ""
        val parameters =
            (declaration as? KtClass)?.typeParameterList?.text.orEmpty()
        val constructor =
            declaration.primaryConstructorParameters
                .takeIf { it.isNotEmpty() }
                ?.joinToString(", ", "(", ")") { it.text.removePrefix("public ") }
                .orEmpty()
        val supertypes =
            declaration.superTypeListEntries
                .map { it.text }
                .takeIf { it.isNotEmpty() }
                ?.joinToString(", ", " : ")
                .orEmpty()
        val body =
            when {
                enumEntries.isNotEmpty() ->
                    enumEntries.joinToString(", ", " { ", " }") { it.name.orEmpty() }
                nested.isNotEmpty() ->
                    nested.joinToString("; ", " { ", " }") { (_, arm) ->
                        declare(arm.name.orEmpty(), arm, emptyList(), emptyList())
                    }
                else -> ""
            }
        return "$sealed$data$keyword $name$parameters$constructor$supertypes$body"
    }

    /** The first sentence of a paragraph, which is what a member line carries. */
    private fun sentence(prose: String): String {
        val paragraph = prose.substringBefore("\n\n").trim()
        val stop = paragraph.indexOf(". ")
        return if (stop < 0) paragraph else paragraph.substring(0, stop + 1)
    }

    // ---------------------------------------------------------------------------------------
    // Completeness
    // ---------------------------------------------------------------------------------------

    /**
     * The check the per-entry ones cannot make: a public function of an API object that the identity
     * table never names.
     *
     * A model would never be told about it — it is in no catalogue section — and it would still be
     * reachable in a program, which is the one direction a per-entry loop cannot see.
     */
    private fun checkNothingIsUnnamed() {
        val named =
            GgCatalogue.ALL.map { "${it.className}.${it.name}" }.toSet() + "ApiObject.list"
        for ((_, className) in GgCatalogue.OBJECTS) {
            val declaration = index.classOf(className)
            for (declared in declaration.declarations.filterIsInstance<KtNamedFunction>()) {
                if (!declared.isPublic) {
                    continue
                }
                if (declared.hasModifier(org.jetbrains.kotlin.lexer.KtTokens.OVERRIDE_KEYWORD)) {
                    continue
                }
                if ("$className.${declared.name}" !in named) {
                    fail(
                        "`$className.${declared.name}` is public and the identity table does not " +
                            "name it, so no model would be told it exists",
                    )
                }
            }
        }
    }
}

/** Every type name a written type mentions, generic arguments included. */
private fun typeNames(text: String): List<String> =
    Regex("[A-Za-z_][A-Za-z0-9_]*").findAll(text).map { it.value }.toList()

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

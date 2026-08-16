#!/usr/bin/env python3
"""Reflect the **C++** program language's signature catalogue out of the SDK's own documentation,
and write it to the ``cpp.signatures.json`` the caller names.

WHERE IT GOES. The destination is an argument, given by ``signatures.sh`` out of
``GG_SIGNATURES_OUT_DIR``, and nothing here has a default: the catalogue is a build artifact that
``crates/gg/build.rs`` generates into the build's own ``OUT_DIR``, and it is committed nowhere.

WHAT READS THE DOCUMENTATION. ``clang++``'s own **comment AST**, dumped as JSON. clang has a real
documentation parser built into it — the one ``-Wdocumentation`` diagnoses against and the one
``clang-doc`` and ``libclang``'s comment API are built on — and it does the three things that
matter: it decides which comment belongs to which declaration, it parses the Doxygen commands
inside one into structure, and it **keeps the lines** the author wrote. So ``\\param path``'s prose
arrives attached to the parameter called ``path``, ``\\returns`` and ``\\throws`` arrive as their
own nodes, and the first line of a comment is recoverable as a first line rather than as a sentence
this script had to find.

THE BRIEF IS THE FIRST LINE, AND THE SPLIT HAPPENS BEFORE ANYTHING IS UNWRAPPED. Doxygen's implicit
structure, with no ``\\brief`` tag anywhere: the opening paragraph of a declaration's comment is its
brief and everything after the blank line is its detail. It is checked here rather than three steps
later in a gate — an opening paragraph that runs to two source lines is refused, by name, at the
declaration it was written on — and it is checked on the RAW lines, because
:func:`unwrapped` exists to join a wrapped paragraph back into one line and running it first would
turn a three-line opening paragraph into a single line no rule could tell from a brief.

WHY THE OPERATION ID IS WRITTEN ON THE DECLARATION. gg's identity for a call — that
``files::read_file`` **is** gg's ``files.read_file`` operation, the same capability Java spells
``Workspace#readFile`` — is the one thing C++'s own syntax cannot say. It is written on the
declaration all the same, as a ``<ggop>files.read_file</ggop>`` line in its own ``///`` comment,
which clang's comment lexer hands back as ordinary text and this script lifts out before a model
ever reads the paragraph. An element rather than a ``\\command`` because an unknown Doxygen command
is a compiler warning on every declaration that carries one; on the declaration rather than in
``catalogue.py`` because a side table naming every function twice is the second copy that drifts.

WHY THE FILTER. A translation unit that includes this SDK also includes half the standard library,
and dumping its whole AST is ~300 MB for ``<string>`` alone. ``-ast-dump-filter=gg`` dumps only the
declarations whose name matches, which for this SDK is every one of them: the surface lives in
``namespace gg``.

WHAT IT IS NOT ALLOWED TO DO. Invent a word. Every string in the emitted JSON is either an identity
written on a declaration or text lifted out of a ``///`` comment. A blank anywhere is an error.

WHAT ``///`` MEANS HERE, which is a convention this file enforces. A ``///`` comment is
**model-facing** and a ``//`` comment is not. That is how a public member the bridge needs —
``tasks::text_edit::tag()``, ``delegation::brief::is_issue()`` — stays out of a model's reading of
the type while staying reachable to the SDK's own implementation, and how ``gg::core::gg_name``
stays out of a catalogue that carries exactly the declarations binding a gg operation.

Usage (through ``signatures.sh``, which dumps the AST first):

    signatures.py <ast.json> <prelude.hpp> <out.json>
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalogue  # noqa: E402  (the module table, beside this file)

#: The schema this catalogue is written in — the normalized doc model: modules, operations,
#: fully-qualified names, authored briefs and resolved type references.
SCHEMA = 1

#: What the emitted catalogue records itself as reflected from.
GENERATED_FROM = "packages/gg-sandbox-cpp/Sources/sdk/ (clang++ -ast-dump=json)"

#: The types every call's failure arm refers to, closed over on every entry because every function
#: in this SDK throws one of these when the call fails — including the two that cannot fail, whose
#: documentation says so. Written as a program writes them, and resolved like any other reference.
ALWAYS_REFERENCED = ("core::tool_error", "core::tool_error_code")

#: The line a declaration carries to name the gg operation it binds.
OPERATION_TAG = re.compile(r"^<ggop>([a-z_]+\.[a-z_]+)</ggop>$")

#: The line a declaration carries when it is a **second** way to reach an operation some other
#: declaration in this SDK binds canonically.
ALIAS_TAG = re.compile(r"^<ggop-alias>([a-z_]+\.[a-z_]+)</ggop-alias>$")

#: The line a module's namespace carries to name which of gg's cross-arm modules it is.
MODULE_TAG = re.compile(r"^<ggmodule>([a-z_]+)</ggmodule>$")

#: The longest a brief may be, in characters.
#:
#: The same cap ``crates/gg/src/sandbox/language/register.rs`` holds every arm's catalogue to, and it
#: is enforced here as well because the host's copy is a ``#[test]``: a reflection that embedded a
#: paragraph in the brief field would succeed, and so would a build, and the author would hear about
#: it from a gate three steps away naming an entry they then have to go looking for. Here is where
#: the author is standing.
BRIEF_CAP = 120


class Failure(Exception):
    """Something a model would have read is missing, or says something the code does not."""


# ------------------------------------------------------------------------------------------------
# The dump
# ------------------------------------------------------------------------------------------------


def documents(text):
    """Every top-level declaration ``-ast-dump-filter`` printed.

    The dump is a **concatenation** of JSON objects rather than one array — one per matched
    declaration — so it is decoded incrementally rather than with a single ``json.loads``.
    """
    decoder = json.JSONDecoder()
    at = 0
    out = []
    while at < len(text):
        while at < len(text) and text[at].isspace():
            at += 1
        if at >= len(text):
            break
        node, at = decoder.raw_decode(text, at)
        out.append(node)
    return out


def resolve_files(nodes):
    """Stamp every node with the source file its range begins in.

    clang's JSON writes a location's ``file`` only when it CHANGES, so a node's own range usually
    says nothing about which file it is in and inherits from whatever was printed before it. That
    is fine to read in order and impossible to read out of order, so this walks the whole dump once,
    in the order clang printed it, and writes the resolved answer onto each node under a key of this
    script's own.
    """
    state = {"file": None}

    def note(where):
        if isinstance(where, dict) and where.get("file"):
            state["file"] = where["file"]

    def walk(node):
        note(node.get("loc"))
        span = node.get("range") or {}
        note(span.get("begin"))
        node["ggFile"] = state["file"]
        note(span.get("end"))
        for child in node.get("inner", []):
            walk(child)

    for node in nodes:
        walk(node)


# ------------------------------------------------------------------------------------------------
# Documentation
# ------------------------------------------------------------------------------------------------


def fragments(node):
    """Every piece of text one comment node holds, each with the offset it starts at.

    clang's comment lexer splits a line wherever it thinks it sees markup — ``std::get_if<text_file>``
    arrives as four pieces, because ``<text`` looks like the start of an HTML tag. The offsets are
    what put them back together: two pieces that abut are one line, and a gap between them is the
    ``\\n///`` that separated them.
    """
    out = []

    def begin(child):
        return ((child.get("range") or {}).get("begin") or {}).get("offset")

    def walk(child):
        kind = child.get("kind")
        if kind == "TextComment":
            out.append((begin(child), child.get("text", "")))
        elif kind == "InlineCommandComment":
            command = "\\" + child.get("name", "")
            command += "".join(" " + argument for argument in child.get("args", []))
            out.append((begin(child), command))
        elif kind == "HTMLStartTagComment":
            attributes = "".join(
                f' {attribute["name"]}="{attribute.get("value", "")}"'
                for attribute in child.get("attrs", [])
            )
            out.append((begin(child), f'<{child.get("name", "")}{attributes}>'))
        elif kind == "HTMLEndTagComment":
            out.append((begin(child), f'</{child.get("name", "")}>'))
        elif kind in ("VerbatimBlockLineComment", "VerbatimLineComment"):
            out.append((begin(child), child.get("text", "")))
        elif kind not in (
            "ParagraphComment",
            "FullComment",
            "ParamCommandComment",
            "BlockCommandComment",
            "VerbatimBlockComment",
        ):
            raise Failure(
                f"the reflector does not know the comment node `{kind}` and will not guess at "
                "what it said — a dropped fragment is prose a model was meant to read"
            )
        for grandchild in child.get("inner", []):
            walk(grandchild)

    walk(node)
    return out


def lines_of(pieces):
    """One comment node's fragments, back as **the lines they were written on**.

    Exactly ONE leading space comes off each line, because that is the space after `///` and
    everything past it is the author's. Stripping the lot would flatten a fenced block's
    indentation, which on this arm is C++ a model is being shown.

    Nothing is joined here. What the lines are for decides that: a brief is the first of them and
    has to still be a line to be checked as one, while a paragraph of detail is put back together
    by `unwrapped`.
    """
    lines = []
    end = None
    for offset, text in pieces:
        if end is not None and offset == end:
            lines[-1] += text
        else:
            lines.append(text)
        end = None if offset is None else offset + len(text)
    return "\n".join(line[1:] if line.startswith(" ") else line for line in lines).rstrip()


def joined(pieces):
    """One comment node's fragments as a single settled line — what a `\\param` carries."""
    return unwrapped(lines_of(pieces)).strip()


def unwrapped(text):
    """A doc comment's paragraphs joined back into single lines.

    A `///` comment is wrapped to the source's line width, and those breaks are an artefact of
    reading C++ rather than anything a model should be shown: they turn one sentence into three
    lines in a documentation view and make a diff of the catalogue a diff of where the author's
    editor wrapped. Blank lines, list items and fenced blocks all survive — the first two because
    they are structure, the third because whitespace inside it is the code.
    """
    out = []
    paragraph = []
    fenced = False

    def flush():
        if paragraph:
            out.append(" ".join(paragraph))
            paragraph.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            flush()
            fenced = not fenced
            out.append(line)
            continue
        if fenced:
            out.append(line)
            continue
        if not stripped:
            flush()
            out.append("")
        elif stripped.startswith(("* ", "- ", "| ", "#")) or stripped.startswith("1. "):
            flush()
            paragraph.append(stripped)
        else:
            paragraph.append(stripped)
    flush()
    return "\n".join(out)


def paragraphs(comment):
    """One ``FullComment``'s description: every paragraph before the first command, as written."""
    out = []
    for child in comment.get("inner", []):
        if child.get("kind") != "ParagraphComment":
            break
        text = lines_of(fragments(child))
        if text:
            out.append(text)
    return out


def commands(comment, name):
    """Every ``\\<name>`` block in one comment, as ``(args, prose)``."""
    out = []
    for child in comment.get("inner", []):
        if child.get("kind") == "BlockCommandComment" and child.get("name") == name:
            out.append((child.get("args", []), joined(fragments(child))))
    return out


def parameter_docs(comment):
    """Every ``\\param`` in one comment, in the order it was written."""
    return [
        (child.get("param"), joined(fragments(child)))
        for child in comment.get("inner", [])
        if child.get("kind") == "ParamCommandComment"
    ]


def comment_of(node):
    """One declaration's ``FullComment``, or ``None`` when it carries no ``///``."""
    for child in node.get("inner", []):
        if child.get("kind") == "FullComment":
            return child
    return None


def tagged(node, pattern):
    """The one identity line on `node` matching `pattern`, or ``None``.

    Two of them would be two claims about one declaration, which is a defect rather than a choice,
    so it is refused here rather than resolved by picking the first.
    """
    comment = comment_of(node)
    if comment is None:
        return None
    found = [
        matched.group(1)
        for paragraph in paragraphs(comment)
        for matched in [pattern.fullmatch(paragraph.strip())]
        if matched
    ]
    if len(found) > 1:
        raise Failure(f"`{node.get('name')}` carries {len(found)} identity lines of one kind")
    return found[0] if found else None


def described(node, what):
    """One declaration's ``(brief, detail)``, with its identity lines taken out.

    The brief is the **first paragraph and one line**, and no longer than :data:`BRIEF_CAP`. An
    opening paragraph that runs to two lines is not a brief, and neither is a one-line sentence that
    runs on for a paragraph's worth of characters; both are refused here — naming the declaration
    they were written on — rather than reaching a model as a paragraph in the field where it
    expected a line.
    """
    comment = comment_of(node)
    if comment is None:
        raise Failure(f"{what} has no `///` documentation, so a model would read nothing")
    written = [
        paragraph
        for paragraph in paragraphs(comment)
        if not OPERATION_TAG.fullmatch(paragraph.strip())
        and not ALIAS_TAG.fullmatch(paragraph.strip())
        and not MODULE_TAG.fullmatch(paragraph.strip())
    ]
    if not written:
        raise Failure(f"{what}'s documentation is blank")
    brief = written[0].strip()
    if "\n" in brief:
        raise Failure(
            f"{what} opens with a paragraph of {len(brief.splitlines())} lines where a brief "
            "is one line — the first line is the brief and everything after the blank line is "
            f"the detail, so this reads as a brief nobody wrote: {brief!r}"
        )
    if len(brief) > BRIEF_CAP:
        raise Failure(
            f"{what} has a {len(brief)}-character brief, and a brief is capped at "
            f"{BRIEF_CAP}: {brief!r}"
        )
    detail = unwrapped("\n\n".join(written[1:])).strip() or None
    return brief, detail


def with_tail(detail, comment):
    """A function's detail with its ``\\returns`` and ``\\throws`` blocks written back on the end.

    They are commands rather than paragraphs, so they are not in the description — and they are two
    of the most useful sentences a model reads about a call, so they are not dropped either. The
    rendering is gg's: `Returns:` and `Throws:` on their own lines, which is the shape every other
    arm's catalogue carries whatever its language spells them.
    """
    tail = []
    for _, prose in commands(comment, "returns"):
        if not prose:
            raise Failure("a `\\returns` block says nothing")
        tail.append(f"Returns: {prose}")
    for arguments, prose in commands(comment, "throws"):
        if not prose:
            raise Failure("a `\\throws` block says nothing")
        thrown = " ".join(arguments)
        tail.append(f"Throws: {thrown} {prose}".strip())
    if not tail:
        return detail
    written = "\n".join(tail)
    return f"{detail}\n\n{written}" if detail else written


# ------------------------------------------------------------------------------------------------
# Types
# ------------------------------------------------------------------------------------------------


class Declared:
    """One type this SDK declares, and the two names it answers to.

    ``fqn`` is the key a documentation view is opened by and the string a program could write in
    full; ``spelled`` is what a signature writes, which is the module-qualified form the prelude's
    ``using namespace gg;`` leaves resolvable — `files::text_file` rather than `gg::files::text_file`
    or a bare `text_file`.
    """

    def __init__(self, module, node):
        self.module = module
        self.node = node
        self.name = node["name"]
        self.fqn = f"{module.path}::{self.name}"
        self.spelled = f"{module.name}::{self.name}"


def parameters_of(node):
    """One function declaration's parameters, as ``(name, type, default)``."""
    out = []
    for child in node.get("inner", []):
        if child.get("kind") != "ParmVarDecl":
            continue
        out.append(
            (
                child.get("name"),
                (child.get("type") or {}).get("qualType", ""),
                default_of(child),
            )
        )
    return out


def default_of(parameter):
    """The default argument as the SDK wrote it, read out of the header itself.

    clang's AST holds the default as an *expression tree* — an ``InitListExpr`` wrapping two
    ``CXXConstructExpr``s for ``= {}`` — and printing that back would be this script inventing a
    spelling. The source is what a model reads in a signature, so the source is what is quoted.
    """
    if not parameter.get("init"):
        return None
    for child in parameter.get("inner", []):
        if child.get("kind", "").endswith("Comment"):
            continue
        span = child.get("range") or {}
        begin = (span.get("begin") or {}).get("offset")
        end = span.get("end") or {}
        if begin is None or end.get("offset") is None:
            raise Failure(
                f"the default of `{parameter.get('name')}` has no source range to quote from"
            )
        # BYTE offsets, not character ones: clang counts what is in the file and this SDK's prose
        # is full of em dashes. Slicing a decoded `str` by them lands three bytes early per dash.
        quoted = source_of(parameter["ggFile"])[begin : end["offset"] + end.get("tokLen", 0)]
        return " ".join(quoted.decode("utf-8").split())
    return None


_SOURCES = {}


def source_of(name):
    """One header's bytes, read once."""
    if name not in _SOURCES:
        _SOURCES[name] = Path(name).read_bytes()
    return _SOURCES[name]


def returns_of(node):
    """The return type of one function declaration, as this SDK wrote it."""
    whole = (node.get("type") or {}).get("qualType", "")
    return whole.split("(", 1)[0].strip() or "void"


def signature_of(node, name):
    """One function declaration, rendered the way a catalogue entry carries it.

    ``read_file(std::string_view path, files::read_window window = {}) -> files::file_read``: the
    name a program writes first, because every arm's catalogue leads with it, then C++'s own
    parameter list with its own defaults, then the return type. A language that writes its return
    type first cannot lead with the name and also be a declaration, so this is a rendering rather
    than a quotation — and every type in it is spelled the way a program writes it.
    """
    parameters = parameters_of(node)
    written = ", ".join(
        f"{kind} {argument}" + (f" = {value}" if value else "")
        for argument, kind, value in parameters
    )
    return f"{name}({written}) -> {returns_of(node)}", parameters


def public_members(node):
    """The model-facing members of one record, in declaration order.

    Access is tracked rather than read off each member, because clang's JSON only writes it onto an
    ``AccessSpecDecl`` — a ``struct`` starts public and a ``class`` starts private, and each
    ``public:`` or ``private:`` moves the line.

    A member with no ``///`` is **not** model-facing and is left out: that is what keeps a bridge
    accessor the SDK's own implementation needs out of a model's reading of the type, without
    hiding it from the implementation.
    """
    out = []
    # A `struct`'s members start public, a `class`'s start private, and an `enum class`'s
    # enumerators have no access at all — they are always reachable.
    access = "private" if node.get("tagUsed") == "class" else "public"
    for child in node.get("inner", []):
        kind = child.get("kind")
        if kind == "AccessSpecDecl":
            access = child.get("access", access)
            continue
        if access != "public" or child.get("isImplicit") or kind not in (
            "FieldDecl",
            "CXXMethodDecl",
            "CXXConstructorDecl",
            "EnumConstantDecl",
        ):
            continue
        if comment_of(child) is None:
            continue
        out.append(child)
    return out


def is_member_function(member):
    """Whether one documented member is a **member function** rather than a part of the value.

    The two are told apart by the identity line and by nothing else: a member that binds a gg
    operation is a call in its own right, catalogued with its own signature and its own
    documentation view, while everything else — a field, an enumerator, a named factory — is part
    of what the type IS and is listed on the type's own declaration. Reading the C++ kind instead
    would file this SDK's named factories, which construct a value and bind no operation, as
    capabilities.
    """
    return tagged(member, OPERATION_TAG) is not None or tagged(member, ALIAS_TAG) is not None


def member_declaration(member, owner):
    """One member, as it is written in the declaration a model is shown."""
    kind = member.get("kind")
    if kind == "FieldDecl":
        return f'{(member.get("type") or {}).get("qualType", "")} {member.get("name")};'
    if kind == "EnumConstantDecl":
        return member.get("name")
    written = ", ".join(
        f"{argument_type} {argument}" + (f" = {value}" if value else "")
        for argument, argument_type, value in parameters_of(member)
    )
    prefix = "static " if member.get("storageClass") == "static" else ""
    if kind == "CXXConstructorDecl":
        return f"{prefix}{owner}({written});"
    whole = (member.get("type") or {}).get("qualType", "")
    returns = whole.split("(", 1)[0].strip()
    trailing = " const" if whole.rstrip().endswith(("const", "const noexcept")) else ""
    return f"{prefix}{returns} {member.get('name')}({written}){trailing};"


def member_name(member, owner):
    """What the catalogue lists one member under.

    A field and an enumerator are their own names. A named factory is its name **with its
    parameters**, because `set` and `set(std::string text)` are not the same thing to a model
    building one, and the type's members are the only place this SDK says how a value of it is
    constructed.
    """
    kind = member.get("kind")
    if kind in ("FieldDecl", "EnumConstantDecl"):
        return member.get("name")
    written = ", ".join(
        f"{argument_type} {argument}" for argument, argument_type, _ in parameters_of(member)
    )
    name = owner if kind == "CXXConstructorDecl" else member.get("name")
    return f"{name}({written})"


def member_type(member, owner):
    """What the catalogue records as a member's type.

    A field's is its type and a factory's is what it hands back, which for every one of them is the
    type being constructed. An enum's constant has none at all: the constant *is* the value.
    """
    kind = member.get("kind")
    if kind == "FieldDecl":
        return (member.get("type") or {}).get("qualType", "")
    if kind == "EnumConstantDecl":
        return None
    if kind == "CXXConstructorDecl":
        return owner
    return returns_of(member)


def declaration_of(node, name, members):
    """One type's declaration, as this SDK wrote it."""
    kind = node.get("kind")
    if kind == "TypeAliasDecl":
        alias = (node.get("type") or {}).get("qualType", "")
        return f"using {name} = {alias}"
    if kind == "EnumDecl":
        arms = ", ".join(member.get("name") for member in members)
        return f"enum class {name} {{ {arms} }}"
    written = " ".join(member_declaration(member, name) for member in members)
    tag = node.get("tagUsed", "struct")
    bases = "".join(
        f' : {base.get("writtenAccess", "public")} {base["type"]["qualType"]}'
        for base in node.get("bases", [])
    )
    return f"{tag} {name}{bases} {{ {written} }}"


# ------------------------------------------------------------------------------------------------
# The catalogue
# ------------------------------------------------------------------------------------------------


class Reflector:
    """One reflection of the SDK, from clang's dump to the JSON written into
    ``$GG_SIGNATURES_OUT_DIR``."""

    def __init__(self, dump):
        nodes = documents(dump)
        resolve_files(nodes)
        blocks = [
            node
            for node in nodes
            if node.get("kind") == "NamespaceDecl" and node.get("name") == "gg"
        ]
        if not blocks:
            raise Failure("the dump holds no `namespace gg`, so nothing was reflected")
        # `namespace gg { … }` is reopened by every header, and clang dumps each block, so the
        # surface is their union rather than any one of them.
        self.children = [child for block in blocks for child in block.get("inner", [])]
        self.modules = {}
        self.declared = {}
        self.types = {}
        self.member_functions = {}
        self.collect()

    def collect(self):
        """Index the surface: its capability modules, and every type they declare.

        A type is catalogued exactly when a **catalogued module declares it**, which is what makes
        every fully-qualified name in this artifact a real C++ path. It is also what keeps
        `gg::detail` out: the bridge declares records of its own there, and a catalogue that picked
        those up would describe the membrane to a model instead of the SDK.
        """
        by_name = {module.name: module for module in catalogue.MODULES}
        seen = {}
        for child in self.children:
            if child.get("kind") != "NamespaceDecl":
                continue
            id_ = tagged(child, MODULE_TAG)
            if id_ is None:
                continue
            if id_ in seen and seen[id_] != child["name"]:
                raise Failure(f"two namespaces claim gg's `{id_}` module")
            seen[id_] = child["name"]
            module = by_name.get(child["name"])
            if module is None or module.id != id_:
                raise Failure(
                    f"`gg::{child['name']}` declares itself gg's `{id_}` module, which "
                    "`catalogue.py` does not name it — the table and the declarations must agree "
                    "in both directions"
                )
            self.modules.setdefault(module.id, []).extend(child.get("inner", []))

        missing = [module.id for module in catalogue.MODULES if module.id not in self.modules]
        if missing:
            raise Failure(
                f"`catalogue.py` names modules no `namespace` declares itself to be: {missing}"
            )

        for module in catalogue.MODULES:
            for child in self.modules[module.id]:
                if child.get("kind") not in ("CXXRecordDecl", "EnumDecl", "TypeAliasDecl"):
                    continue
                if not child.get("name") or child.get("isImplicit"):
                    continue
                if comment_of(child) is None:
                    continue
                declared = Declared(module, child)
                if declared.spelled in self.declared:
                    raise Failure(f"two types are written `{declared.spelled}`")
                self.declared[declared.spelled] = declared

        self._spellings = re.compile(
            r"(?<![\w:])("
            + "|".join(re.escape(spelled) for spelled in sorted(self.declared, reverse=True))
            + r")(?![\w])"
        )
        self._bare = re.compile(
            r"(?<![\w:])("
            + "|".join(
                sorted({declared.name for declared in self.declared.values()}, reverse=True)
            )
            + r")(?![\w])"
        )

    # -- types -----------------------------------------------------------------------------------

    def referenced(self, written, out, what):
        """Every type this SDK declares that `written` names, in first-mention order.

        A type this SDK does not declare — `std::string`, `std::optional`, `std::vector` — is not
        catalogued and is not meant to be: it is C++'s, a model already knows it, and a declaration
        of it would be gg describing the standard library.

        A declared type written **bare** is refused rather than resolved. The spelling is what a
        model reads in a signature and copies out of it, so it has to be one that resolves at a
        call site and one string per type: an unqualified `text_file` beside a qualified
        `files::text_file` would be two names for one declaration, and only one of them opens.
        """
        for match in self._spellings.finditer(written or ""):
            if match.group(1) not in out:
                out.append(match.group(1))
        # A bare name that survives the lookbehind is one nothing qualified: `files::text_file`
        # cannot match here, because the `text_file` in it is preceded by a `:`.
        for match in self._bare.finditer(written or ""):
            bare = match.group(1)
            raise Failure(
                f"{what} writes the declared type `{bare}` unqualified, where every reference is "
                "module-qualified so that the spelling a model reads is one it can open"
            )

    def qualified(self, written):
        """`written`, with every declared type spelled the way a **program** writes it.

        clang prints a type relative to the namespace it was declared in, so the dump says
        `files::read_window` where a model's own file has to say `gg::files::read_window`: this arm
        reaches its SDK through an `#include` the program wrote, and an include brings nothing into
        scope beyond the names its headers declare. Every string a model reads a type out of goes
        through here — the signature line, an argument's type, a member's type and a rendered
        declaration.

        The lookbehind in the pattern is what makes it idempotent: the `files::` inside an already
        qualified `gg::files::read_window` is preceded by a `:` and does not match.
        """
        if not written:
            return written
        return self._spellings.sub(lambda found: self.declared[found.group(1)].fqn, written)

    def declare(self, spelled):
        """Record one type's declaration, once, and hand back the spellings its members mention."""
        if spelled in self.types:
            return self.types[spelled]["referenced"]
        declared = self.declared[spelled]
        node = declared.node
        found = public_members(node)
        parts = [member for member in found if not is_member_function(member)]
        rendered = self.qualified(declaration_of(node, declared.name, parts))
        brief, detail = described(node, f"the type `{declared.fqn}`")
        members = []
        referenced = []
        for member in parts:
            kind = "variant" if member.get("kind") == "EnumConstantDecl" else "field"
            # The owner is the type as a program WRITES it, because a constructor's
            # "type" is the value it builds and that string is a reference like any
            # other — a bare one would name a type nothing could open.
            written = member_type(member, declared.spelled)
            if written:
                self.referenced(written, referenced, f"`{declared.fqn}::{member.get('name')}`")
            member_brief, member_detail = described(
                member, f"`{declared.fqn}::{member.get('name')}`"
            )
            members.append(
                {
                    "name": self.qualified(member_name(member, declared.name)),
                    "type": self.qualified(written),
                    "kind": kind,
                    "brief": member_brief,
                    "detail": member_detail,
                }
            )
        # An ALIAS carries its referent rather than members, and the referent is the half a reader
        # would otherwise lose: `files::file_read` is `std::variant<files::text_file,
        # files::image_file>`, so a model shown the alias and neither alternative has been shown
        # nothing at all.
        if node.get("kind") == "TypeAliasDecl":
            self.referenced(
                (node.get("type") or {}).get("qualType", ""),
                referenced,
                f"the type `{declared.fqn}`",
            )
        self.types[spelled] = {
            "fqn": declared.fqn,
            "module": declared.module.id,
            "name": declared.name,
            "declaration": rendered,
            "brief": brief,
            "detail": detail,
            "members": members,
            "memberFunctions": [],
            "referenced": referenced,
        }
        return referenced

    def close_over(self, spellings):
        """The declared types a signature mentions, transitively closed, in first-mention order.

        Transitive because the list answers *which declarations does this run's surface reach*,
        which is what decides whether a type may be opened at all. What a documentation view opens
        beside a function is a **depth-one** question gg answers for itself from `returns` and the
        signature text, so widening here costs nothing there.
        """
        pending = list(spellings)
        seen = []
        while pending:
            spelled = pending.pop(0)
            if spelled in seen or spelled not in self.declared:
                continue
            seen.append(spelled)
            pending.extend(self.declare(spelled))
        return seen

    def references(self, spellings):
        """A list of spellings, as the resolved type references the catalogue carries.

        `spelled` is what the signature writes and `fqn` is the key a documentation view is opened
        by, and on this arm they are now one string: a program reaches gg through its own
        `#include`, which declares `gg::files::read_window` and nothing shorter, so the spelling a
        model copies out of a signature is the fully-qualified name.
        """
        return [
            {"spelled": self.declared[spelled].fqn, "fqn": self.declared[spelled].fqn}
            for spelled in spellings
        ]

    # -- functions -------------------------------------------------------------------------------

    def shape(self, node, name, what):
        """One calling shape and the arguments it documents."""
        comment = comment_of(node)
        if comment is None:
            raise Failure(f"{what} has no `///` documentation")
        rendered, parameters = signature_of(node, name)
        rendered = self.qualified(rendered)
        documented = parameter_docs(comment)
        if len(documented) != len(parameters):
            raise Failure(
                f"{what} takes {len(parameters)} arguments and documents {len(documented)} — "
                "clang parses `\\param` for us, so every argument must have one"
            )
        out = []
        for (written, description), (argument, kind, value) in zip(documented, parameters):
            if written != argument:
                raise Failure(
                    f"{what} documents `{written}` where its signature takes `{argument}` — a "
                    "renamed argument left behind in the documentation tells a model to write "
                    "something the call will not accept"
                )
            if not description:
                raise Failure(f"{what}'s `{argument}` has no description")
            out.append(
                {
                    "name": argument,
                    "type": self.qualified(kind),
                    "optional": value is not None,
                    # C++ has no keyword arguments: every argument is positional, and one a program
                    # may say nothing about says so with a DEFAULT rather than with a name at the
                    # call site.
                    "kind": "positional",
                    "default": value,
                    "doc": description,
                    # Always empty: every structured argument here is typed by NAME —
                    # `files::read_window`, `board::issue_options` — and that type is catalogued
                    # with its own documented members. Filling both would be two copies of one
                    # sentence with nothing keeping them equal.
                    "fields": [],
                }
            )
        return {"signature": rendered, "parameters": out}

    def entry(self, nodes, module, operation, alias_of, receiver=None):
        """One catalogued call, from every declaration that spells it.

        An overload pair is two spellings of one capability and the catalogue carries one
        description, so one of them documents the whole — and it is the FULLEST, because the shape
        that takes the most arguments is the one whose prose has to cover them. Two overloads of
        the same arity would make that choice arbitrary, so it is refused rather than decided by
        declaration order.
        """
        name = nodes[0]["name"]
        fqn = (
            f"{module.path}::{receiver}::{name}"
            if receiver is not None
            else f"{module.path}::{name}"
        )
        what = f"`{fqn}`"
        widths = [len(parameters_of(node)) for node in nodes]
        if len(set(widths)) != len(widths):
            raise Failure(
                f"{what} has two overloads of the same arity, so which one documents the entry "
                "would be decided by declaration order — give the catalogue one description to "
                "read by making the fullest overload the documented one"
            )
        documented = max(nodes, key=lambda node: len(parameters_of(node)))
        # The identity belongs on the declaration that carries the description, because that is the
        # one a reader of the header is standing at when they read what the call is. An id on the
        # shorter overload would be an id on a comment the catalogue never renders.
        if tagged(documented, OPERATION_TAG) is None and tagged(documented, ALIAS_TAG) is None:
            raise Failure(
                f"{what} names its gg operation on an overload other than the one that documents "
                "the entry — the identity goes on the fullest shape, beside the prose that covers "
                "every argument"
            )
        shapes = [self.shape(node, name, what) for node in nodes]
        arguments = []
        returned = []
        for node in nodes:
            for _, kind, _ in parameters_of(node):
                self.referenced(kind, arguments, what)
            self.referenced(returns_of(node), returned, what)
        brief, detail = described(documented, what)
        return {
            "operation": operation,
            "aliasOf": alias_of,
            "module": module.id,
            "kind": "method" if receiver is not None else "function",
            "receiver": receiver,
            "name": name,
            "fqn": fqn,
            # `null`, because on this arm the fully-qualified name IS what a program writes: the
            # prelude's `using namespace gg;` puts every module in scope, so `files::read_file` and
            # `gg::files::read_file` are the same path written short and long.
            "call": None,
            "brief": brief,
            # The tail is read off the SAME declaration the prose came from — `documented`, the
            # fullest overload — because `\returns` and `\throws` describe that shape's arguments.
            "detail": with_tail(detail, comment_of(documented)),
            "signatures": shapes,
            # The closure runs first, because it is what records the declarations both lists then
            # name; `returns` itself is the DIRECT return position and nothing beyond it, since
            # what it feeds is a one-level rule.
            "types": self.references(
                self.close_over(arguments + returned + list(ALWAYS_REFERENCED))
            ),
            "returns": self.references(returned),
        }

    def functions_and_members(self):
        """Every catalogued call, module by module, with the member functions collected beside them.

        The member walk runs over the **declared types** rather than out of the type renderer,
        deliberately: a member function is a real declaration with its own operation id, its own
        signature and its own documentation, and a renderer that listed a type's methods from the
        type would emit entries nobody had written an id on — this SDK's named factories among
        them.
        """
        functions = []
        for module in catalogue.MODULES:
            groups = {}
            for child in self.modules[module.id]:
                if child.get("kind") != "FunctionDecl" or child.get("isImplicit"):
                    continue
                # A declaration carrying no `///` is not model-facing on this arm, and is the one
                # way a module may hold something a program can call and a model is never told
                # about — `gg::core::gg_name`, which assembles this SDK's own error message.
                if comment_of(child) is None:
                    continue
                groups.setdefault(child["name"], []).append(child)
            for name, nodes in groups.items():
                operation = next(
                    (found for node in nodes if (found := tagged(node, OPERATION_TAG))), None
                )
                alias_of = next(
                    (found for node in nodes if (found := tagged(node, ALIAS_TAG))), None
                )
                if operation is None and alias_of is None:
                    raise Failure(
                        f"`{module.path}::{name}` is documented and names no gg operation, so a "
                        "model would never be told it exists — write "
                        "`<ggop><namespace>.<key></ggop>` in its own `///` comment"
                    )
                if operation is not None and alias_of is not None:
                    raise Failure(
                        f"`{module.path}::{name}` is both an operation and an alias of one"
                    )
                functions.append(
                    self.entry(nodes, module, operation or alias_of, alias_of)
                )

        # The members, over the types the modules declare. Each one is emitted twice on purpose:
        # once as a catalogued call, because it is one, and once as a line on its receiver's own
        # documentation view, which is the menu a model reads when it opens the type.
        for spelled, declared in self.declared.items():
            for member in public_members(declared.node):
                if not is_member_function(member):
                    continue
                operation = tagged(member, OPERATION_TAG)
                alias_of = tagged(member, ALIAS_TAG)
                if operation is not None and alias_of is not None:
                    raise Failure(
                        f"`{declared.fqn}::{member['name']}` is both an operation and an alias"
                    )
                entry = self.entry(
                    [member], declared.module, operation or alias_of, alias_of, declared.name
                )
                functions.append(entry)
                self.member_functions.setdefault(spelled, []).append(
                    {
                        "operation": entry["operation"],
                        "name": entry["name"],
                        "fqn": entry["fqn"],
                        "brief": entry["brief"],
                    }
                )
        return functions

    # -- the whole document ----------------------------------------------------------------------

    def modules_section(self):
        """Each module's own brief and detail, out of its namespace's own `///`, and the include
        line a program reaches it by.

        The include line is composed rather than reflected, and the header it names is checked to
        be a real file: it is copied character for character into a model's program, and a line
        naming a header the archive does not carry is a turn spent on a `file not found`.
        """
        out = []
        for module in catalogue.MODULES:
            header = Path("Sources/sdk") / module.header
            if not header.is_file():
                raise Failure(
                    f"`{module.path}` states `{module.include}` as its import line and "
                    f"{header} is not a file"
                )
            block = next(
                child
                for child in self.children
                if child.get("kind") == "NamespaceDecl"
                and child.get("name") == module.name
                and comment_of(child) is not None
            )
            brief, detail = described(block, f"the `{module.path}` module")
            out.append(
                {
                    "id": module.id,
                    "path": module.path,
                    "brief": brief,
                    "detail": detail,
                    # The one line a program writes to reach this module. clang's comment AST
                    # reports no include line for a declaration — there is no such thing to report,
                    # since a header is a file rather than a property of what it declares — so this
                    # is composed from the module's own name, and the file it names is checked to
                    # exist below.
                    "import": module.include,
                }
            )
        return out

    def build(self, libraries):
        functions = self.functions_and_members()
        # The member functions are folded into their receivers by the walk above, so the type
        # declarations are finished last — after every entry that could add a line to one.
        for spelled in list(self.types):
            self.types[spelled]["memberFunctions"] = self.member_functions.get(spelled, [])
        return {
            "schema": SCHEMA,
            "language": "cpp",
            "generatedFrom": GENERATED_FROM,
            "libraries": libraries,
            "modules": self.modules_section(),
            "functions": functions,
            "types": [
                {key: value for key, value in declaration.items() if key != "referenced"}
                for _, declaration in sorted(
                    self.types.items(), key=lambda pair: pair[1]["fqn"]
                )
            ],
        }


# ------------------------------------------------------------------------------------------------
# The library set
# ------------------------------------------------------------------------------------------------


def libraries_of(prelude):
    """This arm's library set, read out of the prelude that actually ships it.

    The prelude groups the standard library under `// == Heading ==` lines, and that one declaration
    has two readers: the compile, which is what the headers really are, and this, which is what a
    model is told they are. A hand-kept second list is the one place a model could be told about a
    header it has not got.
    """
    groups = []
    heading = None
    for line in Path(prelude).read_text().splitlines():
        marked = re.fullmatch(r"//\s*==\s*(.+?)\s*==\s*", line)
        if marked:
            heading = marked.group(1)
            groups.append({"group": heading, "modules": []})
            continue
        included = re.fullmatch(r"#include\s*<([^>]+)>\s*", line)
        if included and groups:
            groups[-1]["modules"].append(f"<{included.group(1)}>")
    if not groups:
        raise Failure(f"{prelude} declares no `// == Heading ==` groups to read its set from")
    empty = [group["group"] for group in groups if not group["modules"]]
    if empty:
        raise Failure(f"{prelude} has library groups with no headers under them: {empty}")
    return groups


# ------------------------------------------------------------------------------------------------


def main():
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    dump, prelude, out = sys.argv[1:]
    catalogued = Reflector(Path(dump).read_text()).build(libraries_of(prelude))
    Path(out).write_text(json.dumps(catalogued, indent=2, ensure_ascii=False) + "\n")
    print(
        f"wrote {out}: {len(catalogued['functions'])} functions, "
        f"{len(catalogued['types'])} types, {len(catalogued['modules'])} modules"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Failure as failure:
        raise SystemExit(f"error: {failure}")

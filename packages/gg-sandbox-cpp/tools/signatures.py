#!/usr/bin/env python3
"""Reflect the **C++** program language's signature catalogue out of the SDK's own documentation,
and write it to ``crates/gg/src/sandbox/guests/cpp.signatures.json``.

WHAT READS THE DOCUMENTATION. ``clang++``'s own **comment AST**, dumped as JSON. clang has a real
documentation parser built into it — the one ``-Wdocumentation`` diagnoses against and the one
``clang-doc`` and ``libclang``'s comment API are built on — and it does the two things that matter:
it decides which comment belongs to which declaration, and it parses the Doxygen commands inside
one into structure. So ``\\param path``'s prose arrives attached to the parameter called ``path``
rather than as a line this script had to find, ``\\returns`` and ``\\throws`` arrive as their own
nodes, and ``\\copydoc`` arrives as a resolvable reference.

That makes C++ one of the few arms here with a **real per-parameter documentation slot** rather than
a convention standing in for one: Rust needs a ``# Arguments`` list and PureScript needs the same,
because neither language has anywhere to write a comment on a parameter. clang polices this one for
us — ``signatures.sh`` compiles the reflection unit with ``-Werror=documentation``, so a ``\\param``
naming an argument the function does not take is a failed reflection rather than a sentence a model
reads about an argument that does not exist.

WHY THE FILTER. A translation unit that includes this SDK also includes half the standard library,
and dumping its whole AST is ~300 MB for ``<string>`` alone. ``-ast-dump-filter=gg`` dumps only the
declarations whose name matches, which for this SDK is every one of them: the surface lives in
``namespace gg`` because one of its objects is called ``system`` and ``<cstdlib>`` already has one.
3 MB and half a second.

WHAT IT IS NOT ALLOWED TO DO. Invent a word. Every string in the emitted JSON is either an identity
from ``catalogue.py`` (a tool name, an object, a gate) or text lifted out of a ``///`` comment. A
blank anywhere is an error.

WHAT ``///`` MEANS HERE, which is a convention this file enforces. A ``///`` comment is
**model-facing** and a ``//`` comment is not. That is how a public member the bridge needs —
``text_edit::tag()``, ``brief::is_issue()`` — stays out of a model's reading of the type while
staying reachable to the SDK's own implementation: it carries ``//``. A public member with no
documentation comment at all is therefore left out of the declaration and out the member list
rather than emitted blank.

Usage (through ``signatures.sh``, which dumps the AST first):

    signatures.py <ast.json> <prelude.hpp> <out.json>
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalogue  # noqa: E402  (the identity table, beside this file)

#: What the emitted catalogue records itself as reflected from.
GENERATED_FROM = "packages/gg-sandbox-cpp/Sources/sdk/ (clang++ -ast-dump=json)"

#: The types every call's failure arm refers to, added to every entry's `types` because every
#: function in this SDK throws one of these when the call fails — including the two that cannot
#: fail, whose documentation says so.
ALWAYS_REFERENCED = ("tool_error", "tool_error_code")

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


def joined(pieces):
    """One comment node's fragments, back as the lines they were written on.

    Exactly ONE leading space comes off each line, because that is the space after `///` and
    everything past it is the author's. Stripping the lot would flatten a fenced block's
    indentation, which on this arm is C++ a model is being shown.
    """
    lines = []
    end = None
    for offset, text in pieces:
        if end is not None and offset == end:
            lines[-1] += text
        else:
            lines.append(text)
        end = None if offset is None else offset + len(text)
    return unwrapped(
        "\n".join(line[1:] if line.startswith(" ") else line for line in lines).rstrip()
    ).strip()


def unwrapped(text):
    """A doc comment's paragraphs joined back into single lines.

    A `///` comment is wrapped to the source's line width, and those breaks are an artefact of
    reading C++ rather than anything a model should be shown: they turn one sentence into three
    lines in a system prompt and make a diff of the catalogue a diff of where the author's editor
    wrapped. Blank lines, list items and fenced blocks all survive — the first two because they are
    structure, the third because whitespace inside it is the code.
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
    """One ``FullComment``'s description: every paragraph before the first command."""
    out = []
    for child in comment.get("inner", []):
        if child.get("kind") != "ParagraphComment":
            break
        text = joined(fragments(child))
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


class Docs:
    """Every doc comment in the SDK, and the one command that points from one to another."""

    def __init__(self, index):
        self.index = index

    def described(self, node, what):
        """One declaration's model-facing prose, with ``\\copydoc`` resolved."""
        comment = comment_of(node)
        if comment is None:
            raise Failure(f"{what} has no `///` documentation, so a model would read nothing")
        text = "\n\n".join(paragraphs(comment)).strip()
        copied = re.fullmatch(r"\\copydoc\s+([A-Za-z0-9_:]+)", text)
        if copied:
            target = self.index.get(copied.group(1))
            if target is None:
                raise Failure(
                    f"{what} copies the documentation of `{copied.group(1)}`, which this SDK does "
                    "not declare"
                )
            return self.described(target, f"`{copied.group(1)}`")
        if not text:
            raise Failure(f"{what}'s documentation is blank")
        return text


def with_tail(text, comment):
    """A function's prose with its ``\\returns`` and ``\\throws`` blocks written back on the end.

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
        return text
    return text + "\n\n" + "\n".join(tail)


# ------------------------------------------------------------------------------------------------
# Types
# ------------------------------------------------------------------------------------------------

#: An identifier that is not preceded by `::`, which is how a name this SDK declared is told from a
#: member of `std`.
_NAME = re.compile(r"(?<!:)\b([A-Za-z_][A-Za-z0-9_]*)\b")


def referenced(rendered, declared, out):
    """Every type this SDK declares that appears in `rendered`, in first-mention order."""
    for match in _NAME.finditer(rendered or ""):
        name = match.group(1)
        if name in declared and name not in out:
            out.append(name)


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


def signature_of(node, name):
    """One function declaration, rendered the way a catalogue entry carries it.

    ``read_file(std::string_view path, read_window window = {}) -> file_read``: the name a program
    writes first, because the agreement gate holds every arm to that, then C++'s own parameter list
    with its own defaults, then the return type. It is the shape the [Java](java) arm settled on for
    the same reason — a language that writes its return type first cannot lead with the name and
    also be a declaration.
    """
    parameters = parameters_of(node)
    written = ", ".join(
        f"{kind} {argument}" + (f" = {value}" if value else "")
        for argument, kind, value in parameters
    )
    whole = (node.get("type") or {}).get("qualType", "")
    returns = whole.split("(", 1)[0].strip() or "void"
    return f"{name}({written}) -> {returns}", parameters, returns


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


def member_declaration(member, owner):
    """One member, as it is written in the declaration a model is shown."""
    kind = member.get("kind")
    if kind in ("FieldDecl",):
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


def member_type(member, owner):
    """What the catalogue records as a member's type.

    A field's is its type; a **function's is its whole signature**, because that is what a member of
    a class with named factories actually is and a bare return type would tell a model nothing about
    how to reach it. An enum's constant has none at all: the constant *is* the value.
    """
    kind = member.get("kind")
    if kind == "FieldDecl":
        return (member.get("type") or {}).get("qualType", "")
    if kind == "EnumConstantDecl":
        return None
    return member_declaration(member, owner).rstrip(";")


def declaration_of(node, name):
    """One type's declaration, as this SDK wrote it, and its documented members."""
    kind = node.get("kind")
    if kind == "TypeAliasDecl":
        alias = (node.get("type") or {}).get("qualType", "")
        return f"using {name} = {alias}", []
    if kind == "EnumDecl":
        members = public_members(node)
        arms = ", ".join(member.get("name") for member in members)
        return f"enum class {name} {{ {arms} }}", members
    members = public_members(node)
    written = " ".join(member_declaration(member, name) for member in members)
    tag = node.get("tagUsed", "struct")
    bases = "".join(
        f' : {base.get("writtenAccess", "public")} {base["type"]["qualType"]}'
        for base in node.get("bases", [])
    )
    return f"{tag} {name}{bases} {{ {written} }}", members


# ------------------------------------------------------------------------------------------------
# The catalogue
# ------------------------------------------------------------------------------------------------


class Reflector:
    """One reflection of the SDK, from clang's dump to the committed JSON."""

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
        self.objects = {}
        self.declarable = {}
        self.qualified = {}
        for child in self.children:
            name = child.get("name")
            if child.get("kind") == "NamespaceDecl":
                self.objects.setdefault(name, []).extend(child.get("inner", []))
                for member in child.get("inner", []):
                    if member.get("name"):
                        self.qualified[f'gg::{name}::{member["name"]}'] = member
            elif child.get("kind") in ("CXXRecordDecl", "EnumDecl", "TypeAliasDecl"):
                if name and not child.get("isImplicit"):
                    self.declarable[name] = child
        self.docs = Docs(self.qualified)
        self.types = {}

        missing = [name for name in catalogue.OBJECTS if name not in self.objects]
        if missing:
            raise Failure(f"the catalogue names API objects this SDK has no namespace for: {missing}")

    # -- functions -------------------------------------------------------------------------------

    def overloads(self, object_, name):
        """Every declaration of one function on an API object — one per overload."""
        found = [
            child
            for child in self.objects[object_]
            if child.get("kind") == "FunctionDecl" and child.get("name") == name
        ]
        if not found:
            raise Failure(
                f"the catalogue names `{object_}::{name}`, which this SDK does not declare"
            )
        return found

    def shape(self, node, name, what):
        """One calling shape and the arguments it documents."""
        comment = comment_of(node)
        if comment is None:
            raise Failure(f"{what} has no `///` documentation")
        rendered, parameters, _ = signature_of(node, name)
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
                    "type": kind,
                    "optional": value is not None,
                    # C++ has no keyword arguments: every argument is positional, and one a program
                    # may say nothing about says so with a DEFAULT rather than with a name at the
                    # call site.
                    "kind": "positional",
                    "default": value,
                    "doc": description,
                    # Always empty: every structured argument here is typed by NAME — `read_window`,
                    # `issue_options` — and that type is catalogued with its own documented members.
                    # Filling both would be two copies of one sentence with nothing keeping them
                    # equal.
                    "fields": [],
                }
            )
        return {"signature": rendered, "parameters": out}

    def entry(self, spec):
        """One catalogue entry, whatever section it belongs to."""
        what = f"`{spec['object']}::{spec['name']}`"
        nodes = self.overloads(spec["object"], spec["name"])
        names = []
        shapes = []
        for node in nodes:
            shapes.append(self.shape(node, spec["name"], what))
            for _, kind, _ in parameters_of(node):
                referenced(kind, self.declarable, names)
            referenced((node.get("type") or {}).get("qualType", ""), self.declarable, names)
        # An overload pair is two spellings of one capability and the catalogue carries one
        # description, so one of them documents the whole — and it is the FULLEST, because the shape
        # that takes the most arguments is the one whose prose has to cover them. [Java](java)'s arm
        # reached the same answer from the other direction. Two overloads of the same arity would
        # make that choice arbitrary, so it is refused rather than decided by declaration order.
        widths = [len(parameters_of(node)) for node in nodes]
        if len(set(widths)) != len(widths):
            raise Failure(
                f"{what} has two overloads of the same arity, so which one documents the entry "
                "would be decided by declaration order — give the catalogue one description to "
                "read by making the fullest overload the documented one"
            )
        described = max(nodes, key=lambda node: len(parameters_of(node)))
        prose = self.docs.described(described, what)
        return {
            "name": spec["name"],
            "object": spec["object"],
            "signatures": shapes,
            "doc": with_tail(prose, comment_of(described)),
            "types": self.close_over(names),
        }

    def close_over(self, names):
        """The SDK's own types a signature mentions, transitively closed, in first-mention order.

        A type this SDK does not declare — `std::string`, `std::optional`, `std::vector` — is not
        catalogued and is not meant to be: it is C++'s, a model already knows it, and a declaration
        of it would be gg describing the standard library.
        """
        pending = list(names) + list(ALWAYS_REFERENCED)
        seen = []
        while pending:
            name = pending.pop(0)
            if name in seen or name not in self.declarable:
                continue
            seen.append(name)
            self.declare(name)
            # A record's members carry types, and an ALIAS carries its referent instead — and the
            # referent is the half a prompt would otherwise lose: `file_read` is
            # `std::variant<text_file, image_file>`, so a model shown the alias and neither
            # alternative has been shown nothing at all.
            more = []
            for member in self.types[name]["members"]:
                if member["type"]:
                    referenced(member["type"], self.declarable, more)
            if self.declarable[name].get("kind") == "TypeAliasDecl":
                referenced(
                    (self.declarable[name].get("type") or {}).get("qualType", ""),
                    self.declarable,
                    more,
                )
            pending.extend(more)
        return seen

    def declare(self, name):
        """Record one type's declaration, once."""
        if name in self.types:
            return
        node = self.declarable[name]
        rendered, members = declaration_of(node, name)
        self.types[name] = {
            "name": name,
            "declaration": rendered,
            "doc": self.docs.described(node, f"the type `{name}`"),
            "members": [
                {
                    "name": member.get("name"),
                    "type": member_type(member, name),
                    "doc": self.docs.described(
                        member, f"`{name}::{member.get('name')}`"
                    ),
                }
                for member in members
            ],
        }

    # -- the whole document ----------------------------------------------------------------------

    def objects_section(self):
        """Each API object's one-line description: the first paragraph of its namespace's `///`."""
        out = []
        for name in catalogue.OBJECTS:
            block = next(
                child
                for child in self.children
                if child.get("kind") == "NamespaceDecl"
                and child.get("name") == name
                and comment_of(child) is not None
            )
            described = self.docs.described(block, f"the API object `{name}`")
            out.append({"object": name, "doc": described.split("\n\n")[0].strip()})
        return out

    def meta_section(self):
        """The `list` every object carries, documented once and declared twelve times."""
        namespace, function = catalogue.META_DOC_HOME
        home = next(
            child
            for child in self.objects.get(namespace, [])
            if child.get("name") == function
        )
        prose = with_tail(
            self.docs.described(home, f"`{namespace}::{function}`"), comment_of(home)
        )
        shapes = {}
        for object_ in catalogue.OBJECTS:
            node = self.overloads(object_, "list")[0]
            rendered, _, _ = signature_of(node, "list")
            shapes.setdefault(rendered, []).append(object_)
        if len(shapes) != 1:
            raise Failure(
                "the twelve `list()` declarations are not one function: " + repr(shapes)
            )
        rendered = next(iter(shapes))
        names = []
        referenced(rendered, self.declarable, names)
        return [
            {
                "key": "list",
                "name": "list",
                "signatures": [{"signature": rendered, "parameters": []}],
                "doc": prose,
                "types": [name for name in self.close_over(names) if name in self.types],
            }
        ]

    def unclaimed(self):
        """Every function an API object declares that `catalogue.py` names nowhere.

        The direction that is easy to forget: a function added to the SDK and not to the identity
        table is a call a model can make and gg has never heard of.
        """
        claimed = {(spec["object"], spec["name"]) for spec in catalogue.ENTRIES}
        claimed |= {(object_, "list") for object_ in catalogue.OBJECTS}
        out = []
        for object_ in catalogue.OBJECTS:
            for child in self.objects[object_]:
                if child.get("kind") != "FunctionDecl":
                    continue
                if (object_, child["name"]) not in claimed:
                    out.append(f'{object_}::{child["name"]}')
        return sorted(set(out))

    def build(self, libraries):
        stray = self.unclaimed()
        if stray:
            raise Failure(
                f"the SDK declares functions the identity table names nowhere: {stray}"
            )
        sections = {"session": [], "views": [], "programs": [], "tools": [], "helpers": []}
        for spec in catalogue.ENTRIES:
            entry = self.entry(spec)
            if spec["section"] == "tools":
                entry = {"tool": spec["key"], **entry}
            else:
                entry = {"key": spec["key"], **entry}
            if spec["section"] in ("views", "helpers"):
                entry["requires"] = spec["gate"]
            if spec["ending"]:
                entry["ending"] = spec["ending"]
            sections[spec["section"]].append(entry)
        meta = self.meta_section()
        return {
            "language": "cpp",
            "generatedFrom": GENERATED_FROM,
            "libraries": libraries,
            "objects": self.objects_section(),
            "meta": meta,
            "session": sections["session"],
            "views": sections["views"],
            "programs": sections["programs"],
            "tools": sections["tools"],
            "helpers": sections["helpers"],
            "types": [self.types[name] for name in sorted(self.types)],
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
        f"wrote {out}: {len(catalogued['tools'])} tools, {len(catalogued['types'])} types, "
        f"{sum(len(group['modules']) for group in catalogued['libraries'])} headers"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

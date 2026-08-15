#!/usr/bin/env python3
"""Reflect the **Rust** program language's signature catalogue out of the SDK's own rustdoc, and
write it to the ``rust.signatures.json`` the caller names.

WHERE IT GOES. The destination is an argument, given by ``signatures.sh`` out of
``GG_SIGNATURES_OUT_DIR``, and nothing here has a default: the catalogue is a build artifact that
``crates/gg/build.rs`` generates into the build's own ``OUT_DIR``, and it is committed nowhere.

WHY RUSTDOC JSON. Everything a model reads about this surface is written on the declaration it
describes — a function's brief and detail in its ``///`` comment, an argument's in that comment's
``# Arguments`` list, a struct field's on the field, an enum variant's on the variant, a module's in
the first line of its ``//!`` — and ``rustdoc``'s own JSON output is what reads all of it, together
with the *types*, which it has already resolved to the declarations they name. Nothing here is prose
typed into a table.

WHY THE OPERATION ID IS AN ATTRIBUTE. gg's identity for a call — that ``files::read_file`` **is**
gg's ``files.read_file`` operation, the same capability Java spells ``Workspace#readFile`` — is the
one thing Rust's own syntax cannot say. It is written on the declaration all the same, as
``#[doc(alias = "ggop:files.read_file")]``, which is a real attribute the compiler checks and
``rustdoc`` reports structurally. An attribute rather than a line of prose because prose is
model-facing and this is not; on the declaration rather than in ``catalogue.py`` because a side table
naming every function twice is the second copy that drifts.

WHY ``# Arguments`` RATHER THAN A PER-PARAMETER SLOT. Rust has no per-parameter doc comment: ``///``
written on a parameter is a compile error, not a doc. So the language's own convention stands in for
one, and this reflector holds it to being a real contract rather than a habit: a signature that takes
*N* arguments must document *N*, in order, under their own names, or the reflection fails. The
failure lands on the author rather than on a model.

WHAT IT IS NOT ALLOWED TO DO. Invent a word. Every string in the emitted JSON is either an identity
written on a declaration or text lifted out of a doc comment. A blank anywhere is an error.

Usage (through ``signatures.sh``, which builds the doc JSON first):

    signatures.py <rustdoc.json> <Cargo.toml> <out.json>
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
GENERATED_FROM = "packages/gg-sandbox-rust/src/ (rustdoc --output-format json)"

#: The types every call's failure arm refers to, closed over on every entry because every function in
#: this SDK returns ``Result<_, ToolError>`` — including the two that cannot fail, whose signature
#: says so.
ALWAYS_REFERENCED = ("ToolError", "ToolErrorCode")

#: The prefix a declaration's ``#[doc(alias = …)]`` carries to name the gg operation it binds.
OPERATION_ALIAS = "ggop:"

#: The prefix a declaration carries when it is a **second** way to reach an operation some other
#: declaration in this SDK binds canonically.
ALIAS_ALIAS = "ggop-alias:"

#: The prefix a ``pub mod`` carries to name which of gg's cross-arm modules it is.
MODULE_ALIAS = "ggmodule:"

#: The longest a brief may be, in characters.
#:
#: The same cap ``crates/gg/src/sandbox/language/register.rs`` holds every arm's catalogue to, and it
#: is enforced here as well because the host's copy is a ``#[test]``: a reflection that embedded a
#: paragraph in the brief field would succeed, and so would a build, and the author would hear about
#: it from a gate three steps away naming an entry they then have to go looking for. Here is where
#: the author is standing.
#:
#: It carries more weight on this arm than on most, because :func:`unwrapped` runs first: a ``///``
#: comment whose opening paragraph is three sentences over four wrapped lines arrives at
#: :func:`split` as ONE line, so the shape check below it cannot see it and this length is the only
#: thing that can.
BRIEF_CAP = 120

#: How ``rustdoc`` renders an attribute it has nothing structured to say about — the shape every
#: ``#[doc(alias = …)]`` arrives in.
_ATTRIBUTE = re.compile(r'^#\[doc\(alias = "(.*)"\)\]$')


class Failure(Exception):
    """Something a model would have read is missing, or says something the code does not."""


# ------------------------------------------------------------------------------------------------
# The doc JSON
# ------------------------------------------------------------------------------------------------


class Docs:
    """One ``rustdoc --output-format json`` document, indexed the way this reflector walks it."""

    def __init__(self, document):
        self.index = document["index"]
        self.root = self.item(document["root"])

    def item(self, identifier):
        return self.index[str(identifier)]

    def module_items(self, module):
        return [self.item(child) for child in module["inner"]["module"]["items"]]

    def modules_of(self, module):
        """The public modules declared in `module`, in declaration order."""
        return [child for child in self.module_items(module) if "module" in child["inner"]]

    def functions_of(self, module):
        """The public functions declared in `module`, in declaration order."""
        return [
            child
            for child in self.module_items(module)
            if "function" in child["inner"] and child.get("visibility") == "public"
        ]

    def types_of(self, module):
        """The public struct and enum declarations of `module`, in declaration order."""
        return [
            child
            for child in self.module_items(module)
            if ("struct" in child["inner"] or "enum" in child["inner"])
            and child.get("visibility") == "public"
        ]


def aliases(item):
    """Every ``#[doc(alias = …)]`` written on `item`, in the order they were written."""
    found = []
    for attribute in item.get("attrs", []):
        rendered = attribute.get("other") if isinstance(attribute, dict) else attribute
        matched = _ATTRIBUTE.match(rendered or "")
        if matched:
            found.append(matched.group(1))
    return found


def tagged(item, prefix):
    """The one alias on `item` carrying `prefix`, or ``None``.

    Two of them would be two claims about one declaration, which is a defect rather than a choice, so
    it is refused here rather than resolved by picking the first.
    """
    found = [alias[len(prefix) :] for alias in aliases(item) if alias.startswith(prefix)]
    if len(found) > 1:
        raise Failure(f"`{item.get('name')}` carries {len(found)} `{prefix}` aliases")
    return found[0] if found else None


# ------------------------------------------------------------------------------------------------
# Documentation text
# ------------------------------------------------------------------------------------------------

#: A rustdoc intra-doc link, in the three shapes this SDK writes: ``[`X`](path)``, ``[`X`]`` and
#: ``[text](url)``. A model reads prose rather than rustdoc, and a link whose target is a Rust path
#: renders as a broken one, so the link is unwrapped and the text kept.
_LINKED_CODE = re.compile(r"\[`([^`]+)`\]\([^)]*\)")
_BARE_CODE_LINK = re.compile(r"\[`([^`]+)`\]")
_LINKED_TEXT = re.compile(r"\[([^\]]+)\]\([^)]*\)")

#: One entry of a ``# Arguments`` list: ``* `name` — what to put here``.
_ARGUMENT = re.compile(r"^\* `([A-Za-z0-9_]+)` — (.*)$")

#: A fenced code block opened with rustdoc's `ignore` attribute, which is metadata for the doctest
#: runner rather than anything a model should read.
_IGNORED_FENCE = re.compile(r"^```ignore$", re.MULTILINE)


def prose(text):
    """A doc comment as a model reads it: links unwrapped, fences plain, whitespace settled."""
    # `” ```ignore ”` is how a doc comment in this SDK says "do not compile this as a doctest": the
    # examples are program fragments, written against a scope only a real turn has. A model reads a
    # fenced block, not a rustdoc attribute, so the attribute comes off.
    text = _IGNORED_FENCE.sub("```", text)
    text = _LINKED_CODE.sub(r"`\1`", text)
    text = _BARE_CODE_LINK.sub(r"`\1`", text)
    text = _LINKED_TEXT.sub(r"\1", text)
    return unwrapped(text).strip()


def unwrapped(text):
    """A doc comment's paragraphs joined back into single lines.

    A `///` comment is wrapped to the source's line width, and those breaks are an artefact of
    reading Rust rather than anything a model should be shown: they turn one sentence into three
    lines in a documentation view and make a diff of the catalogue a diff of where the author's
    editor wrapped. Blank lines, list items and fenced blocks all survive — the first two because
    they are structure, the third because whitespace inside it is the code.

    It is also what makes the **brief** a single line without the author having to keep one inside
    the source's line width: the brief is the first paragraph, and a paragraph is one line by the
    time it leaves here.
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


def sections(docs):
    """A doc comment split into its body and its ``#`` sections, in order.

    Returns ``(body, {heading: text})``. A heading a doc does not carry is simply absent; the body is
    everything before the first one.
    """
    body = []
    found = {}
    heading = None
    current = []
    for line in docs.splitlines():
        if line.startswith("# ") and not line.startswith("# ` "):
            if heading is None:
                body = current
            else:
                found[heading] = current
            heading = line[2:].strip()
            current = []
        else:
            current.append(line)
    if heading is None:
        body = current
    else:
        found[heading] = current
    return "\n".join(body), {name: "\n".join(lines) for name, lines in found.items()}


def split(text, what):
    """One piece of settled prose as ``(brief, detail)``: the first paragraph, and the rest.

    Doxygen's implicit structure, which is the whole of the convention this SDK is written to. The
    brief is authored rather than derived — there is no "first sentence of" anywhere in this file —
    and the split is on the blank line the author put there, so a doc comment whose opening paragraph
    is really three sentences of narrative is never silently cut at a full stop.

    It fails on :data:`BRIEF_CAP` instead. The text reaching here has already been through
    :func:`unwrapped`, so such a paragraph is one long line by now and no shape check could tell it
    from a brief; its length can, and that is what this raises on — naming the declaration it was
    written on, which is what the author is looking at.
    """
    if not text:
        raise Failure(f"{what} has no documentation")
    brief, _, detail = text.partition("\n\n")
    brief = brief.strip()
    if len(brief) > BRIEF_CAP:
        raise Failure(
            f"{what} has a {len(brief)}-character brief, and a brief is capped at "
            f"{BRIEF_CAP}: {brief!r}"
        )
    return brief, (detail.strip() or None)


def documented(item, what):
    """An item's ``(brief, detail)``, with the ``# Arguments`` list left out of both.

    ``# Errors`` stays, folded into the detail: it is what a model needs in order to know which
    failures to expect, and it reads as part of the description rather than as metadata about the
    arguments.
    """
    docs = item.get("docs") or ""
    body, found = sections(docs)
    brief, detail = split(prose(body), what)
    parts = [detail] if detail else []
    for heading, text in found.items():
        if heading == "Arguments":
            continue
        parts.append("# " + heading + "\n\n" + prose(text))
    return brief, ("\n\n".join(part for part in parts if part) or None)


def documented_arguments(item, what):
    """The ``# Arguments`` list of a doc comment, as ``[(name, description)]``."""
    _, found = sections(item.get("docs") or "")
    if "Arguments" not in found:
        return []
    arguments = []
    for line in found["Arguments"].splitlines():
        matched = _ARGUMENT.match(line.strip()) if line.startswith("* ") else None
        if matched:
            arguments.append([matched.group(1), matched.group(2).strip()])
        elif line.strip() and arguments:
            # A continuation line of the entry above it, which is how a long description is wrapped.
            arguments[-1][1] += " " + line.strip()
        elif line.strip():
            raise Failure(f"{what}: `# Arguments` carries a line that is not an argument: {line!r}")
    return [(name, prose(description)) for name, description in arguments]


# ------------------------------------------------------------------------------------------------
# The reflection
# ------------------------------------------------------------------------------------------------


class Declared:
    """One type this SDK declares, and the two names it answers to.

    ``fqn`` is the key a documentation view is opened by and the string a program could write in
    full; ``spelled`` is what a signature writes, which is the module-qualified form under
    ``gg::prelude`` — `files::FileRead` rather than a bare `FileRead`, because the prelude re-exports
    the modules and not the types inside them, and a bare name would be a spelling that does not
    resolve.
    """

    def __init__(self, identifier, module, item):
        self.id = identifier
        self.module = module
        self.item = item
        self.name = item["name"]
        self.fqn = f"{module.path}::{self.name}"
        # The `core` types are the exception the prelude makes, so they are written bare.
        self.spelled = self.name if module.id == "core" else f"{module.name}::{self.name}"


class Reflector:
    def __init__(self, docs):
        self.docs = docs
        self.modules = {}
        self.declared = {}
        self.types = {}
        self.member_functions = {}
        self._always = None
        self.collect()

    def collect(self):
        """Index the crate: its capability modules, and every type they declare.

        A type is catalogued exactly when a **catalogued module declares it**, which is what makes
        every fully-qualified name in this artifact a real Rust path. It is also what keeps the
        generated `bindings` module out: it declares a `ToolError` and a `FileRead` of its own — the
        wire's, with the WIT's documentation — and a catalogue that picked those up would describe
        the membrane to a model instead of the SDK.
        """
        by_name = {module.name: module for module in catalogue.MODULES}
        seen = {}
        for item in self.docs.modules_of(self.docs.root):
            id_ = tagged(item, MODULE_ALIAS)
            if id_ is None:
                continue
            if id_ in seen:
                raise Failure(f"two modules claim gg's `{id_}` module")
            seen[id_] = item["name"]
            module = by_name.get(item["name"])
            if module is None or module.id != id_:
                raise Failure(
                    f"`{item['name']}` declares itself gg's `{id_}` module, which `catalogue.py` "
                    "does not name it — the table and the declarations must agree in both "
                    "directions"
                )
            self.modules[module.id] = item

        missing = [module.id for module in catalogue.MODULES if module.id not in self.modules]
        if missing:
            raise Failure(
                f"`catalogue.py` names modules no `pub mod` declares itself to be: {missing}"
            )

        for module in catalogue.MODULES:
            for item in self.docs.types_of(self.modules[module.id]):
                self.declared[item["id"]] = Declared(item["id"], module, item)

    # -- types -----------------------------------------------------------------------------------

    def render_type(self, node):
        """One rustdoc type node, written the way a program writes it.

        A path this crate declares is written **module-qualified**, because that is the spelling the
        prelude leaves resolvable and the one a model can copy out of a signature; anything else —
        `Option`, `Vec`, `Result`, `String`, `RangeInclusive` — is written by its last segment,
        which is Rust's own and is already in every program's scope.
        """
        if node is None:
            return "()"
        if "primitive" in node:
            return node["primitive"]
        if "borrowed_ref" in node:
            reference = node["borrowed_ref"]
            lifetime = f"{reference['lifetime']} " if reference.get("lifetime") else ""
            mutable = "mut " if reference.get("is_mutable") else ""
            return f"&{lifetime}{mutable}{self.render_type(reference['type'])}"
        if "slice" in node:
            return f"[{self.render_type(node['slice'])}]"
        if "array" in node:
            return f"[{self.render_type(node['array']['type'])}; {node['array']['len']}]"
        if "tuple" in node:
            return "(" + ", ".join(self.render_type(part) for part in node["tuple"]) + ")"
        if "generic" in node:
            return node["generic"]
        if "resolved_path" in node:
            path = node["resolved_path"]
            declared = self.declared.get(path.get("id"))
            written = declared.spelled if declared else path["path"].rsplit("::", 1)[-1]
            return written + self.render_arguments(path.get("args"))
        raise Failure(f"a type this reflector cannot render: {json.dumps(node)[:200]}")

    def render_arguments(self, args):
        """The generic arguments of a path, including the elided lifetime a borrowed type carries."""
        if not args or "angle_bracketed" not in args:
            return ""
        bracketed = args["angle_bracketed"]
        rendered = []
        for argument in bracketed.get("args", []):
            if "type" in argument:
                rendered.append(self.render_type(argument["type"]))
            elif "lifetime" in argument:
                rendered.append(argument["lifetime"])
        return "<" + ", ".join(rendered) + ">" if rendered else ""

    def referenced(self, node, out):
        """Every declared type a node mentions, by rustdoc id, in the order it mentions them."""
        if node is None:
            return
        if "borrowed_ref" in node:
            self.referenced(node["borrowed_ref"]["type"], out)
        elif "slice" in node:
            self.referenced(node["slice"], out)
        elif "array" in node:
            self.referenced(node["array"]["type"], out)
        elif "tuple" in node:
            for part in node["tuple"]:
                self.referenced(part, out)
        elif "resolved_path" in node:
            path = node["resolved_path"]
            if path.get("id") in self.declared:
                out.append(path["id"])
            args = path.get("args")
            if args and "angle_bracketed" in args:
                for argument in args["angle_bracketed"].get("args", []):
                    if "type" in argument:
                        self.referenced(argument["type"], out)

    def returned(self, node, out):
        """The declared types a return position **hands back**, by rustdoc id.

        Every function here returns `Result<T, ToolError>`, and only `T` is a value the program
        receives: the error arm is the failure channel, which is `ToolError` on every call and is the
        same one type an exception-throwing arm never lists as a return. So a `Result` this crate did
        not declare is descended into by its first argument alone, and everything else is walked
        whole.
        """
        if node is None:
            return
        path = node.get("resolved_path") if isinstance(node, dict) else None
        if (
            path
            and path.get("id") not in self.declared
            and path["path"].rsplit("::", 1)[-1] == "Result"
        ):
            args = (path.get("args") or {}).get("angle_bracketed", {}).get("args", [])
            if args and "type" in args[0]:
                self.returned(args[0]["type"], out)
            return
        self.referenced(node, out)

    def declare(self, identifier):
        """Record one type's declaration, once, and hand back the ids its members mention."""
        if identifier in self.types:
            return self.types[identifier]["referenced"]
        declared = self.declared[identifier]
        item = declared.item
        header = generic_header(item)
        members = []
        referenced = []
        if "struct" in item["inner"]:
            kind = item["inner"]["struct"]["kind"]
            if "plain" not in kind:
                raise Failure(
                    f"`{declared.fqn}` is not a plain struct, which this catalogue cannot render"
                )
            fields = []
            for field_id in kind["plain"]["fields"]:
                field = self.docs.item(field_id)
                rendered = self.render_type(field["inner"]["struct_field"])
                self.referenced(field["inner"]["struct_field"], referenced)
                fields.append(f"{field['name']}: {rendered}")
                members.append(
                    self.member(field, "field", rendered, f"`{declared.fqn}::{field['name']}`")
                )
            declaration = f"struct {declared.name}{header} {{ " + ", ".join(fields) + " }"
        elif "enum" in item["inner"]:
            arms = []
            for variant_id in item["inner"]["enum"]["variants"]:
                variant = self.docs.item(variant_id)
                kind = variant["inner"]["variant"]["kind"]
                carried = None
                if isinstance(kind, dict) and "tuple" in kind:
                    parts = []
                    for field_id in kind["tuple"]:
                        if field_id is None:
                            continue
                        node = self.docs.item(field_id)["inner"]["struct_field"]
                        parts.append(self.render_type(node))
                        self.referenced(node, referenced)
                    carried = ", ".join(parts)
                arms.append(f"{variant['name']}({carried})" if carried else variant["name"])
                members.append(
                    self.member(
                        variant,
                        "variant",
                        carried,
                        f"`{declared.fqn}::{variant['name']}`",
                    )
                )
            declaration = f"enum {declared.name}{header} {{ " + ", ".join(arms) + " }"
        else:
            raise Failure(f"`{declared.fqn}` is neither a struct nor an enum")

        brief, detail = documented(item, f"the type `{declared.fqn}`")
        self.types[identifier] = {
            "fqn": declared.fqn,
            "module": declared.module.id,
            "name": declared.name,
            "declaration": declaration,
            "brief": brief,
            "detail": detail,
            "members": members,
            "memberFunctions": self.member_functions.get(identifier, []),
            "referenced": referenced,
        }
        return referenced

    def member(self, item, kind, rendered, what):
        """One field or variant, with the documentation written on it."""
        brief, detail = documented(item, what)
        return {
            "name": item["name"],
            "type": rendered,
            "kind": kind,
            "brief": brief,
            "detail": detail,
        }

    def close_over(self, ids):
        """The declared types a signature mentions, transitively closed, in first-mention order.

        Transitive because the list answers *which declarations does this run's surface reach*, which
        is what decides whether a type may be opened at all. What a documentation view opens beside a
        function is a **depth-one** question gg answers for itself from `returns` and the signature
        text, so widening here costs nothing there.
        """
        pending = list(ids)
        seen = []
        while pending:
            identifier = pending.pop(0)
            if identifier in seen or identifier not in self.declared:
                continue
            seen.append(identifier)
            pending.extend(self.declare(identifier))
        return seen

    def references(self, ids):
        """A list of ids, as the resolved type references the catalogue carries."""
        out = []
        for identifier in ids:
            declared = self.declared[identifier]
            out.append({"spelled": declared.spelled, "fqn": declared.fqn})
        return out

    def always_referenced(self):
        """The ids of the types every failure arm names, looked up rather than written down."""
        if self._always is not None:
            return self._always
        found = []
        for name in ALWAYS_REFERENCED:
            matched = [
                identifier
                for identifier, declared in self.declared.items()
                if declared.name == name
            ]
            if len(matched) != 1:
                raise Failure(f"`{name}` is declared {len(matched)} times, and must be declared once")
            found.append(matched[0])
        self._always = found
        return found

    # -- functions -------------------------------------------------------------------------------

    def signature(self, item, name, what):
        """One function's single calling shape, and the arguments it documents.

        Rust has no overloads, so an entry always carries exactly one shape — where Java's carries
        one per overload and Ruby's one per block form. The count is spelling; nothing downstream
        compares it.
        """
        sig = item["inner"]["function"]["sig"]
        arguments = documented_arguments(item, what)
        rendered = [
            (argument, self.render_type(node))
            for argument, node in sig["inputs"]
            if argument != "self"
        ]
        if len(arguments) != len(rendered):
            raise Failure(
                f"{what} takes {len(rendered)} arguments and documents {len(arguments)} — Rust has "
                "no per-parameter doc slot, so every one of them must appear in the `# Arguments` "
                "list of the function's own comment, in order"
            )
        parameters = []
        for (documented_name, description), (argument, kind) in zip(arguments, rendered):
            if documented_name != argument:
                raise Failure(
                    f"{what} documents `{documented_name}` where its signature takes `{argument}` — "
                    "a renamed argument left behind in the documentation tells a model to write "
                    "something the call will not accept"
                )
            if not description:
                raise Failure(f"{what}'s `{argument}` has no description")
            parameters.append(
                {
                    "name": argument,
                    "type": kind,
                    # Nothing in a Rust call may be left out: there are no default arguments and no
                    # keyword arguments, so `read_file(path)` is not a call this SDK offers. An
                    # argument a program may say nothing *about* says so in its TYPE — `Option<f64>`,
                    # or an options struct with a `Default` — which is where a Rust author looks.
                    "optional": False,
                    "kind": "positional",
                    "default": None,
                    "doc": description,
                    # Always empty: every structured argument here is typed by NAME, and that type is
                    # catalogued with its own documented members. Filling both would be two copies of
                    # one sentence with nothing keeping them equal.
                    "fields": [],
                }
            )
        arguments_text = ", ".join(f"{argument}: {kind}" for argument, kind in rendered)
        output = sig.get("output")
        returns = f" -> {self.render_type(output)}" if output is not None else ""
        return {
            "signature": f"{name}({arguments_text}){returns}",
            "parameters": parameters,
        }, sig

    def entry(self, item, module, operation, alias_of, receiver=None):
        """One catalogued call, whatever kind of declaration the SDK made of it."""
        name = item["name"]
        fqn = (
            f"{module.path}::{receiver}::{name}"
            if receiver is not None
            else f"{module.path}::{name}"
        )
        what = f"`{fqn}`"
        shape, sig = self.signature(item, name, what)
        argument_ids = []
        for argument, node in sig["inputs"]:
            if argument != "self":
                self.referenced(node, argument_ids)
        returned_ids = []
        self.returned(sig.get("output"), returned_ids)
        brief, detail = documented(item, what)
        return {
            "operation": operation,
            "aliasOf": alias_of,
            "module": module.id,
            "kind": "method" if receiver is not None else "function",
            "receiver": receiver,
            "name": name,
            "fqn": fqn,
            # `null`, because on this arm the fully-qualified name IS what a program writes: the
            # prelude puts every module in scope, so `files::read_file` and `gg::files::read_file`
            # are the same path written short and long.
            "call": None,
            "brief": brief,
            "detail": detail,
            "signatures": [shape],
            # The closure runs first, because it is what records the declarations both lists then
            # name; `returns` itself is the DIRECT return position and nothing beyond it, since what
            # it feeds is a one-level rule.
            "types": self.references(
                self.close_over(argument_ids + returned_ids + self.always_referenced())
            ),
            "returns": self.references(deduped(returned_ids)),
        }

    def functions_and_members(self):
        """Every catalogued call, module by module, with the member functions collected beside them.

        The member walk runs **after** the module walk and over the declared types rather than out of
        the type renderer, deliberately: a member function is a real declaration with its own
        operation id, its own signature and its own documentation, and a renderer that listed a
        type's methods from the type would emit entries nobody had written an id on. The one this SDK
        has is `delegation::SubagentHandle::send`.
        """
        functions = []
        for module in catalogue.MODULES:
            item = self.modules[module.id]
            for declaration in self.docs.functions_of(item):
                name = declaration["name"]
                operation = tagged(declaration, OPERATION_ALIAS)
                alias_of = tagged(declaration, ALIAS_ALIAS)
                if operation is None and alias_of is None:
                    raise Failure(
                        f"`{module.path}::{name}` is public and names no gg operation, so a model "
                        f'would never be told it exists — write `#[doc(alias = "{OPERATION_ALIAS}'
                        '<namespace>.<key>")]` on it'
                    )
                if operation is not None and alias_of is not None:
                    raise Failure(f"`{module.path}::{name}` is both an operation and an alias of one")
                functions.append(
                    self.entry(declaration, module, operation or alias_of, alias_of)
                )

        # The members, over the types the modules declare. Each one is emitted twice on purpose:
        # once as a catalogued call, because it is one, and once as a line on its receiver's own
        # documentation view, which is the menu a model reads when it opens the type.
        for identifier, declared in self.declared.items():
            for method in self.methods_of(declared):
                operation = tagged(method, OPERATION_ALIAS)
                alias_of = tagged(method, ALIAS_ALIAS)
                if operation is None and alias_of is None:
                    # A public method that binds no gg operation — an accessor such as
                    # `ToolErrorCode::as_str` — is documentation for a Rust reader rather than a
                    # capability, so it is not catalogued and nothing here has to invent an id for
                    # it. The both-directions check above is on the MODULE functions, where a
                    # forgotten declaration would be a forgotten capability.
                    continue
                entry = self.entry(
                    method, declared.module, operation or alias_of, alias_of, declared.name
                )
                functions.append(entry)
                self.member_functions.setdefault(identifier, []).append(
                    {
                        "operation": entry["operation"],
                        "name": entry["name"],
                        "fqn": entry["fqn"],
                        "brief": entry["brief"],
                    }
                )
        return functions

    def methods_of(self, declared):
        """The public methods of a type's own `impl` blocks, in declaration order.

        Inherent blocks only: a trait implementation is the trait's surface rather than this one's,
        and `Display` on an error is not a capability a run withholds.
        """
        inner = declared.item["inner"]
        body = inner.get("struct") or inner.get("enum") or {}
        out = []
        for impl_id in body.get("impls", []):
            block = self.docs.item(impl_id)["inner"]["impl"]
            if block.get("trait") is not None:
                continue
            for member_id in block.get("items", []):
                member = self.docs.item(member_id)
                if "function" in member["inner"] and member.get("visibility") == "public":
                    out.append(member)
        return out

    # -- the whole document ----------------------------------------------------------------------

    def modules_section(self):
        """Each module's own brief and detail: the first paragraph of its `//!`, and the rest."""
        out = []
        for module in catalogue.MODULES:
            brief, detail = documented(self.modules[module.id], f"the `{module.path}` module")
            out.append(
                {
                    "id": module.id,
                    "path": module.path,
                    "brief": brief,
                    "detail": detail,
                    # `null`, and truthfully: gg writes `use gg::prelude::*;` into the entry file
                    # itself, so there is no import line a program would be right to write.
                    "import": None,
                }
            )
        return out

    def build(self, libraries):
        functions = self.functions_and_members()
        # The member functions are folded into their receivers by the walk above, so the type
        # declarations are finished last — after every entry that could add a line to one.
        for identifier in list(self.types):
            self.types[identifier]["memberFunctions"] = self.member_functions.get(identifier, [])
        return {
            "schema": SCHEMA,
            "language": "rust",
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


def deduped(ids):
    """`ids` with every repeat dropped, in first-mention order."""
    out = []
    for identifier in ids:
        if identifier not in out:
            out.append(identifier)
    return out


def generic_header(item):
    """The lifetime and type parameters a declaration is written with — ``<'a>``, or nothing."""
    inner = item["inner"].get("struct") or item["inner"].get("enum") or {}
    params = inner.get("generics", {}).get("params", [])
    named = [param["name"] for param in params]
    return "<" + ", ".join(named) + ">" if named else ""


# ------------------------------------------------------------------------------------------------
# The library set
# ------------------------------------------------------------------------------------------------


def libraries_of(manifest):
    """The libraries a program may reach for, grouped as ``Cargo.toml`` groups them.

    Two sources, one file. The third-party crates are the dependencies declared under a
    ``# --- heading ---`` in ``[dependencies]``, which is the same marker ``build.sh`` reads to decide
    which crates get an ``--extern`` — so what a model is told it may use and what the compile lets it
    name are one declaration. The standard library's group is the ``standard-library`` list under
    ``[package.metadata.gg]``, which is a pointer list rather than a set: ``std`` is not a dependency
    and nothing in this repository decides what is in it.
    """
    groups = []
    section = None
    heading = None
    standard = []
    for line in manifest.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            section = stripped
            continue
        if section == "[dependencies]":
            if stripped.startswith("# --- "):
                heading = stripped.removeprefix("# --- ").removesuffix(" ---").strip()
                groups.append({"group": heading, "modules": []})
            elif heading and re.match(r"^[A-Za-z0-9_-]+ *=", stripped):
                groups[-1]["modules"].append(stripped.split("=")[0].strip().replace("-", "_"))
        elif section == "[package.metadata.gg]":
            found = re.match(r'^"([^"]+)",?$', stripped)
            if found:
                standard.append(found.group(1))
    if not groups or any(not group["modules"] for group in groups):
        raise Failure("`[dependencies]` declares a `# --- heading ---` with nothing under it")
    if not standard:
        raise Failure("`[package.metadata.gg]` declares no `standard-library` list")
    # Last, because it is the group a model needs to be told about least and the one that is longest.
    groups.append({"group": "The standard library, always in scope", "modules": standard})
    return groups


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    document, manifest, out = (Path(argument) for argument in sys.argv[1:])
    docs = Docs(json.loads(document.read_text()))
    catalogued = Reflector(docs).build(libraries_of(manifest))
    out.write_text(json.dumps(catalogued, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    try:
        main()
    except Failure as failure:
        raise SystemExit(f"error: {failure}")

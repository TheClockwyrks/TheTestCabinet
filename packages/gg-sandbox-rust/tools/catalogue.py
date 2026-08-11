"""The one thing this arm's SOURCES cannot say: which modules the surface is divided into, and in
what order a reader meets them.

Everything else that used to live here is gone. A function's gg operation id is now written on the
declaration it belongs to, as a ``#[doc(alias = "ggop:…")]`` on that declaration, and a module's gg
id as a ``#[doc(alias = "ggmodule:…")]`` on its own ``pub mod``. A side table naming every function
twice was precisely the second copy that drifts, and it does not exist any more.

What is left is a table of twelve module identities, and it is here rather than in ``src/`` for two
reasons: the ORDER is model-facing — it is the sequence a documentation index and the run's agent
surface present the modules in — and the PATH is the string gg matches a fully-qualified name's
prefix against, so a module that misspelled its own path would be reporting names nothing could
open. Each module's own ``ggmodule`` alias says which of these rows it is, and ``signatures.py``
asserts the two sets are equal in both directions.
"""


class Module:
    """One module's identity: gg's cross-arm id for it, and how Rust spells it."""

    def __init__(self, id, name, path):
        #: gg's language-independent module id, and the namespace its operations are written under.
        self.id = id
        #: The Rust module's own name, as ``src/`` declares it.
        self.name = name
        #: The path a program writes, and the prefix every name in this module is qualified by.
        self.path = path


# The modules the surface is divided into, IN THE ORDER IT IS PRESENTED IN.
#
# It runs from the modules almost every run has to the ones a particular shape of agent has, because
# a model reads a list from the top. `core` is last and deliberately: it declares no function at all,
# only the two error types and the summary every other module's signatures name.
MODULES = [
    Module("files", "files", "gg::files"),
    Module("shell", "shell", "gg::shell"),
    Module("board", "board", "gg::board"),
    Module("tasks", "tasks", "gg::tasks"),
    Module("memories", "memories", "gg::memories"),
    Module("views", "views", "gg::views"),
    Module("context", "context", "gg::context"),
    Module("delegation", "delegation", "gg::delegation"),
    Module("skills", "skills", "gg::skills"),
    Module("programs", "programs", "gg::programs"),
    Module("session", "session", "gg::session"),
    Module("core", "core", "gg::core"),
]

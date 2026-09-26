"""The one thing this arm's SOURCES cannot say: which modules the surface is divided into, and in
what order a reader meets them.

Everything else that used to live here is gone. A function's gg operation id is now written on the
declaration it belongs to, as a ``- ggop: …`` line in that declaration's own doc comment, and a
module's gg id as a ``- ggmodule: …`` line in its own. A side table naming every function twice was
precisely the second copy that drifts, and it does not exist any more.

What is left is a table of thirteen module identities, and it is here rather than in ``Sources/`` for
two reasons: the ORDER is model-facing — it is the sequence a documentation index and the run's agent
surface present the modules in — and the PATH is the string gg matches a fully-qualified name's
prefix against, so a module that misspelled its own path would be reporting names nothing could open.
Each module's own ``ggmodule`` line says which of these rows it is, and ``signatures.py`` asserts the
two agree.
"""


class Module:
    """One module's identity: gg's cross-arm id for it, and how Swift spells it."""

    def __init__(self, id, path):
        #: gg's language-independent module id, and the namespace its operations are written under.
        self.id = id
        #: The path a program writes, and the prefix every name in this module is qualified by.
        #:
        #: `gg` is the Swift module the SDK is compiled into and the namespace enum's name is the
        #: gg module id, so the two together are a real Swift path: `gg.files.readFile(…)` compiles,
        #: and — unlike the short `files.readFile(…)` — it keeps compiling in a program that
        #: declared a `files` of its own.
        self.path = path

    @property
    def name(self):
        """The Swift namespace enum's own name, which is gg's module id unchanged.

        A caseless `enum` is Swift's own namespace, and a lowercase type name is a deliberate
        departure from the language's UpperCamelCase convention: a module's name is gg's IDENTITY,
        on the wire and in the console's grouping, and no arm may respell it.
        """
        return self.id


# The modules the surface is divided into, IN THE ORDER IT IS PRESENTED IN.
#
# It runs from the modules almost every run has to the ones a particular shape of agent has, because
# a model reads a list from the top. `core` is last and deliberately: it declares no function at all,
# only the two error types, the three-way edit and the summary every other module's signatures name.
MODULES = [
    Module("files", "gg.files"),
    Module("shell", "gg.shell"),
    Module("board", "gg.board"),
    Module("tasks", "gg.tasks"),
    Module("memories", "gg.memories"),
    Module("views", "gg.views"),
    Module("docs", "gg.docs"),
    Module("context", "gg.context"),
    Module("delegation", "gg.delegation"),
    Module("skills", "gg.skills"),
    Module("programs", "gg.programs"),
    Module("session", "gg.session"),
    Module("core", "gg.core"),
]

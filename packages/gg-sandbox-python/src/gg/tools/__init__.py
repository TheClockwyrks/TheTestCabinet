"""The gg tool families, one module per interface of the membrane.

Each module holds the functions of one family, written the way Python writes functions: required
arguments positional, optional ones as keyword arguments with real defaults, results as frozen
dataclasses, fixed choices as enums, and a failure as a raised `gg.errors.ToolError`. The
generated bindings underneath are a mechanical lowering nobody reads; these are the whole of what a
model sees.

The two families that are **not** tools live here too, because they are grouped by the object a
program reaches them through rather than by what gates them: `gg.tools.views` (the calls that
put material into the agent's own context window) and `gg.tools.programs` (the program
library). `gg.tools.docs` holds the directory function bound onto every object. None of the
three has a name in `ALL_TOOL_NAMES`, which is what keeps `gg.catalogue.TOOL_CATALOGUE` in
exact bijection with gg's tool vocabulary.
"""

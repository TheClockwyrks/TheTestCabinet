"""The context extension of the repository kit: every value a template derives from the three answers.

Copier records what it asks as answers, and `.copier-answers.yml` holds the
three the kit asks: `name`, `kind` and `description`. Everything else a
template needs, the crate, the workspace's dependencies, the pipeline's
resources and images, is derived from those three by the tables `render.py`
and the kit's edge table hold. It is derived here, in a context extension
`copier.yml` loads, rather than passed as data, because a derived value passed
as data would be recorded as an answer, and a hand edit to it there would be
silently overwritten by the next update.

Copier loads this file from the template checkout it renders, which for an
update is the superrepo at the commit the repository was last rendered from
and then at the commit being rendered, so `render.py` is loaded by path from
beside this file: the tables of the commit being rendered are the ones that
apply to it.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

from copier_template_extensions import ContextHook

RENDER = Path(__file__).resolve().with_name("render.py")


def _render_module():
    spec = importlib.util.spec_from_file_location("test_cabinet_kit_render", RENDER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CabinetContext(ContextHook):
    """Add the derived values to every render's context."""

    def __init__(self, environment) -> None:
        super().__init__(environment)
        self._render = _render_module()
        self._derived: dict[tuple[str, str, str], dict[str, object]] = {}

    def hook(self, context: dict[str, Any]) -> None:
        # The kinds the `kind` question offers, known before it is asked.
        context["project_kinds"] = json.dumps(self._render.kinds())
        # A question's own templates (its help, its validator) are rendered
        # before every answer is in; the derived values are for the files.
        if any(key not in context for key in ("name", "kind", "description")):
            return
        answers = (str(context["name"]), str(context["kind"]), str(context["description"]))
        if answers not in self._derived:
            self._derived[answers] = self._render.variables(*answers)
        context.update(self._derived[answers])

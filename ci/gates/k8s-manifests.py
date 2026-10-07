"""Render every Kubernetes overlay and assert what the deployment requires.

An overlay is what gets applied, so an overlay is what this checks. Rendering
each one catches a kustomization that no longer builds (a renamed file, a patch
whose target moved, a component that stopped resolving) before an apply against
a real cluster finds it. The assertions over the rendered YAML are the
properties the manifests are only correct if they hold:

  * no workload is reachable from outside the cluster network, which is no
    Service of type LoadBalancer and no nodePort anywhere;
  * every image resolves to a real name and a tag, because the base carries a
    `REPLACE_REGISTRY` placeholder an overlay is required to rewrite;
  * every container states its CPU and memory requests and a memory limit, so
    none is BestEffort and none can take a node's memory from its neighbours;
  * each overlay's objects sit in its own namespace, which is the base's
    namespace followed by the overlay's name, `<project>-local` for the local
    cluster's, except for the overlay the pipeline deploys, whose namespace is
    `DEPLOYED_NAMESPACE` below: `tcab-staging` for `staging` by the
    fleet's convention, which a project deploying elsewhere edits there.

The checks read kustomize's canonical output, whose indentation and key order
are fixed by the renderer rather than by the manifests' own formatting. That is
what makes reading it as text rather than through a YAML parser sound, and a
parser would be a dependency this project deliberately does not have.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from the_test_cabinet_ci import enter_repo_root, fail, run, say, skip

MANIFESTS = Path("deployments/k8s")
OVERLAYS = MANIFESTS / "overlays"
BASE_NAMESPACE = MANIFESTS / "base" / "namespace.yaml"

# The overlay the pipeline deploys and the namespace it deploys into,
# which is the one namespace not named for its overlay. deploy.sh waits on the
# rollouts in it, so an overlay placing its objects anywhere else is a deploy
# that waits on workloads it never applied.
DEPLOYED_OVERLAY = "staging"
DEPLOYED_NAMESPACE = "tcab-staging"

# What every container has to state: two requests, so the pod is never
# BestEffort, and a memory limit, so it cannot take a node's memory from its
# neighbours. CPU is deliberately not limited, which throttles rather than
# protects.
REQUIRED = ("requests.cpu", "requests.memory", "limits.memory")

# The kinds that live outside any namespace, which therefore name none.
CLUSTER_SCOPED = frozenset(
    {
        "ClusterRole",
        "ClusterRoleBinding",
        "CustomResourceDefinition",
        "PersistentVolume",
        "StorageClass",
        "PriorityClass",
        "IngressClass",
        "MutatingWebhookConfiguration",
        "ValidatingWebhookConfiguration",
    }
)

NODE_PORT = re.compile(r"^\s*-?\s*nodePort:")
IMAGE = re.compile(r"^\s*-?\s*image:\s*(.*)$")


def documents(rendered: str) -> list[list[str]]:
    """The rendered stream's documents, each as its lines.

    kustomize writes every document's top-level keys at column zero and
    separates documents with a `---` line of its own.
    """
    found: list[list[str]] = []
    current: list[str] = []
    for line in rendered.splitlines():
        if line.rstrip() == "---":
            found.append(current)
            current = []
        else:
            current.append(line.rstrip())
    found.append(current)
    return [document for document in found if any(line.strip() for line in document)]


def identify(document: list[str]) -> tuple[str, str, str]:
    """A document's kind, name and namespace, each "" when it states none."""
    kind = name = namespace = ""
    in_metadata = False
    for line in document:
        if not line.startswith((" ", "#")) and line:
            in_metadata = line == "metadata:"
            if line.startswith("kind: "):
                kind = line.removeprefix("kind: ").strip()
            continue
        if in_metadata and line.startswith("  name: "):
            name = line.removeprefix("  name: ").strip()
        elif in_metadata and line.startswith("  namespace: "):
            namespace = line.removeprefix("  namespace: ").strip()
    return kind, name, namespace


def containers_missing_resources(document: list[str]) -> list[str]:
    """Each container of the document that states less than REQUIRED.

    kustomize writes a sequence's items at the indent of the key that holds it,
    and each container's own keys two spaces further in, so a container is the
    run of lines from its `- ` line to the next line at or above that indent.
    """
    missing: list[str] = []
    list_indent = -1
    inside = False
    name = ""
    stated: set[str] = set()
    section = ""
    sub_section = ""

    def flush() -> None:
        nonlocal inside, name, stated, section, sub_section
        if inside:
            absent = [need for need in REQUIRED if need not in stated]
            if absent:
                missing.append(f"{name or '<unnamed>'} does not state: {' '.join(absent)}")
        inside = False
        name = ""
        stated = set()
        section = ""
        sub_section = ""

    for line in document:
        indent = len(line) - len(line.lstrip(" "))
        body = line[indent:]
        if (
            list_indent >= 0
            and body
            and (indent < list_indent or (indent == list_indent and not body.startswith("- ")))
        ):
            flush()
            list_indent = -1
        if body in ("containers:", "initContainers:"):
            flush()
            list_indent = indent
            continue
        if list_indent >= 0 and indent == list_indent and body.startswith("- "):
            flush()
            inside = True
            body = body[2:]
            indent += 2
        if not inside:
            continue
        if indent == list_indent + 2:
            section = body.split(":", 1)[0]
            sub_section = ""
            if body.startswith("name: "):
                name = body.removeprefix("name: ").strip()
        elif section == "resources" and indent == list_indent + 4:
            sub_section = body.split(":", 1)[0]
        elif section == "resources" and indent == list_indent + 6:
            key = body.split(":", 1)[0]
            if f"{sub_section}.{key}" in REQUIRED:
                stated.add(f"{sub_section}.{key}")
    flush()
    return missing


root = enter_repo_root()

if shutil.which("kubectl") is None:
    # The one gate that skips rather than fails when its tool is absent: it is
    # the only check here that needs a tool the language toolchains do not
    # bring, and .devcontainer/tools/k8s.sh is what installs it.
    skip("k8s-manifests: skipped, kubectl is absent (the devcontainer installs it)")

if not (root / OVERLAYS).is_dir():
    skip(f"k8s-manifests: skipped, there is no {OVERLAYS}")

# The project's own namespace, which the base names and every overlay but the
# deployed one suffixes with its own name.
project_namespace = ""
for document in documents((root / BASE_NAMESPACE).read_text(encoding="utf-8")):
    kind, name, _ = identify(document)
    if kind == "Namespace":
        project_namespace = name
        break
if not project_namespace:
    fail(f"{BASE_NAMESPACE} names no Namespace")

failures = 0


def report(overlay: Path, what: str) -> None:
    """Report one failed assertion, naming what it was checked against."""
    global failures
    say(f"{overlay}: {what}", err=True)
    failures += 1


overlays = sorted(path for path in (root / OVERLAYS).glob("*") if path.is_dir())
if not overlays:
    fail(f"k8s-manifests: no overlays under {OVERLAYS}; there is nothing to render")

for overlay in overlays:
    named = overlay.relative_to(root)
    # kustomize says on stderr what is wrong with an overlay that does not
    # build, and that is the whole of what such an overlay has to show.
    rendered = run(["kubectl", "kustomize", overlay], capture=True)
    if rendered.returncode != 0:
        report(named, "does not build")
        continue

    expected = DEPLOYED_NAMESPACE if overlay.name == DEPLOYED_OVERLAY else f"{project_namespace}-{overlay.name}"
    for document in documents(rendered.stdout):
        kind, name, namespace = identify(document)
        if kind == "Service" and any(line == "  type: LoadBalancer" for line in document):
            report(named, f"the Service {name} is of type LoadBalancer")
        for line in containers_missing_resources(document):
            report(named, f"container {line}")
        if kind == "Namespace":
            if name != expected:
                report(named, f"renders the Namespace {name}, not {expected}")
        elif kind not in CLUSTER_SCOPED and namespace != expected:
            report(named, f"{kind} {name} sits in {namespace or '<none>'}, not {expected}")

    for line in rendered.stdout.splitlines():
        if NODE_PORT.match(line):
            report(named, "a manifest carries a nodePort")
        image = IMAGE.match(line)
        if image is None:
            continue
        written = image.group(1).strip()
        if "REPLACE_" in written:
            report(named, f"image {written} carries a placeholder")
        if ":" not in written.rsplit("/", 1)[-1]:
            report(named, f"image {written} names no tag")

if failures:
    fail(
        "",
        f"{failures} manifest check(s) failed. Render an overlay yourself to see what it produces:",
        f"    kubectl kustomize {OVERLAYS / DEPLOYED_OVERLAY}",
    )

say(f"Rendered {len(overlays)} overlay(s); every manifest check passed.")

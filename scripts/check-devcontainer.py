#!/usr/bin/env python3
"""Check that the devcontainer mounts the checkout where the container works, and builds what its anchor names.

The service's mount of the checkout has to land at ``workspaceFolder``.
Without it the devcontainer CLI mounts the checkout at its own directory name,
so a checkout directory named anything but this project's slug starts a
container whose working directory does not exist, and everything that runs
there fails with nothing naming the cause.

The declaration is two files. ``devcontainer.json`` states the folder the
container works in and names the compose file and the service, and the compose
file states what the container is run with, the checkout's mount among it. So
the folder is read from one and the mount from the other, and this is the only
thing that holds them together: neither file can see the other's half.

``devcontainer.json`` is JSONC by specification: JSON that also carries ``//``
and ``/* */`` comments and trailing commas. Comments in it are ordinary, and a
developer writing one is writing a valid file, so this reads the format the
file is actually in, through ``jsonc.py`` beside it. Reading it as strict JSON
would report a correct file as invalid and, because the gate runs on every
commit, would block every commit until the comment was removed.

The compose file is read as text rather than through a YAML parser, because
this runs wherever the gate runs and the only thing it needs out of that file
is one service's list of mounts. A parser would be a dependency on every
machine that commits, for a list this reads in a dozen lines.

The service's image is built from the Dockerfile its ``build.dockerfile``
names, with the arguments the compose file's ``x-devcontainer-build-args``
anchor holds, and the two are held together as well. Every bare ``ARG`` the
Dockerfile declares, the global ones its ``FROM`` lines read among them, has an
entry in the anchor, so no argument reaches the build empty; the arguments the
builder supplies itself, such as ``TARGETARCH``, are its own. Every ``*_IMAGE``
entry is a full reference to a published image, with a registry, a repository
and a tag, so a ``FROM`` resolves it nowhere but where the template published
it and at the version it named. And the anchor names no ``USER_UID`` or
``USER_GID``: the account is the published image's, ``dev`` at 1000:1000, and a
host whose own account has other ids is mapped onto it by the user namespace
the service reads rather than by an image built for it. The Dockerfile is read
as text too, one instruction at a time.

A configuration under a subdirectory of ``.devcontainer/``, which is how an
editor is offered a choice of containers and ``devcontainer up --config``
names one, is the same container with something more, such as the host's
GPUs, merged over it from an override it lists after the compose file. Each is
read the same way, with its compose files resolved against its own directory,
and is held to declaring what the default does in everything but its name and
its compose files, so a change to the default made in one place alone fails
here rather than in a container that comes up without it.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# The reader is imported from beside this file, and no bytecode cache is
# written for it: a gate run leaves the checkout holding what the repository
# holds and nothing else.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from jsonc import loads  # noqa: E402

DEVCONTAINER_DIR = Path(__file__).resolve().parent.parent / ".devcontainer"
DEVCONTAINER = DEVCONTAINER_DIR / "devcontainer.json"

# What a configuration under a subdirectory decides for itself. Everything
# else it declares is the default configuration's.
OWN_KEYS = frozenset({"name", "dockerComposeFile"})

# The one `- source:target[:options]` entry of a compose service's `volumes`
# list that mounts the checkout. Compose resolves a relative source against the
# directory the compose file sits in, which is `.devcontainer/`, so the
# checkout is the source that reaches its parent. Every other entry — a named
# volume, an absolute path, a path built from a variable — mounts something
# else and is left unread.
CHECKOUT = re.compile(r"^-\s+(?P<source>\.\.(?:/[^:]*)?):(?P<target>[^:]+)(?::(?P<options>.*))?\s*$")

# A key at the indentation compose gives a service's own keys, and the opening
# of the services mapping. Everything read here sits at a fixed indentation,
# which is the shape `docker compose config` writes and the one the file is
# committed in.
SERVICES = re.compile(r"^services:\s*$")
SERVICE = re.compile(r"^  (?P<name>[A-Za-z0-9._-]+):\s*$")
SERVICE_KEY = re.compile(r"^    (?P<key>[A-Za-z0-9._-]+):\s*(?P<value>.*)$")
# A key of the service's `build` mapping, one level deeper.
BUILD_KEY = re.compile(r"^      (?P<key>[A-Za-z0-9._-]+):\s*(?P<value>.*?)\s*$")

# The anchor every build argument of the service is merged from, and one entry
# of it: a name at two spaces' indentation and its value.
ANCHOR = "x-devcontainer-build-args"
ANCHOR_LINE = re.compile(rf"^{ANCHOR}:")
ANCHOR_ENTRY = re.compile(r"^  (?P<name>[A-Za-z_][A-Za-z0-9_]*):\s*(?P<value>.*?)\s*$")

# A bare `ARG NAME`, declaring an argument with no default of its own, which
# the build is handed or leaves empty.
BARE_ARG = re.compile(r"^ARG\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*$", re.IGNORECASE)

# The arguments a builder supplies itself, from the platform it builds for.
# The anchor states none of them, or it would replace what the builder knows.
AUTOMATIC_ARGS = frozenset(
    {
        "TARGETPLATFORM",
        "TARGETOS",
        "TARGETARCH",
        "TARGETVARIANT",
        "BUILDPLATFORM",
        "BUILDOS",
        "BUILDARCH",
        "BUILDVARIANT",
    }
)

# A reference a `FROM` resolves to one published image at one version: a
# registry host, a repository of one or more path components, and a tag.
IMAGE_REFERENCE = re.compile(
    r"^(?P<registry>(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::[0-9]+)?|localhost(?::[0-9]+)?)"
    r"/(?P<repository>[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)"
    r":(?P<tag>[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$"
)

# The ids a host once built the account with, which the image's fixed account
# replaces.
ID_ARGS = ("USER_UID", "USER_GID")


def service_volumes(text: str, service: str) -> list[str] | None:
    """The mounts *service* declares, or ``None`` when the file declares no such service."""
    in_services = False
    in_service = False
    in_volumes = False
    declared = False
    found: list[str] = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if SERVICES.match(line):
            in_services, in_service, in_volumes = True, False, False
            continue
        if not in_services:
            continue
        if not line.startswith(" "):
            # The next top-level key, so the services mapping has ended.
            break
        match = SERVICE.match(line)
        if match is not None:
            in_service = match["name"] == service
            declared = declared or in_service
            in_volumes = False
            continue
        if not in_service:
            continue
        key = SERVICE_KEY.match(line)
        if key is not None:
            in_volumes = key["key"] == "volumes"
            continue
        if in_volumes:
            found.append(line.strip())
    return found if declared else None


def service_dockerfile(text: str, service: str) -> str | None:
    """The Dockerfile *service*'s ``build.dockerfile`` names, or ``None`` when it builds none."""
    return service_build_value(text, service, "dockerfile")


def service_build_value(text: str, service: str, wanted: str) -> str | None:
    """The value of the key *wanted* under *service*'s ``build``, or ``None`` when it states none."""
    in_services = False
    in_service = False
    in_build = False
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if SERVICES.match(line):
            in_services, in_service, in_build = True, False, False
            continue
        if not in_services:
            continue
        if not line.startswith(" "):
            break
        match = SERVICE.match(line)
        if match is not None:
            in_service = match["name"] == service
            in_build = False
            continue
        if not in_service:
            continue
        key = SERVICE_KEY.match(line)
        if key is not None:
            in_build = key["key"] == "build"
            continue
        build = BUILD_KEY.match(line) if in_build else None
        if build is not None and build["key"] == wanted:
            return build["value"].strip("'\"")
    return None


def anchor_entries(text: str) -> dict[str, str] | None:
    """The entries of the compose file's build-argument anchor, or ``None`` when it declares none."""
    entries: dict[str, str] | None = None
    for line in text.splitlines():
        if ANCHOR_LINE.match(line):
            entries = {}
            continue
        if entries is None:
            continue
        if line.strip() and not line.startswith(" ") and not line.startswith("#"):
            break
        match = ANCHOR_ENTRY.match(line)
        if match is not None:
            entries[match["name"]] = match["value"].strip("'\"")
    return entries


def bare_arguments(text: str) -> list[str]:
    """Every argument a Dockerfile declares with a bare ``ARG``, in the order it declares them."""
    names: list[str] = []
    for line in text.splitlines():
        match = BARE_ARG.match(line.strip())
        if match is not None and match["name"] not in names:
            names.append(match["name"])
    return names


def build_failures(compose: Path, service: str) -> list[str]:
    """Every way the Dockerfile *compose* builds *service* from and the anchor fail to agree."""
    text = compose.read_text(encoding="utf-8")
    named = service_dockerfile(text, service)
    if named is None:
        return []
    found: list[str] = []
    # Compose resolves `dockerfile` against the build's `context`, and the
    # context against the compose file's directory, so a service built from a
    # context other than that directory names its Dockerfile from there.
    context = service_build_value(text, service, "context") or "."
    dockerfile = compose.parent / context / named
    if not dockerfile.is_file():
        return [f"{compose}: the {service} service is built from {named}, which is absent"]
    anchor = anchor_entries(text)
    if anchor is None:
        return [
            f"{compose}: declares no {ANCHOR}, so no argument {dockerfile} declares reaches the build",
        ]
    for name in bare_arguments(dockerfile.read_text(encoding="utf-8")):
        if name not in AUTOMATIC_ARGS and name not in anchor:
            found.append(
                f"{dockerfile}: declares ARG {name}, which {ANCHOR} in {compose} has no entry for, "
                f"so it reaches the build empty"
            )
    for name, value in anchor.items():
        if name.endswith("_IMAGE") and IMAGE_REFERENCE.match(value) is None:
            found.append(
                f"{compose}: {ANCHOR} names {name} as {value!r}, which is not a reference with a "
                f"registry, a repository and a tag"
            )
    for name in ID_ARGS:
        if name in anchor:
            found.append(
                f"{compose}: {ANCHOR} names {name}; the account is the published image's, 1000:1000, "
                f"and a host's own ids are mapped onto it by the user namespace instead"
            )
    return found


def checkout_target(volumes: list[str]) -> str | None:
    """The path the checkout is mounted at, out of a service's *volumes*."""
    for volume in volumes:
        match = CHECKOUT.match(volume)
        if match is not None:
            return match["target"]
    return None


def failures(document: dict, declaration: Path = DEVCONTAINER) -> list[str]:
    """Every way *declaration*, read as *document*, fails to mount the checkout where it works."""
    found: list[str] = []

    folder = document.get("workspaceFolder")
    if not isinstance(folder, str) or not folder:
        found.append(f"{declaration}: workspaceFolder is missing or is not a path")
        return found

    named = document.get("dockerComposeFile")
    # The specification allows one file or a list of them, and the last one to
    # declare a mount is the one that decides it.
    names = [named] if isinstance(named, str) else named
    if not isinstance(names, list) or not names or not all(isinstance(one, str) for one in names):
        found.append(
            f"{declaration}: dockerComposeFile is {named!r}, expected the compose "
            f"file the container is declared in"
        )
        return found

    service = document.get("service")
    if not isinstance(service, str) or not service:
        found.append(f"{declaration}: service is {service!r}, expected the service the workspace runs in")
        return found

    target: str | None = None
    declaring: Path | None = None
    for name in names:
        # A compose file is named relative to the declaration that names it.
        path = declaration.parent / name
        if not path.is_file():
            found.append(f"{path} is absent, and {declaration} declares the container in it")
            continue
        volumes = service_volumes(path.read_text(encoding="utf-8"), service)
        if volumes is None:
            found.append(f"{path}: declares no {service} service, which {declaration} runs the workspace in")
            continue
        mounted = checkout_target(volumes)
        if mounted is not None:
            target, declaring = mounted, path
        found.extend(build_failures(path, service))

    if found:
        return found

    if target is None:
        found.append(
            f"{declaration}: the {service} service mounts this checkout nowhere, so the "
            f"container works in {folder}, which it mounts the checkout at only when "
            f"the checkout directory happens to be named for it"
        )
    elif target != folder:
        found.append(
            f"{declaring}: the {service} service mounts this checkout at {target}, "
            f"which is not the {folder} {declaration} works in"
        )

    return found


def named_configurations() -> list[Path]:
    """Every configuration under a subdirectory of ``.devcontainer/``, in name order."""
    if not DEVCONTAINER_DIR.is_dir():
        return []
    return sorted(
        path / "devcontainer.json"
        for path in DEVCONTAINER_DIR.iterdir()
        if path.is_dir() and (path / "devcontainer.json").is_file()
    )


def divergence(default: dict, document: dict, declaration: Path) -> list[str]:
    """Every key *declaration* decides for itself that is the default's to decide."""
    found: list[str] = []
    for key in sorted(set(default) | set(document)):
        if key in OWN_KEYS:
            continue
        if key not in document:
            found.append(f"{declaration}: declares no {key}, which {DEVCONTAINER} declares")
        elif key not in default:
            found.append(f"{declaration}: declares {key}, which {DEVCONTAINER} does not")
        elif document[key] != default[key]:
            found.append(f"{declaration}: {key} is not what {DEVCONTAINER} declares")
    named = document.get("dockerComposeFile")
    names = [named] if isinstance(named, str) else named
    base = default.get("dockerComposeFile")
    bases = [base] if isinstance(base, str) else base
    if (
        isinstance(names, list)
        and isinstance(bases, list)
        and all(isinstance(one, str) for one in names + bases)
    ):
        # Its own files are merged over the default's, so the default's come
        # first, every one of them and in the default's order.
        own = [(declaration.parent / name).resolve() for name in names]
        expected = [(DEVCONTAINER.parent / name).resolve() for name in bases]
        if own[: len(expected)] != expected:
            found.append(
                f"{declaration}: its compose files start with {[str(path) for path in own]}, "
                f"not with the {[str(path) for path in expected]} {DEVCONTAINER} declares "
                f"the container in, which it merges its own over"
            )
    return found


def read(declaration: Path) -> dict | str:
    """The object *declaration* holds, or why it could not be read."""
    try:
        document = loads(declaration.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return f"{declaration} is absent"
    except json.JSONDecodeError as error:
        return f"{declaration} is not valid JSON with comments: {error}"
    if not isinstance(document, dict):
        return f"{declaration} does not hold a JSON object"
    return document


def main() -> int:
    """Report every failure, or nothing at all."""
    default = read(DEVCONTAINER)
    if isinstance(default, str):
        print(default, file=sys.stderr)
        return 1

    found = failures(default)
    for declaration in named_configurations():
        document = read(declaration)
        if isinstance(document, str):
            found.append(document)
            continue
        found.extend(failures(document, declaration))
        found.extend(divergence(default, document, declaration))

    for failure in found:
        print(failure, file=sys.stderr)
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())

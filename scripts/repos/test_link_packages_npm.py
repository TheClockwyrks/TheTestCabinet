"""link-packages.sh run with the real npm against a throwaway superrepo.

The table test beside the script drives it through stubs; this test runs it
with the npm the devcontainer and the web CI image carry, and with the real
derivation of the table and the plan from `sources.py`, pointed at a
temporary superrepo holding two workspaces: contracts', producing a model
package whose build copies its reducer into `dist/`, and web's, whose
package names the model at the version the feed would hold and whose lock
resolves it from the feed. Every npm call is offline against a registry that
does not exist, with its own cache and home, so a step that fetched or
published a package would fail rather than reach anything.

What it proves is the whole of linking: the consuming workspace
installs with the producer linked in place of the feed's version, its build
sees an edit to the producer's reducer once the producer is rebuilt, and the
consumer's manifests and lock stay as committed.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent
MODEL = "@clockwyrks/run-record"
PRODUCER = "contracts"
CONSUMER = "web"
REGISTRY = "https://registry.invalid/"

# The interpreter link-packages.sh runs `sources.py` with. It runs the real
# derivation, pointed at the throwaway superrepo rather than this checkout.
PYTHON = """\
#!{executable}
import os
import sys
from pathlib import Path

sys.path.insert(0, {scripts!r})
import sources

root = Path(os.environ["TCAB_SUPERREPO"])
command = sys.argv[2:]
if command == ["package-links", "--write"]:
    (root / sources.links.TABLE).write_text(
        sources.links.render_table(sources.package_links(root)), encoding="utf-8"
    )
elif command == ["link-plan"]:
    for line in sources.link_plan(root):
        print(line)
else:
    sys.exit(f"unexpected sources.py command: {{command}}")
"""

# The model's build copies its source into dist/, which is what a consumer
# resolves through the package's exports.
COPY = (
    "node -e \"const fs = require('fs'); fs.mkdirSync('dist', {recursive: true}); "
    "fs.copyFileSync('src/index.js', 'dist/index.js')\""
)
# The app's build imports the model and writes what its reducer answers.
REDUCE = (
    "node -e \"import('@clockwyrks/run-record').then((model) => { const fs = require('fs'); "
    "fs.mkdirSync('dist', {recursive: true}); fs.writeFileSync('dist/state.txt', String(model.reduce(1))); })\""
)


def _write(path: Path, content: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = content if isinstance(content, str) else json.dumps(content, indent=2) + "\n"
    path.write_text(text, encoding="utf-8")


def _reducer(root: Path, step: int) -> None:
    _write(
        root / PRODUCER / "packages/model/src/index.js",
        f"export const reduce = (state) => state + {step};\n",
    )


@pytest.fixture
def env(tmp_path: Path) -> dict[str, str]:
    npm = shutil.which("npm")
    assert npm, "npm is required; the devcontainer and the web CI image carry it"
    python = tmp_path / "bin" / "python"
    _write(python, PYTHON.format(executable=sys.executable, scripts=str(SCRIPTS)))
    python.chmod(0o755)
    environment = {name: value for name, value in os.environ.items() if not name.lower().startswith("npm_config_")}
    environment.update(
        {
            "HOME": str(tmp_path / "home"),
            "PYTHON": str(python),
            "TCAB_SUPERREPO": str(tmp_path / "super"),
            "npm_config_registry": REGISTRY,
            "npm_config_offline": "true",
            "npm_config_cache": str(tmp_path / "npm-cache"),
            "npm_config_update_notifier": "false",
        }
    )
    (tmp_path / "home").mkdir()
    return environment


@pytest.fixture
def superrepo(tmp_path: Path, env: dict[str, str]) -> Path:
    root = tmp_path / "super"
    producer = root / PRODUCER
    _write(
        producer / "package.json",
        {
            "name": "contracts",
            "private": True,
            "workspaces": ["packages/*"],
            "scripts": {"build": "npm run build --workspaces"},
        },
    )
    _write(
        producer / "packages/model/package.json",
        {
            "name": MODEL,
            "version": "0.1.0",
            "type": "module",
            "exports": "./dist/index.js",
            "publishConfig": {"registry": REGISTRY},
            "scripts": {"build": COPY},
        },
    )
    _reducer(root, 1)
    # The producer's lock holds its own members alone, so npm writes it offline.
    _npm(["install", "--package-lock-only", "--no-audit", "--no-fund"], producer, env)
    consumer = root / CONSUMER
    _write(
        consumer / "package.json",
        {
            "name": "web",
            "private": True,
            "workspaces": ["packages/*"],
            "scripts": {"build": "npm run build --workspaces"},
        },
    )
    app = {
        "name": "@clockwyrks/web-app",
        "version": "0.1.0",
        "private": True,
        "type": "module",
        "dependencies": {MODEL: "0.1.0"},
        "scripts": {"build": REDUCE},
    }
    _write(consumer / "packages/app/package.json", app)
    # The lock a repository built apart commits: the model at the feed's version.
    _write(
        consumer / "package-lock.json",
        {
            "name": "web",
            "lockfileVersion": 3,
            "requires": True,
            "packages": {
                "": {"name": "web", "workspaces": ["packages/*"]},
                f"node_modules/{MODEL}": {
                    "version": "0.1.0",
                    "resolved": f"{REGISTRY}{MODEL}/-/run-record-0.1.0.tgz",
                    "integrity": "sha512-" + "A" * 86 + "==",
                },
                "node_modules/@clockwyrks/web-app": {
                    "resolved": "packages/app",
                    "link": True,
                },
                "packages/app": {
                    "name": app["name"],
                    "version": app["version"],
                    "dependencies": app["dependencies"],
                },
            },
        },
    )
    return root


def _npm(args: list[str], cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    done = subprocess.run(["npm", *args], cwd=cwd, env=env, capture_output=True, text=True, check=False)
    assert done.returncode == 0, f"npm {' '.join(args)} in {cwd}:\n{done.stdout}{done.stderr}"
    return done


def _committed(root: Path) -> dict[str, bytes]:
    paths = ["package.json", "package-lock.json", "packages/app/package.json"]
    return {path: (root / CONSUMER / path).read_bytes() for path in paths}


def _state(root: Path, env: dict[str, str]) -> str:
    """What the consumer's build reads from the model's reducer."""
    _npm(["run", "build"], root / CONSUMER, env)
    return (root / CONSUMER / "packages/app/dist/state.txt").read_text(encoding="utf-8")


def test_a_consumer_builds_against_the_producers_checkout_with_nothing_published(
    superrepo: Path, env: dict[str, str]
) -> None:
    committed = _committed(superrepo)
    done = subprocess.run(
        [str(SCRIPTS / "link-packages.sh")],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads((superrepo / ".package-links.json").read_text(encoding="utf-8"))["workspaces"] == {
        PRODUCER: {MODEL: "packages/model"},
        CONSUMER: {"@clockwyrks/web-app": "packages/app"},
    }
    entry = superrepo / CONSUMER / "node_modules" / MODEL
    assert entry.is_symlink()
    assert entry.resolve() == (superrepo / PRODUCER / "packages/model").resolve()
    assert _committed(superrepo) == committed, "the link rewrote the consumer's manifests or lock"
    assert _state(superrepo, env) == "2"

    # An edit to the reducer reaches the consumer's build once the producer is rebuilt.
    _reducer(superrepo, 41)
    _npm(["run", "build"], superrepo / PRODUCER, env)
    assert _state(superrepo, env) == "42"
    assert _committed(superrepo) == committed
    # Nothing was packed, so nothing could have been published or fetched.
    assert not list(superrepo.parent.rglob("*.tgz"))

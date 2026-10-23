"""The `playwright-image` gate, run against a stand-in `playwright` package.

The stand-in is installed into the checkout's `node_modules` by hand: it
reports a version and answers `chromium.executablePath()` with the path the
test hands it through the environment, so no browser is installed and no
registry is reached. The gate asks it through the real `node`, which the
checks image and the rust-browser image both carry.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

GATE = Path(__file__).resolve().parents[1] / "gates" / "playwright-image.py"
VERSION = "1.63.0"
STAND_IN = """
module.exports = {
  chromium: {
    executablePath() {
      if (process.env.STUB_CHROMIUM_THROWS) throw new Error("no such browser");
      return process.env.STUB_CHROMIUM || "";
    },
  },
};
"""

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="the gate asks Playwright through node")


@pytest.fixture
def repo(checkout: Path) -> Path:
    shutil.copy(GATE, checkout / "ci" / "gates" / GATE.name)
    return checkout


def _install(root: Path) -> None:
    package = root / "node_modules" / "playwright"
    package.mkdir(parents=True)
    manifest = {"name": "playwright", "version": VERSION, "main": "index.js"}
    (package / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
    (package / "index.js").write_text(STAND_IN, encoding="utf-8")


def _gate(root: Path, **env: str) -> subprocess.CompletedProcess[str]:
    removed = ("TCAB_REQUIRE_BROWSER", "PLAYWRIGHT_BROWSERS_PATH", "STUB_CHROMIUM", "STUB_CHROMIUM_THROWS")
    environment = {key: value for key, value in os.environ.items() if key not in removed}
    environment.update(env)
    return subprocess.run(
        [sys.executable, str(root / "ci" / "gates" / GATE.name)],
        cwd=root,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def test_a_present_browser_passes(repo: Path, tmp_path: Path) -> None:
    _install(repo)
    browser = tmp_path / "chrome"
    browser.write_text("", encoding="utf-8")
    done = _gate(repo, TCAB_REQUIRE_BROWSER="1", STUB_CHROMIUM=str(browser))
    assert done.returncode == 0, done.stderr
    assert f"playwright {VERSION} finds its Chromium at {browser}" in done.stdout


def test_an_absent_browser_fails_where_it_is_required(repo: Path, tmp_path: Path) -> None:
    _install(repo)
    missing = tmp_path / "ms-playwright" / "chromium-0000" / "chrome"
    done = _gate(
        repo,
        TCAB_REQUIRE_BROWSER="1",
        STUB_CHROMIUM=str(missing),
        PLAYWRIGHT_BROWSERS_PATH=str(tmp_path / "ms-playwright"),
    )
    assert done.returncode == 1
    assert f"playwright {VERSION} finds no Chromium" in done.stderr
    assert str(missing) in done.stderr
    assert f"PLAYWRIGHT_BROWSERS_PATH is {tmp_path / 'ms-playwright'}" in done.stderr


def test_a_browser_playwright_cannot_name_fails_where_it_is_required(repo: Path) -> None:
    _install(repo)
    done = _gate(repo, TCAB_REQUIRE_BROWSER="1", STUB_CHROMIUM_THROWS="1")
    assert done.returncode == 1
    assert "an executable it could not name" in done.stderr
    assert "PLAYWRIGHT_BROWSERS_PATH is unset" in done.stderr


def test_an_uninstalled_workspace_fails_where_the_browser_is_required(repo: Path) -> None:
    done = _gate(repo, TCAB_REQUIRE_BROWSER="1")
    assert done.returncode == 1
    assert "has no `playwright` installed" in done.stderr


def test_without_the_requirement_an_absent_browser_skips(repo: Path, tmp_path: Path) -> None:
    _install(repo)
    done = _gate(repo, STUB_CHROMIUM=str(tmp_path / "absent"))
    assert done.returncode == 0, done.stderr
    assert "finds no Chromium" in done.stdout
    assert "not required here" in done.stdout

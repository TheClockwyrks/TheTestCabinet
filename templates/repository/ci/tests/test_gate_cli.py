"""The `gate` command, run the way its callers run it."""

from __future__ import annotations

import json
from pathlib import Path

from the_test_cabinet_ci import proc

PASSES = '''
    """Passes, loudly."""
    import sys
    print("pass-stdout")
    print("pass-stderr", file=sys.stderr)
'''

FAILS = '''
    """Fails with 7."""
    import sys
    print("fail-stdout")
    print("fail-stderr", file=sys.stderr)
    sys.exit(7)
'''

# Reports the root the runner entered before it ran the gate. Held here rather
# than written at each of its two uses because the import names this project's
# own module, so how long that line is would be decided by the project's name.
WHERE = '''
    """Where."""
    from the_test_cabinet_ci import enter_repo_root
    print(enter_repo_root())
'''


# list


def test_list_json_is_sorted_and_described(gate, add_gate) -> None:
    add_gate("web-test", '"""Run the interface tests.\n\nMore.\n"""\n')
    add_gate("rust-fmt", '"""Check formatting."""\n')
    add_gate("bare", "import sys\n")
    listed = gate("list", "--json")
    assert listed.returncode == 0
    assert json.loads(listed.stdout) == [
        {"id": "bare", "description": ""},
        {"id": "rust-fmt", "description": "Check formatting."},
        {"id": "web-test", "description": "Run the interface tests."},
    ]


def test_list_runs_no_gate(gate, add_gate, checkout: Path) -> None:
    marker = checkout / "ran"
    add_gate("boom", f'"""Would leave a mark."""\nopen({str(marker)!r}, "w")\n')
    assert gate("list", "--json").returncode == 0
    assert gate("list").returncode == 0
    assert not marker.exists()


def test_list_as_text_aligns_the_descriptions(gate, add_gate) -> None:
    add_gate("a", '"""First."""\n')
    add_gate("longer-id", '"""Second."""\n')
    assert gate("list").stdout.splitlines() == ["a          First.", "longer-id  Second."]


def test_list_works_from_a_subdirectory(gate, add_gate, checkout: Path) -> None:
    add_gate("a", '"""First."""\n')
    below = checkout / "deep" / "er"
    below.mkdir(parents=True)
    assert json.loads(gate("list", "--json", cwd=below).stdout) == [{"id": "a", "description": "First."}]


def test_outside_a_checkout_is_a_usage_error(gate, outside_a_checkout: Path) -> None:
    result = gate("list", cwd=outside_a_checkout)
    assert result.returncode == 2
    assert "not inside a git checkout" in result.stderr


# run, streaming


def test_run_streams_the_output_and_passes(gate, add_gate) -> None:
    add_gate("ok", PASSES)
    result = gate("run", "ok")
    assert result.returncode == 0
    assert "pass-stdout" in result.stdout
    assert "pass-stderr" in result.stderr


def test_run_stops_at_the_first_failure(gate, add_gate) -> None:
    add_gate("bad", FAILS)
    add_gate("ok", PASSES)
    result = gate("run", "bad", "ok")
    assert result.returncode == 1
    assert "fail-stdout" in result.stdout
    assert "pass-stdout" not in result.stdout
    assert "gate: failed: bad" in result.stderr


def test_run_keep_going_runs_the_rest(gate, add_gate) -> None:
    add_gate("bad", FAILS)
    add_gate("ok", PASSES)
    result = gate("run", "bad", "ok", "--keep-going")
    assert result.returncode == 1
    assert "pass-stdout" in result.stdout


def test_run_keeps_the_order_given(gate, add_gate) -> None:
    add_gate("a", '"""A."""\nprint("ran a", flush=True)\n')
    add_gate("b", '"""B."""\nprint("ran b", flush=True)\n')
    assert gate("run", "b", "a").stdout.splitlines() == ["ran b", "ran a"]
    assert gate("run", "--all").stdout.splitlines() == ["ran a", "ran b"]


def test_a_streaming_run_sets_no_artifact_directory(gate, add_gate) -> None:
    add_gate("env", '"""Env."""\nimport os\nprint("artifacts:", os.environ.get("CI_GATE_ARTIFACTS"))\n')
    assert "artifacts: None" in gate("run", "env").stdout


def test_a_gate_acts_on_the_checkout_it_is_run_in(gate, add_gate, checkout: Path) -> None:
    add_gate("where", WHERE)
    below = checkout / "below"
    below.mkdir()
    assert gate("run", "where", cwd=below).stdout.strip() == str(checkout)


def test_a_gate_acts_on_a_linked_worktree(gate, add_gate, checkout: Path, tmp_path: Path) -> None:
    add_gate("where", WHERE)
    # Through `proc.git`: a plain subprocess here would inherit a commit hook's
    # GIT_DIR and commit this fixture's index onto the repository being
    # committed to, ignoring `-C` entirely.
    opts = ["-C", str(checkout), "-c", "user.name=t", "-c", "user.email=t@example.com"]
    linked = (tmp_path / "linked").resolve()
    for args in (
        ["add", "."],
        ["commit", "--quiet", "--no-verify", "-m", "gates"],
        ["worktree", "add", "--quiet", str(linked)],
    ):
        assert proc.git([*opts, *args]).returncode == 0
    assert gate("run", "where", cwd=linked).stdout.strip() == str(linked)


# run, usage errors


def test_an_unknown_id_fails_before_any_gate_runs(gate, add_gate, checkout: Path, tmp_path: Path) -> None:
    marker = checkout / "ran"
    add_gate("ok", f'"""Leaves a mark."""\nopen({str(marker)!r}, "w")\n')
    add_gate("other", '"""Other."""\n')
    for extra in ([], ["--report-dir", str(tmp_path / "report")]):
        result = gate("run", "ok", "nope", *extra)
        assert result.returncode == 2
        assert result.stdout == ""
        assert "unknown gate: nope. Known gates: ok, other" in result.stderr
    assert not marker.exists()
    assert not (tmp_path / "report").exists()


def test_no_id_is_a_usage_error(gate, add_gate) -> None:
    add_gate("ok", PASSES)
    result = gate("run")
    assert result.returncode == 2
    assert "--all" in result.stderr


# run --report-dir


def test_a_report_prints_results_json_and_nothing_else(gate, add_gate, tmp_path: Path) -> None:
    add_gate("ok", PASSES)
    add_gate("bad", FAILS)
    report_dir = tmp_path / "report"
    result = gate("run", "bad", "ok", "--report-dir", str(report_dir))

    assert result.returncode == 1
    assert result.stderr == ""
    for leaked in ("pass-stdout", "pass-stderr", "fail-stdout", "fail-stderr"):
        assert leaked not in result.stdout

    printed = json.loads(result.stdout)
    assert printed == json.loads((report_dir / "results.json").read_text(encoding="utf-8"))
    assert printed["ok"] is False
    assert printed["report_dir"] == str(report_dir.resolve())
    # It keeps going past the failure, in the order given.
    assert [entry["id"] for entry in printed["gates"]] == ["bad", "ok"]

    bad, ok = printed["gates"]
    assert bad == {
        "id": "bad",
        "ok": False,
        "exit_code": 7,
        "seconds": bad["seconds"],
        "log": str(report_dir.resolve() / "bad" / "output.log"),
        "artifacts": str(report_dir.resolve() / "bad"),
    }
    assert (ok["ok"], ok["exit_code"]) == (True, 0)
    assert isinstance(bad["seconds"], float) and bad["seconds"] >= 0


def test_a_log_holds_stdout_and_stderr_together(gate, add_gate, tmp_path: Path) -> None:
    add_gate("bad", FAILS)
    report_dir = tmp_path / "report"
    gate("run", "bad", "--report-dir", str(report_dir))
    log = (report_dir / "bad" / "output.log").read_text(encoding="utf-8")
    assert "fail-stdout" in log and "fail-stderr" in log


def test_a_log_keeps_a_gate_and_its_tools_in_order(gate, add_gate, tmp_path: Path) -> None:
    add_gate(
        "ordered",
        '''
        """Prints around a tool it runs."""
        import sys
        from the_test_cabinet_ci import run, say
        say("before")
        run([sys.executable, "-c", "print('tool')"])
        say("after")
        ''',
    )
    report_dir = tmp_path / "report"
    assert gate("run", "ordered", "--report-dir", str(report_dir)).returncode == 0
    log = report_dir / "ordered" / "output.log"
    assert log.read_text(encoding="utf-8").splitlines() == ["before", "tool", "after"]


def test_a_report_gives_each_gate_a_folder_for_its_log_and_artifacts(gate, add_gate, tmp_path: Path) -> None:
    source = '''
        """Writes an artifact."""
        from the_test_cabinet_ci import artifacts_dir
        (artifacts_dir() / "junit.xml").write_text("<testsuites/>")
    '''
    add_gate("one", source)
    add_gate("two", source)
    report_dir = tmp_path / "report"
    assert gate("run", "one", "two", "--report-dir", str(report_dir)).returncode == 0
    for gate_id in ("one", "two"):
        assert sorted(path.name for path in (report_dir / gate_id).iterdir()) == ["junit.xml", "output.log"]


def test_a_log_is_written_without_colour(gate, add_gate, tmp_path: Path) -> None:
    add_gate(
        "env",
        '"""Env."""\nimport os\n'
        'names = ("FORCE_COLOR", "CLICOLOR_FORCE", "NO_COLOR", "CARGO_TERM_COLOR")\n'
        'print(*(f"{n}={os.environ.get(n)}" for n in names))\n',
    )
    forced = {"FORCE_COLOR": "3", "CLICOLOR_FORCE": "1", "CARGO_TERM_COLOR": "always"}
    report_dir = tmp_path / "report"
    gate("run", "env", "--report-dir", str(report_dir), env=forced)
    assert (report_dir / "env" / "output.log").read_text(encoding="utf-8").split() == [
        "FORCE_COLOR=None", "CLICOLOR_FORCE=None", "NO_COLOR=1", "CARGO_TERM_COLOR=never",
    ]  # fmt: skip
    # A terminal run keeps the caller's choice.
    assert "FORCE_COLOR=3" in gate("run", "env", env=forced).stdout


def test_a_relative_report_dir_is_reported_absolute(gate, add_gate, checkout: Path) -> None:
    add_gate("ok", PASSES)
    printed = json.loads(gate("run", "ok", "--report-dir", "out/report").stdout)
    assert printed["report_dir"] == str(checkout / "out" / "report")
    assert printed["root"] == str(checkout)
    assert printed["ok"] is True


def test_a_gate_without_a_terminal_reads_no_input(gate, add_gate, tmp_path: Path) -> None:
    add_gate("reads", '"""Reads stdin."""\nimport sys\nprint("read:", repr(sys.stdin.read()))\n')
    report_dir = tmp_path / "report"
    assert gate("run", "reads", "--report-dir", str(report_dir)).returncode == 0
    assert "read: ''" in (report_dir / "reads" / "output.log").read_text(encoding="utf-8")

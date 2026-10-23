"""The `gate` command: list the gates, run them.

    gate list [--json]
    gate run <id>... [--all] [--report-dir DIR [--baseline METRICS.json]] [--keep-going]

Exit codes: 0 when every gate passed, 1 when one failed, 2 for a usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from the_test_cabinet_ci import metrics, runner
from the_test_cabinet_ci.proc import NotInRepository, repo_root

USAGE_ERROR = 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="gate", description="List and run the repository's gates.")
    commands = parser.add_subparsers(dest="command", required=True)

    listing = commands.add_parser("list", help="the gates and what each checks")
    listing.add_argument("--json", action="store_true", help="print a JSON array of {id, description}")

    running = commands.add_parser(
        "run",
        help="run gates, in the order given",
        description="Run gates one after another, in the order given.",
    )
    running.add_argument("ids", nargs="*", metavar="id", help="a gate's id: the stem of its file under ci/gates/")
    running.add_argument("--all", action="store_true", help="run every gate, in id order")
    running.add_argument(
        "--report-dir",
        type=Path,
        metavar="DIR",
        help="print no gate output: give each gate the folder DIR/<id>/ for its output.log and its artifacts, "
        "run every gate, write DIR/results.json, DIR/metrics.json and DIR/SUMMARY.md, and print results.json",
    )
    running.add_argument(
        "--baseline",
        type=Path,
        metavar="METRICS.json",
        help="with --report-dir: compare the run with these figures, in DIR/compare.json and the summary",
    )
    running.add_argument("--keep-going", action="store_true", help="run the remaining gates after one fails")
    return parser


def _list(gates: list[runner.Gate], as_json: bool) -> int:
    if as_json:
        print(json.dumps([{"id": gate.id, "description": gate.description} for gate in gates], indent=2))
        return 0
    width = max((len(gate.id) for gate in gates), default=0)
    for gate in gates:
        print(f"{gate.id.ljust(width)}  {gate.description}".rstrip())
    return 0


def _run_streaming(gates: list[runner.Gate], keep_going: bool) -> int:
    failed: list[str] = []
    for gate in gates:
        if not runner.run_streaming(gate).ok:
            failed.append(gate.id)
            if not keep_going:
                break
    # One gate's failure is its own last word. With several, say which.
    if failed and len(gates) > 1:
        print(f"gate: failed: {', '.join(failed)}", file=sys.stderr)
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        root = repo_root()
    except NotInRepository as error:
        print(f"gate: {error}", file=sys.stderr)
        return USAGE_ERROR
    directory = runner.gates_dir(root)

    if args.command == "list":
        return _list(runner.discover(directory), args.json)

    if not args.ids and not args.all:
        print("gate: name at least one gate, or pass --all", file=sys.stderr)
        return USAGE_ERROR
    try:
        gates = runner.select(directory, args.ids, everything=args.all)
    except runner.UnknownGate as error:
        print(f"gate: {error}", file=sys.stderr)
        return USAGE_ERROR

    if args.baseline is not None and args.report_dir is None:
        print("gate: --baseline compares a report, so it needs --report-dir", file=sys.stderr)
        return USAGE_ERROR
    # Read before any gate runs, like the ids: a wrong path costs no gate's time.
    try:
        baseline = None if args.baseline is None else metrics.load_metrics(args.baseline)
    except metrics.UnreadableMetrics as error:
        print(f"gate: --baseline: {error}", file=sys.stderr)
        return USAGE_ERROR

    try:
        if args.report_dir is None:
            return _run_streaming(gates, args.keep_going)
        files = metrics.report_files(args.report_dir, compared=baseline is not None)
        report = runner.run_report(gates, args.report_dir, root, files)
    except KeyboardInterrupt:
        return 130
    metrics.write_report(
        args.report_dir, lambda: root, lambda message: print(f"gate: {message}", file=sys.stderr), baseline=baseline
    )
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

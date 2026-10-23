"""The `metrics` command: figures from a gate report, and two sets compared.

    metrics collect REPORT_DIR [-o FILE]
    metrics compare BASE.json HEAD.json [--ratio 1.5] [--min-seconds 1.0]
                                        [--coverage-epsilon 0.1] [-o FILE]
    metrics summary REPORT_DIR [--baseline METRICS.json]

`gate run --report-dir` does all three itself. The commands are for a report
that is already there: figures written somewhere else, other thresholds, a
summary against another baseline.

Exit codes: 0 when the figures were written or compared, whatever they say; 1
when a report or a metrics file cannot be read; 2 for a usage error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from the_test_cabinet_ci import metrics
from the_test_cabinet_ci.proc import repo_root


def _non_negative(text: str) -> float:
    value = float(text)
    if value < 0:
        raise argparse.ArgumentTypeError(f"{text} is negative")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="metrics", description="Read and compare what the gates measured.")
    commands = parser.add_subparsers(dest="command", required=True)

    collecting = commands.add_parser("collect", help="write the figures in a `gate run --report-dir` directory")
    collecting.add_argument("report_dir", type=Path, metavar="REPORT_DIR")
    collecting.add_argument("-o", "--output", type=Path, metavar="FILE", help="default: REPORT_DIR/metrics.json")

    comparing = commands.add_parser("compare", help="list what got slower and what lost coverage")
    comparing.add_argument("base", type=Path, metavar="BASE.json")
    comparing.add_argument("head", type=Path, metavar="HEAD.json")
    comparing.add_argument("--ratio", type=_non_negative, default=1.5, help="slower: head >= base * RATIO (1.5)")
    comparing.add_argument(
        "--min-seconds", type=_non_negative, default=1.0, help="slower: and head >= MIN_SECONDS (1.0)"
    )
    comparing.add_argument(
        "--coverage-epsilon",
        type=_non_negative,
        default=0.1,
        help="coverage: down by more than this many percentage points (0.1)",
    )
    comparing.add_argument("-o", "--output", type=Path, metavar="FILE", help="also write the comparison here")

    summarising = commands.add_parser(
        "summary",
        help="write a report directory's metrics.json and SUMMARY.md again",
        description="Write REPORT_DIR's metrics.json and SUMMARY.md again, from what the gates left in it. "
        "Without --baseline the summary keeps the comparison the directory already holds.",
    )
    summarising.add_argument("report_dir", type=Path, metavar="REPORT_DIR")
    summarising.add_argument(
        "--baseline", type=Path, metavar="METRICS.json", help="compare with these figures, in REPORT_DIR/compare.json"
    )
    return parser


def _write(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _warn(message: str) -> None:
    print(f"metrics: {message}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "collect":
            figures = metrics.collect(args.report_dir, repo_root, _warn)
            output = args.output or args.report_dir / metrics.METRICS_FILE
            _write(output, figures)
            # The path, for the caller to hand on. The figures themselves can
            # run to thousands of tests and belong in the file.
            print(output.resolve())
            return 0
        if args.command == "summary":
            baseline = None if args.baseline is None else metrics.load_metrics(args.baseline)
            files = metrics.write_report(args.report_dir, repo_root, _warn, baseline=baseline, keep_comparison=True)
            # The path, as `collect` prints its own.
            print(files["summary"])
            return 0
        comparison = metrics.compare(
            metrics.load_metrics(args.base),
            metrics.load_metrics(args.head),
            ratio=args.ratio,
            min_seconds=args.min_seconds,
            coverage_epsilon=args.coverage_epsilon,
        )
    except (metrics.UnreadableMetrics, OSError, RuntimeError) as error:
        _warn(str(error))
        return 1
    if args.output is not None:
        _write(args.output, comparison)
    print(json.dumps(comparison, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

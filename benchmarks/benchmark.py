#!/usr/bin/env python3
"""Compare the unchanged transcript script using yt-dlp versus yt-dlp-explode."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent


def run_one(tool, binary, iteration, args, output):
    run_dir = output / f"{iteration:02d}-{tool}"
    run_dir.mkdir()
    with tempfile.TemporaryDirectory(prefix="explode-benchmark-", dir="/tmp") as tmp:
        temporary = Path(tmp)
        cookie = temporary / "cookies.txt"
        shutil.copyfile(args.cookies, cookie)
        cookie.chmod(0o600)
        wrapper = temporary / "yt-dlp"
        wrapper.write_text(
            f"#!{sys.executable}\nimport os, sys\n"
            f"os.execv({str(binary)!r}, [{str(binary)!r}, *sys.argv[1:], '--cookies', {str(cookie)!r}])\n"
        )
        wrapper.chmod(0o700)
        env = dict(os.environ)
        env["PATH"] = tmp + os.pathsep + env["PATH"]
        env["TRANSCRIBE_CACHE_DIR"] = str(temporary / "cache")
        command = [str(args.script), "--file", args.url]
        resources = run_dir / "resources.log"
        if sys.platform == "darwin":
            command = ["/usr/bin/time", "-l", "-o", str(resources), *command]
        record = {"tool": tool, "iteration": iteration, "warmup": iteration == 0,
                  "script_command": [str(args.script), "--file", args.url],
                  "wrapped_executable": str(binary), "success": False}
        start = time.perf_counter()
        try:
            result = subprocess.run(command, capture_output=True, env=env, timeout=120)
            record.update(wall_s=time.perf_counter() - start, returncode=result.returncode)
            (run_dir / "stderr.log").write_bytes(result.stderr)
            if result.returncode:
                raise ValueError(f"process exited {result.returncode}")
            source = Path(result.stdout.decode().strip())
            if source.parent != temporary / "cache/youtube-transcripts":
                raise ValueError("script fell back to audio transcription")
            text = source.read_text()
            shutil.copyfile(source, run_dir / "transcript.txt")
            normalized = " ".join(re.sub(r"^\[(?:\d+:)?\d{2}:\d{2}\]\s*", "", text, flags=re.MULTILINE).split())
            if not normalized:
                raise ValueError("empty transcript")
            record.update(success=True, words=len(normalized.split()),
                          normalized_sha256=hashlib.sha256(normalized.encode()).hexdigest())
            if resources.exists():
                match = re.search(r"(\d+)\s+maximum resident set size", resources.read_text())
                if match:
                    record["peak_rss_bytes"] = int(match[1])
        except (subprocess.TimeoutExpired, ValueError, OSError) as error:
            record.update(wall_s=time.perf_counter() - start, error=str(error))
    print(f"{tool:16} {iteration}: {record['wall_s']:.3f}s {'OK' if record['success'] else record['error']}", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--cookies", type=Path, required=True)
    parser.add_argument("--binary", type=Path, default=ROOT.parent / "artifacts/osx-arm64/yt-dlp-explode")
    parser.add_argument("--url", default="https://www.youtube.com/watch?v=4Ff0xc9M8kA")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    args.script = args.script.resolve(strict=True)
    args.cookies = args.cookies.expanduser().resolve(strict=True)
    args.binary = args.binary.resolve(strict=True)
    original = shutil.which("yt-dlp")
    if not original:
        parser.error("yt-dlp is required on PATH for the baseline")
    output = (args.output or ROOT.parent / "artifacts/benchmarks" / datetime.now().strftime("%Y%m%d-%H%M%S")).resolve()
    output.mkdir(parents=True, exist_ok=False)
    variants = [("yt-dlp-explode", args.binary), ("yt-dlp", Path(original))]
    report = {
        "date_utc": datetime.now(timezone.utc).isoformat(), "platform": platform.platform(),
        "video_url": args.url, "script": str(args.script),
        "script_sha256": hashlib.sha256(args.script.read_bytes()).hexdigest(),
        "binary_sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
        "binary_bytes": args.binary.stat().st_size,
        "yt_dlp_version": subprocess.check_output([original, "--version"], text=True).strip(),
        "method": "Same unchanged transcript script, fresh processes/caches/cookie copies; only PATH's yt-dlp executable differs. One excluded warmup, alternating order, two-second pauses outside timing. RSS from macOS time -l is not summed process-tree memory.",
        "runs": [],
    }
    for iteration in range(args.runs + 1):
        order = variants if iteration % 2 == 0 else variants[::-1]
        for name, executable in order:
            report["runs"].append(run_one(name, executable, iteration, args, output))
            (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
            time.sleep(2)
    report["summary"] = {}
    for name, _ in variants:
        runs = [r for r in report["runs"] if r["tool"] == name and not r["warmup"]]
        successful = [r for r in runs if r["success"]]
        summary = {"successes": len(successful), "attempts": len(runs)}
        if successful:
            durations = [r["wall_s"] for r in successful]
            summary.update(median_wall_s=statistics.median(durations), min_wall_s=min(durations), max_wall_s=max(durations))
            if all("peak_rss_bytes" in r for r in successful):
                summary["median_peak_rss_bytes"] = statistics.median(r["peak_rss_bytes"] for r in successful)
        report["summary"][name] = summary
    report["matching_transcripts"] = len({r["normalized_sha256"] for r in report["runs"] if r["success"] and not r["warmup"]}) == 1
    success = report["matching_transcripts"] and all(s["successes"] == args.runs for s in report["summary"].values())
    if success:
        report["speed_ratio"] = report["summary"]["yt-dlp"]["median_wall_s"] / report["summary"]["yt-dlp-explode"]["median_wall_s"]
    (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["summary"], indent=2))
    print(f"Matching: {report['matching_transcripts']}; artifacts: {output}")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())

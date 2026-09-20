#!/usr/bin/env python3
"""Measure complete subtitle pulls by the yt-dlp and yt-dlp-explode CLIs directly."""
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


def normalized_text(data):
    document = json.loads(data)
    text = " ".join(
        segment.get("utf8", "")
        for event in document.get("events", [])
        for segment in event.get("segs", [])
    )
    text = " ".join(text.split())
    if not text:
        raise ValueError("empty caption text")
    return text


def run_one(name, binary, iteration, args, output):
    run_dir = output / f"{iteration:02d}-{name}"
    run_dir.mkdir()
    record = {"tool": name, "iteration": iteration, "warmup": iteration == 0, "success": False}
    with tempfile.TemporaryDirectory(prefix="caption-benchmark-") as temporary:
        cookie = Path(temporary) / "cookies.txt"
        shutil.copyfile(args.cookies, cookie)
        cookie.chmod(0o600)
        flags = [
            "--skip-download", "--write-auto-subs", "--sub-langs", "en", "--sub-format", "json3",
            "--no-warnings", "--no-playlist", "--cookies", str(cookie),
            "--cache-dir", str(output / "cache"), "-P", str(run_dir), "-o", "%(id)s.%(ext)s",
        ]
        if args.cold_cache:
            flags += ["--no-cache-dir"]
        command = [str(binary), *flags, "--", args.url]
        record["command"] = [str(binary), *["<temporary-cookie-copy>" if f == str(cookie) else f for f in flags], "--", args.url]
        resources = run_dir / "resources.log"
        if sys.platform == "darwin":
            command = ["/usr/bin/time", "-l", "-o", str(resources), *command]
        env = dict(os.environ)
        env.pop("YT_DLP_EXPLODE_PROFILE", None)
        start = time.perf_counter()
        try:
            result = subprocess.run(command, capture_output=True, env=env, timeout=120)
            record.update(wall_s=time.perf_counter() - start, returncode=result.returncode)
            (run_dir / "stderr.log").write_bytes(result.stderr)
            (run_dir / "stdout.log").write_bytes(result.stdout)
            if result.returncode:
                raise ValueError(f"process exited {result.returncode}")
            subtitles = list(run_dir.glob("*.en.json3"))
            if len(subtitles) != 1:
                raise ValueError(f"expected one English JSON3 subtitle file, got {len(subtitles)}")
            data = subtitles[0].read_bytes()
            text = normalized_text(data)
            record.update(
                success=True, caption_bytes=len(data), words=len(text.split()),
                normalized_sha256=hashlib.sha256(text.encode()).hexdigest(),
                subtitle_sha256=hashlib.sha256(data).hexdigest(),
            )
            if resources.exists():
                match = re.search(r"(\d+)\s+maximum resident set size", resources.read_text())
                if match:
                    record["peak_rss_bytes"] = int(match[1])
        except (subprocess.TimeoutExpired, ValueError, OSError) as error:
            record.update(wall_s=time.perf_counter() - start, error=str(error))
    print(f"{name:16} {iteration}: {record['wall_s']:.3f}s {'OK' if record['success'] else record['error']}", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookies", type=Path, required=True)
    parser.add_argument("--binary", type=Path, default=ROOT.parent / "artifacts/osx-arm64/yt-dlp-explode")
    parser.add_argument("--yt-dlp", type=Path, default=shutil.which("yt-dlp"))
    parser.add_argument("--url", default="https://www.youtube.com/watch?v=4Ff0xc9M8kA")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cold-cache", action="store_true", help="disable both tools' disk caches for every invocation")
    parser.add_argument("--max-median", type=float, help="fail if yt-dlp-explode's median exceeds this many seconds")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    if not args.yt_dlp:
        parser.error("yt-dlp is required on PATH or via --yt-dlp")
    args.cookies = args.cookies.expanduser().resolve(strict=True)
    args.binary = args.binary.expanduser().absolute()
    args.yt_dlp = args.yt_dlp.expanduser().absolute()
    output = (args.output or ROOT.parent / "artifacts/benchmarks" / datetime.now().strftime("%Y%m%d-%H%M%S")).resolve()
    output.mkdir(parents=True, exist_ok=False)
    variants = [("yt-dlp-explode", args.binary), ("yt-dlp", args.yt_dlp)]
    versions = {name: subprocess.check_output([str(binary), "--version"], text=True).strip() for name, binary in variants}
    hashes = {name: hashlib.sha256(binary.read_bytes()).hexdigest() for name, binary in variants}
    report = {
        "date_utc": datetime.now(timezone.utc).isoformat(), "platform": platform.platform(),
        "video_url": args.url, "executables": {name: str(binary) for name, binary in variants},
        "versions": versions, "executable_sha256": hashes,
        "binary_bytes": args.binary.stat().st_size, "max_median_s": args.max_median,
        "method": "Direct CLIs, identical flags, normal user config discovery, fresh process/output/cookie copy each run. One excluded warmup starting with an empty tool cache, alternating order, two-second pauses outside timing. Wall includes process startup, extraction, subtitle download/write and cookie save. Build, cookie copying and output validation excluded. macOS time -l measures child peak RSS.",
        "cache_policy": "disabled for both tools" if args.cold_cache else "same initially empty cache directory, reused after excluded warmup; no caption cache",
        "runs": [],
    }
    for iteration in range(args.runs + 1):
        order = variants if iteration % 2 == 0 else variants[::-1]
        for name, binary in order:
            report["runs"].append(run_one(name, binary, iteration, args, output))
            (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
            time.sleep(2)
    report["summary"] = {}
    for name, _ in variants:
        runs = [r for r in report["runs"] if r["tool"] == name and not r["warmup"]]
        successful = [r for r in runs if r["success"]]
        summary = {"successes": len(successful), "attempts": len(runs)}
        if successful:
            times = [r["wall_s"] for r in successful]
            summary.update(median_wall_s=statistics.median(times), min_wall_s=min(times), max_wall_s=max(times))
            if all("peak_rss_bytes" in r for r in successful):
                summary["median_peak_rss_bytes"] = statistics.median(r["peak_rss_bytes"] for r in successful)
        report["summary"][name] = summary
    report["matching_transcripts"] = len({r["normalized_sha256"] for r in report["runs"] if r["success"] and not r["warmup"]}) == 1
    report["executables_unchanged"] = all(
        hashlib.sha256(binary.read_bytes()).hexdigest() == hashes[name]
        and subprocess.check_output([str(binary), "--version"], text=True).strip() == versions[name]
        for name, binary in variants
    )
    success = report["executables_unchanged"] and report["matching_transcripts"] and all(s["successes"] == args.runs for s in report["summary"].values())
    if success:
        native = report["summary"]["yt-dlp-explode"]["median_wall_s"]
        report["speed_ratio"] = report["summary"]["yt-dlp"]["median_wall_s"] / native
        report["target_met"] = args.max_median is None or native <= args.max_median
        success = report["target_met"]
    (output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["summary"], indent=2))
    print(f"Matching: {report['matching_transcripts']}; artifacts: {output}")
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())

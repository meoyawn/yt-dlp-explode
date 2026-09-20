#!/usr/bin/env python3
"""Exercise the published native entry point without YouTube or real cookies."""
from pathlib import Path
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve(strict=True))
cases = [
    ([], 2),
    (["--bogus"], 2),
    (["--skip-download", "invalid-video-id"], 1),
    (["--skip-download", "4Ff0xc9M8kA", "--sub-langs"], 2),
    (["--cookies", "missing", "--no-cookies", "--skip-download", "invalid-video-id"], 1),
    (["--help"], 0),
    (["--version"], 0),
]
for args, expected in cases:
    result = subprocess.run([binary, "--ignore-config", *args], capture_output=True, timeout=15)
    assert result.returncode == expected, (args, result.returncode, result.stderr)
    if expected:
        assert not result.stdout, args
    else:
        assert result.stdout and not result.stderr
with tempfile.TemporaryDirectory() as directory:
    cookie = Path(directory) / "cookies.txt"
    cookie.write_text("[]", encoding="utf-8")
    result = subprocess.run([binary, "--ignore-config", "--cookies", str(cookie), "--skip-download", "4Ff0xc9M8kA"], capture_output=True, timeout=15)
    assert result.returncode == 1 and not result.stdout
    assert cookie.read_text(encoding="utf-8") == "[]"
print("8 native CLI smoke checks passed.")

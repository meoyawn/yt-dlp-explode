#!/usr/bin/env python3
"""Archive a published executable with documentation, licenses, and a checksum."""

import hashlib
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import zipfile


root = Path(__file__).resolve().parent.parent
rid = sys.argv[1]
binary_name = "yt-dlp-explode.exe" if rid.startswith("win-") else "yt-dlp-explode"
binary = root / "artifacts" / rid / binary_name
if not binary.is_file():
    raise SystemExit(f"Missing published executable: {binary}")

dist = root / "artifacts/dist"
dist.mkdir(parents=True, exist_ok=True)
name = f"yt-dlp-explode-{rid}"
with tempfile.TemporaryDirectory() as temporary:
    package = Path(temporary) / name
    package.mkdir()
    shutil.copy2(binary, package / binary_name)
    for filename in ("README.md", "LICENSE"):
        shutil.copy2(root / filename, package / filename)
    shutil.copytree(root / "licenses", package / "licenses")
    (package / "SHA256SUMS").write_text(
        f"{hashlib.sha256(binary.read_bytes()).hexdigest()}  {binary_name}\n",
        encoding="utf-8",
    )
    if rid.startswith("win-"):
        archive = dist / f"{name}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
            for path in sorted(package.rglob("*")):
                if path.is_file():
                    output.write(path, path.relative_to(package.parent))
    else:
        archive = dist / f"{name}.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            output.add(package, arcname=name)

(dist / f"{archive.name}.sha256").write_text(
    f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n", encoding="utf-8"
)
print(archive)

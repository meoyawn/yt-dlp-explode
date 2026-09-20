#!/usr/bin/env bun
import { $ } from "bun";
import { cp, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Archive a published executable with documentation, licenses, and checksums. */
export async function packageExecutable(rid: string, root = resolve(import.meta.dir, "..")) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(rid)) {
    throw new Error(`Invalid runtime identifier: ${rid}`);
  }
  const binaryName = rid.startsWith("win-") ? "yt-dlp-explode.exe" : "yt-dlp-explode";
  const binary = join(root, "artifacts", rid, binaryName);
  if (!(await stat(binary).catch(() => undefined))?.isFile()) {
    throw new Error(`Missing published executable: ${binary}`);
  }
  const dist = join(root, "artifacts", "dist");
  await $`mkdir -p ${dist}`;
  const name = `yt-dlp-explode-${rid}`;
  const archive = join(dist, `${name}.${rid.startsWith("win-") ? "zip" : "tar.gz"}`);
  const temporary = await mkdtemp(join(tmpdir(), "explode-package-"));
  try {
    const directory = join(temporary, name);
    await $`mkdir -p ${directory}`;
    await cp(binary, join(directory, binaryName), { preserveTimestamps: true });
    for (const filename of ["README.md", "COMPATIBILITY.md", "LICENSE"]) {
      await cp(join(root, filename), join(directory, filename), {
        preserveTimestamps: true,
      });
    }
    await $`mkdir -p ${join(directory, "licenses")}`;
    await cp(join(root, "external", "YoutubeExplode", "License.txt"), join(directory, "licenses", "YoutubeExplode.txt"), {
      preserveTimestamps: true,
    });
    const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(binary).arrayBuffer()).digest("hex");
    await Bun.write(join(directory, "SHA256SUMS"), `${hash}  ${binaryName}\n`);
    if (rid.startsWith("win-")) {
      await $`tar -a -cf ${archive} -C ${temporary} ${name}`;
    } else {
      await $`tar -czf ${archive} -C ${temporary} ${name}`;
    }
  } finally {
    await $`rm -rf ${temporary}`;
  }
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(archive).arrayBuffer()).digest("hex");
  await Bun.write(`${archive}.sha256`, `${hash}  ${name}.${rid.startsWith("win-") ? "zip" : "tar.gz"}\n`);
  return archive;
}

if (import.meta.main) {
  if (Bun.argv.length !== 3 || ["-h", "--help"].includes(Bun.argv[2])) {
    console.log("Usage: bun scripts/package.ts <runtime-identifier>");
    process.exit(Bun.argv.length === 3 ? 0 : 2);
  }
  try {
    console.log(await packageExecutable(Bun.argv[2]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

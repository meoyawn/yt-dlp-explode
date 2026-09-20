#!/usr/bin/env bun
import { $ } from "bun";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

async function writeChecksum(file: string, output: string) {
  const hash = Bun.SHA256.hash(await Bun.file(file).bytes(), "hex");
  await Bun.write(output, `${hash}  ${basename(file)}\n`);
}

/** Archive a published executable with documentation, licenses, and checksums. */
export async function packageExecutable(rid: string, root = resolve(import.meta.dir, "..")) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(rid)) {
    throw new Error(`Invalid runtime identifier: ${rid}`);
  }
  const windows = rid.startsWith("win-");
  const binaryName = windows ? "yt-dlp-explode.exe" : "yt-dlp-explode";
  const binary = join(root, "artifacts", rid, binaryName);
  const dist = join(root, "artifacts", "dist");
  const name = `yt-dlp-explode-${rid}`;
  const archive = join(dist, `${name}.${windows ? "zip" : "tar.gz"}`);
  const temporary = await mkdtemp(join(tmpdir(), "explode-package-"));
  try {
    const directory = join(temporary, name);
    await $`mkdir -p ${dist} ${join(directory, "licenses")}`;
    await $`cp -p ${binary} README.md COMPATIBILITY.md LICENSE ${directory}`.cwd(root);
    await $`cp -p external/YoutubeExplode/License.txt ${join(directory, "licenses", "YoutubeExplode.txt")}`.cwd(root);
    await writeChecksum(binary, join(directory, "SHA256SUMS"));
    await $`tar ${windows ? "-acf" : "-czf"} ${archive} -C ${temporary} ${name}`;
  } finally {
    await $`rm -rf ${temporary}`;
  }
  await writeChecksum(archive, `${archive}.sha256`);
  return archive;
}

if (import.meta.main) {
  if (Bun.argv.length !== 3 || ["-h", "--help"].includes(Bun.argv[2])) {
    console.log("Usage: bun scripts/package.ts <runtime-identifier>");
    process.exit(Bun.argv.length === 3 ? 0 : 2);
  }
  console.log(await packageExecutable(Bun.argv[2]));
}

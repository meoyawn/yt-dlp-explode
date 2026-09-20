import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { packageExecutable } from "./package.ts";
import { runWithTimeout } from "./process.ts";

describe("native packaging", () => {
  for (const rid of ["linux-x64", "win-x64"]) {
    test.skipIf(rid.startsWith("win-") && process.platform === "linux")(`${rid} archive contents and checksums`, async () => {
      const root = await mkdtemp(join(tmpdir(), "explode package space-"));
      try {
        const binaryName = rid.startsWith("win-") ? "yt-dlp-explode.exe" : "yt-dlp-explode";
        await mkdir(join(root, "artifacts", rid), { recursive: true });
        await mkdir(join(root, "licenses"));
        const binary = join(root, "artifacts", rid, binaryName);
        await Bun.write(binary, "synthetic executable\n");
        await chmod(binary, 0o755);
        for (const file of ["README.md", "COMPATIBILITY.md", "LICENSE", "licenses/YoutubeExplode.txt"]) {
          await Bun.write(join(root, file), `contents of ${file}\n`);
        }
        const archive = await packageExecutable(rid, root);
        const archiveData = await Bun.file(archive).bytes();
        const magic = Array.from(archiveData.slice(0, 2));
        expect(magic).toEqual(rid.startsWith("win-") ? [0x50, 0x4b] : [0x1f, 0x8b]);
        const hash = new Bun.CryptoHasher("sha256").update(archiveData).digest("hex");
        expect(await Bun.file(`${archive}.sha256`).text()).toEqual(`${hash}  ${basename(archive)}\n`);
        const extracted = join(root, "extracted");
        await mkdir(extracted);
        await $`tar -xf ${archive} -C ${extracted}`;
        const directory = join(extracted, `yt-dlp-explode-${rid}`);
        expect(await Bun.file(join(directory, binaryName)).text()).toEqual("synthetic executable\n");
        if (process.platform !== "win32" && !rid.startsWith("win-")) {
          expect((await stat(join(directory, binaryName))).mode & 0o777).toEqual(0o755);
        }
        const binaryHash = new Bun.CryptoHasher("sha256").update(await Bun.file(binary).bytes()).digest("hex");
        expect(await Bun.file(join(directory, "SHA256SUMS")).text()).toEqual(`${binaryHash}  ${binaryName}\n`);
        for (const file of ["README.md", "COMPATIBILITY.md", "LICENSE", "licenses/YoutubeExplode.txt"]) {
          expect(await Bun.file(join(directory, file)).text()).toEqual(`contents of ${file}\n`);
        }
      } finally {
        await $`rm -rf ${root}`;
      }
    });
  }

  test("missing executable and unsafe runtime identifier fail", async () => {
    const root = await mkdtemp(join(tmpdir(), "explode-package-missing-"));
    try {
      await expect(packageExecutable("linux-x64", root)).rejects.toThrow("Missing published executable");
      await expect(packageExecutable("../escape", root)).rejects.toThrow("Invalid runtime identifier");
    } finally {
      await $`rm -rf ${root}`;
    }
  });
});

describe("command capture and deadlines", () => {
  test("captures both streams and preserves failure status and literal arguments", async () => {
    const value = "space ; $(not-a-command) ' quote";
    const result = await runWithTimeout([
      process.execPath, "-e",
      "process.stdout.write(Bun.argv.at(-1)); process.stderr.write('failure'); process.exitCode = 7;",
      "--", value,
    ], 5_000);
    expect(result.exitCode).toEqual(7);
    expect(result.stdout.toString()).toEqual(value);
    expect(result.stderr.toString()).toEqual("failure");
  });

  test("terminates commands that exceed their deadline", async () => {
    const start = performance.now();
    await expect(runWithTimeout([process.execPath, "-e", "await Bun.sleep(60_000)"], 100))
      .rejects.toThrow("command timed out");
    expect(performance.now() - start).toBeLessThan(5_000);
  });
});

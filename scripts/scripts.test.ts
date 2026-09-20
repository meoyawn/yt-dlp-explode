import { describe, expect, test } from "bun:test";
import { runWithTimeout } from "./process.ts";

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

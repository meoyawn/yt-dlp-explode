/** Capture a command and stop it when its deadline expires. */
export async function runWithTimeout(
  command: string[],
  timeoutMs: number,
  env = process.env,
) {
  // Bun Shell has no cancellation API; timed commands need a process handle.
  const signal = AbortSignal.timeout(timeoutMs);
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env,
    signal,
    killSignal: "SIGKILL",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    new Response(child.stderr).bytes(),
  ]);
  if (signal.aborted) throw new Error(`command timed out after ${timeoutMs / 1000} seconds`);
  return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
}

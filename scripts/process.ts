/** Capture a command and stop it when its deadline expires. */
export async function runWithTimeout(
  command: string[],
  timeoutMs: number,
  env = process.env,
) {
  // Bun Shell has no cancellation API; timed commands need a process handle.
  const child = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  let timedOut = false;
  const timer = setTimeout(function expire() {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).arrayBuffer(),
    ]);
    if (timedOut) throw new Error(`command timed out after ${timeoutMs / 1000} seconds`);
    return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
  } finally {
    clearTimeout(timer);
  }
}

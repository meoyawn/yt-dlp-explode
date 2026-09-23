import { $ } from "bun";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const target = Bun.argv[2];
if (target && !/^bun-(?:darwin|linux|windows)-(?:x64|arm64)(?:-musl)?$/.test(target))
  throw new Error("Expected a Bun compile target, e.g. bun-linux-x64.");
const output = join(root, "artifacts", target ?? `${process.platform}-${process.arch}`, "yt-dlp-explode");
await $`bun build --compile --format esm --minify --sourcemap --bytecode --keep-names --no-compile-autoload-dotenv --no-compile-autoload-bunfig ${target ? [`--target=${target}`] : []} ${join(root, "src/cli.ts")} --outfile ${output}`;

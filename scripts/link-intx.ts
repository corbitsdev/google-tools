import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const interchangeRoot = resolve(root, "../interchange");
const sourceRoot = join(interchangeRoot, "node_modules/@intx");
const destinationRoot = join(root, "node_modules/@intx");
const packages: readonly string[] = [
  "agent",
  "types",
  "inference",
  "log",
  "mime",
  "crypto",
];

if (!existsSync(sourceRoot)) {
  console.warn(`link-intx: ${sourceRoot} not found — skip`);
  process.exit(0);
}

mkdirSync(destinationRoot, { recursive: true });
for (const name of packages) {
  const source = join(sourceRoot, name);
  const destination = join(destinationRoot, name);
  if (!existsSync(source)) {
    console.warn(`link-intx: missing ${source} — skip`);
    continue;
  }
  rmSync(destination, { recursive: true, force: true });
  symlinkSync(source, destination);
  console.log(`link-intx: @intx/${name} -> ${source}`);
}

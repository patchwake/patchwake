import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = ["package.json", "packages/create-patchwake/package.json"].map(
  (path) => JSON.parse(readFileSync(resolve(root, path), "utf8")),
);
const version = packages[0].version;
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  packages.some((pkg) => pkg.version !== version)
) {
  throw new Error("Both packages must have the same stable release version.");
}
if (process.env.GITHUB_REF !== `refs/tags/v${version}`) {
  throw new Error(
    `Expected tag v${version}; received ${process.env.GITHUB_REF ?? "no GITHUB_REF"}.`,
  );
}
if (!["check", "publish"].includes(process.argv[2]))
  throw new Error("Usage: node scripts/release.mjs check|publish");
console.log(`Validated v${version}.`);
if (process.argv[2] === "publish") {
  for (const pkg of packages) {
    const artifact = resolve(root, ".release", `${pkg.name}-${version}.tgz`);
    const integrity = `sha512-${createHash("sha512").update(readFileSync(artifact)).digest("base64")}`;
    const existing = spawnSync(
      "npm",
      [
        "view",
        `${pkg.name}@${version}`,
        "dist.integrity",
        "--json",
        "--registry=https://registry.npmjs.org",
      ],
      { encoding: "utf8" },
    );
    if (existing.error) throw existing.error;
    if (existing.status === 0) {
      if (JSON.parse(existing.stdout) !== integrity)
        throw new Error(
          `${pkg.name}@${version} already exists with different contents. Never overwrite a release; choose a new version.`,
        );
      console.log(
        `${pkg.name}@${version} already published with matching integrity; skipping.`,
      );
      continue;
    }
    // Authentication and transport errors must not be treated as absence.
    let error;
    try {
      error = JSON.parse(existing.stdout).error;
    } catch {
      /* report below */
    }
    if (error?.code !== "E404")
      throw new Error(
        `Could not check ${pkg.name}@${version}: ${existing.stderr}`,
      );
    execFileSync(
      "npm",
      [
        "publish",
        artifact,
        "--provenance",
        "--access",
        "public",
        "--registry=https://registry.npmjs.org",
      ],
      { stdio: "inherit" },
    );
  }
}

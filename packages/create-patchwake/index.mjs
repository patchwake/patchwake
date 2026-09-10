#!/usr/bin/env node
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

export function createProject(directory) {
  const target = resolve(directory);
  const name = basename(target);
  if (
    !/^[a-z0-9][a-z0-9._-]*$/.test(name) ||
    name.length > 214 ||
    name === "node_modules"
  ) {
    throw new Error(
      "Choose a directory name using lowercase letters, numbers, dots, hyphens, or underscores.",
    );
  }
  // Refuse even a single dotfile: never merge a scaffold into existing work.
  try {
    if (readdirSync(target).length)
      throw new Error(`Directory is not empty: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const template = fileURLToPath(new URL("./template/", import.meta.url));
  const manifest = JSON.parse(
    readFileSync(resolve(template, "package.json"), "utf8"),
  );
  manifest.name = name;
  mkdirSync(target, { recursive: true });
  cpSync(template, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  writeFileSync(
    resolve(target, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // npm excludes .gitignore from tarballs; store it under another name.
  renameSync(resolve(target, "gitignore"), resolve(target, ".gitignore"));
  writeFileSync(
    resolve(target, ".env"),
    readFileSync(resolve(target, ".env.example")),
    { mode: 0o600, flag: "wx" },
  );
  return target;
}

function npm(args, cwd) {
  // npm_execpath is present under npm create/npx. Use the current Node binary
  // without a shell, including when the install path contains spaces.
  const cli = process.env.npm_execpath;
  const result = spawnSync(
    cli ? process.execPath : "npm",
    cli ? [cli, ...args] : args,
    {
      cwd,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `npm ${args.join(" ")} failed. Your project is saved at ${cwd}; fix the reported prerequisite, then run npm install and npm run build there.`,
    );
}

export function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "no-install": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm create patchwake@latest <directory> [-- --no-install]\nCreate a Trello + GitHub workflow to customize with your coding agent.\nRequires Node.js 22+, Linux or macOS, Python, and a C/C++ build toolchain.\n--no-install writes the project without installing dependencies or building.",
    );
    return;
  }
  if (
    Number(process.versions.node.split(".")[0]) < 22 ||
    !["linux", "darwin"].includes(process.platform)
  ) {
    throw new Error("Patchwake requires Node.js 22+ on Linux or macOS.");
  }
  if (positionals.length !== 1)
    throw new Error(
      "Supply one directory: npm create patchwake@latest my-workflow",
    );
  const target = createProject(positionals[0]);
  if (!values["no-install"]) {
    console.log(
      "Installing dependencies (fs-ext requires Python and a C/C++ build toolchain)…",
    );
    npm(["install"], target);
    npm(["run", "build"], target);
  }
  console.log(
    `\nCreated ${target}\n\nOpen this directory in your coding agent and read skills/build-orchestrator/SKILL.md.\nEdit .env, install and authenticate your agent CLI, then run:\n${values["no-install"] ? "  npm install\n  npm run build\n" : ""}  npm test\n  npm run dry-run\n  npm start\n  npm run status\n\nRead README.md before scheduling unattended ticks.`,
  );
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const creator = JSON.parse(
  readFileSync(resolve(root, "packages/create-patchwake/package.json"), "utf8"),
);
if (creator.version !== manifest.version)
  throw new Error(
    "Release patchwake and create-patchwake with matching versions.",
  );
const target = resolve(root, "packages/create-patchwake/template");
rmSync(target, { recursive: true, force: true });
mkdirSync(resolve(target, "workflow"), { recursive: true });
for (const path of ["templates", "skills", "docs", ".env.example"]) {
  cpSync(resolve(root, path), resolve(target, path), { recursive: true });
}
for (const path of ["orchestrator.ts", "adapters.ts"]) {
  let source = readFileSync(
    resolve(root, "examples/trello_github", path),
    "utf8",
  )
    .replaceAll(/\.\.\/\.\.\/patchwake\/([a-z-]+)\.js/g, "patchwake/$1")
    .replace('"../../.."', '"../.."');
  // Generated workflows own their paths; schedulers can run them from any cwd.
  source = source
    .replace(
      "env.PATCHWAKE_ROOT || process.cwd()",
      "env.PATCHWAKE_ROOT || PACKAGE_ROOT",
    )
    .replace("or the current directory.", "or this workflow project.");
  writeFileSync(resolve(target, "workflow", path), source);
}
cpSync(
  resolve(root, "examples/trello_github/README.md"),
  resolve(target, "workflow/README.md"),
);
cpSync(
  resolve(root, "packages/create-patchwake/project-README.md"),
  resolve(target, "README.md"),
);
cpSync(
  resolve(root, "packages/create-patchwake/workflow.test.mjs"),
  resolve(target, "workflow.test.mjs"),
);
writeFileSync(
  resolve(target, "AGENTS.md"),
  `# Build this workflow\n\nRead skills/build-orchestrator/SKILL.md before changing the workflow.\n\nEdit workflow/orchestrator.ts, workflow/adapters.ts, and templates/task/.\nImport the engine and contracts from patchwake; do not edit node_modules.\nThe installed source contracts are in node_modules/patchwake/patchwake/.\nValidate with npm run build, npm run typecheck, and npm test. Use fixtures\nbefore live provider reads; never run real ticks as part of a test.\nKeep .env and var/ out of source control.\n`,
);
writeFileSync(
  resolve(target, "gitignore"),
  "node_modules/\ndist/\nvar/\n.env\n*.tgz\n*.tsbuildinfo\n",
);
writeFileSync(
  resolve(target, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        rootDir: "workflow",
        outDir: "dist/workflow",
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        verbatimModuleSyntax: true,
        noEmitOnError: true,
        types: ["node"],
      },
      include: ["workflow/**/*.ts"],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  resolve(target, "package.json"),
  JSON.stringify(
    {
      name: "patchwake-workflow",
      version: "0.1.0",
      private: true,
      type: "module",
      engines: manifest.engines,
      os: manifest.os,
      scripts: {
        build: "tsc -p tsconfig.json",
        typecheck: "tsc -p tsconfig.json --noEmit",
        test: "npm run build && node --test workflow.test.mjs",
        "dry-run":
          "node --env-file=.env dist/workflow/orchestrator.js --dry-run",
        start: "node --env-file=.env dist/workflow/orchestrator.js",
        status: "node --env-file=.env dist/workflow/orchestrator.js --status",
      },
      dependencies: { patchwake: manifest.version },
      allowScripts: manifest.allowScripts,
      devDependencies: {
        "@types/node": manifest.devDependencies["@types/node"],
        typescript: manifest.devDependencies.typescript,
      },
    },
    null,
    2,
  ) + "\n",
);
// Preserve the upstream notice in both the npm package and copied starter.
cpSync(
  resolve(root, "LICENSE"),
  resolve(root, "packages/create-patchwake/LICENSE"),
);
cpSync(resolve(root, "LICENSE"), resolve(target, "PATCHWAKE-LICENSE"));
console.log(
  `Prepared create-patchwake ${creator.version} with patchwake ${manifest.version}.`,
);

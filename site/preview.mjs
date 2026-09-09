import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["style.css", "text/css; charset=utf-8"],
  ["app.js", "text/javascript; charset=utf-8"],
  ["mark.svg", "image/svg+xml"],
]);
const port = Number(process.env.PATCHWAKE_SITE_PORT || 4173);
const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const pathname = new URL(request.url, "http://localhost").pathname;
  const name =
    pathname === "/" || pathname === "/patchwake/"
      ? "index.html"
      : pathname.replace(/^\/(?:patchwake\/)?/, "");
  if (!files.has(name)) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(new URL(name, import.meta.url));
    response.writeHead(200, {
      "Content-Type": files.get(name),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(500).end("Could not read site asset");
  }
});
server.on("error", (error) => {
  console.error(`Preview failed: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Patchwake preview: http://127.0.0.1:${port}/patchwake/`),
);

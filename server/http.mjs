import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setLocale, t } from "../shared/messages.mjs";
import { blocks } from "./blocks.mjs";
import { ApiError, APP_DIR, SHARED_DIR, isInside } from "./common.mjs";
import { assertEndpointTable, contractEntry, publicContract, routeKey } from "./contract.mjs";
import { createKernel } from "./kernel/index.mjs";
import { validateEndpointPayload } from "./validate.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 2_000_000) throw new ApiError(413, t("请求体过大"));
  }
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    throw new ApiError(400, t("请求体不是合法 JSON"));
  }
}

async function serveStatic(res, pathname, { appDir, sharedDir }) {
  const clean = pathname.replace(/^\/+/, "");
  const isShared = clean === "shared" || clean.startsWith("shared/");
  const root = isShared ? sharedDir : appDir;

  /* 用 stat 而不是 access 判断 UI 在不在：打包后 app/ 在 app.asar 里，
   * Electron 的 fs.access 对 asar 内的目录会误报 ENOENT（文件本身能正常读），
   * 结果就是装好的包里主界面返回 "UI not installed"。stat/readdir/readFile 都正常。 */
  const available = await fsp.stat(root).then(() => true, () => false);
  if (!available) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("UI not installed");
  }

  // 兼容 /app/... 的旧地址；appDir 指到哪里，静态根就是哪里。
  const rel = isShared
    ? clean.slice("shared/".length)
    : clean === ""
      ? "index.html"
      : clean.startsWith("app/")
        ? clean.slice(4)
        : clean;
  const abs = path.join(root, rel);
  if (!isInside(root, abs)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await fsp.readFile(abs);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(abs)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function matchRoute(route, method, pathname) {
  if (route.method !== method) return null;
  if (route.path) return route.path === pathname ? [] : null;
  return pathname.match(route.pattern);
}

function queryObject(url) {
  const out = {};
  for (const [key, value] of url.searchParams) out[key] = value;
  return out;
}

export async function createServer({
  port = 4173,
  host = "127.0.0.1",
  tools,
  appDir = APP_DIR,
  sharedDir = SHARED_DIR,
} = {}) {
  const kernel = createKernel({ context: { tools } });
  kernel.defineAll(blocks);
  const booted = await kernel.boot();
  const services = booted.apis;

  if (booted.meta.flow?.recovered || booted.meta.runtime?.recovered) {
    await services.store.saveState();
  }
  const routes = [
    ...booted.routes,
    { method: "GET", path: "/api/contract", handler: () => publicContract() },
  ];
  assertEndpointTable(routes);

  async function handleApi(req, res, url) {
    const { pathname } = url;
    for (const route of routes) {
      const params = matchRoute(route, req.method, pathname);
      if (!params) continue;
      const body = req.method === "GET" ? {} : await readBody(req);
      validateEndpointPayload(contractEntry(routeKey(route)), { body, query: queryObject(url) });
      const payload = await route.handler({ body, params, url });
      return json(res, 200, payload);
    }
    throw new ApiError(404, "Not found");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const requestedLocale = req.headers["x-pi-locale"];
    if (requestedLocale) setLocale(String(requestedLocale));
    try {
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else await serveStatic(res, url.pathname, { appDir, sharedDir });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (!res.headersSent) json(res, status, { error: error.message });
      if (status >= 500) console.error(error);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        url: `http://${host}:${actual}`,
        apis: {
          agents: services.agents,
          agentconfig: services.agentconfig,
          flows: services.flow,
          artifacts: services.artifacts,
          pi: services.pi,
          runtime: services.runtime,
          registry: services.registry,
          tools: services.tools,
          store: services.store,
          single: services.single,
        },
      });
    });
  });
}

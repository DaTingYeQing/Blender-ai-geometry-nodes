import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createServer as createAgents } from "../../modules/agents/index.mjs";
import { createServer as createArtifacts } from "../../modules/artifacts/index.mjs";
import { createServer as createFlow } from "../../modules/flow/index.mjs";
import { createServer as createPi } from "../../modules/pi/index.mjs";
import { createServer as createRuntime } from "../../modules/runtime/index.mjs";
import { setLocale, t } from "../../app/js/core/i18n.mjs";
import { ApiError, ROOT_DIR } from "./store.mjs";
import { launchSingle } from "./single.mjs";
import * as store from "./store.mjs";

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

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "app/index.html" : pathname.replace(/^\/+/, "");
  const abs = path.join(ROOT_DIR, rel);
  const allowed = ["app", "modules"].some((dir) => store.isInside(path.join(ROOT_DIR, dir), abs));
  if (!allowed) {
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

export async function createServer({ port = 4173, host = "127.0.0.1" } = {}) {
  const agentsModule = await createAgents({ store });
  const artifactsModule = await createArtifacts({ store, agents: agentsModule.api });
  const flowModule = await createFlow({
    store,
    onDelete: (flowId) => artifactsModule.api.removeWorkspaces(flowId),
  });
  const piModule = await createPi({ store });
  const runtimeModule = await createRuntime({
    store,
    agents: agentsModule.api,
    artifacts: artifactsModule.api,
    pi: piModule.api,
  });
  if (flowModule.recovered || runtimeModule.recovered) await store.saveState();
  const modules = [agentsModule, flowModule, artifactsModule, piModule, runtimeModule];
  const routes = modules.flatMap((module) => module.routes);

  async function handleApi(req, res, url) {
    const { pathname } = url;
    if (req.method === "GET" && pathname === "/api/state") {
      return json(res, 200, {
        agents: agentsModule.api.list(),
        flows: flowModule.api.list(),
        mode: "pi",
      });
    }

    if (req.method === "POST" && pathname === "/api/single/launch") {
      return json(res, 200, launchSingle({ resolveExtensions: piModule.api.resolveProjectExtensions }));
    }

    for (const route of routes) {
      const params = matchRoute(route, req.method, pathname);
      if (!params) continue;
      const payload = await route.handler({
        body: req.method === "GET" ? {} : await readBody(req),
        params,
        url,
      });
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
      else await serveStatic(res, url.pathname);
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
      resolve({ server, port: actual, url: `http://${host}:${actual}` });
    });
  });
}

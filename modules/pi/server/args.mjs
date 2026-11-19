import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildPiFlags } from "../../../shared/pi-args.mjs";

/** 优先环境变量，其次全局 npm root，最后兜底 APPDATA 下的常规安装路径。 */
export function resolvePiBin() {
  if (process.env.PI_BIN) return process.env.PI_BIN;

  const candidates = [];
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    candidates.push(path.join(root, "@earendil-works/pi-coding-agent/dist/bundle/cli.js"));
    candidates.push(path.join(root, "@earendil-works/pi-coding-agent/dist/cli.js"));
  } catch {
    // npm 不可用时继续走兜底
  }
  candidates.push(
    path.join(process.env.APPDATA || "", "npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
    path.join(process.env.APPDATA || "", "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  );

  return candidates.find((file) => fs.existsSync(file)) || "pi";
}

export const PI_BIN = resolvePiBin();

export function buildPiArgs(options = {}) {
  return [PI_BIN, ...buildPiFlags(options)];
}

export function piAvailable(bin = PI_BIN) {
  if (!bin) return false;
  if (!path.isAbsolute(bin) && !bin.includes("/") && !bin.includes("\\")) return true;
  return fs.existsSync(bin);
}

let cachedVersion;

/** 从 pi 的 package.json 读版本；读不到返回 null，不影响启动。 */
export function readPiVersion(bin = PI_BIN) {
  if (cachedVersion !== undefined) return cachedVersion;
  cachedVersion = null;

  if (!bin || !fs.existsSync(bin)) return cachedVersion;
  let dir = path.dirname(bin);
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.name === "@earendil-works/pi-coding-agent") {
        cachedVersion = String(pkg.version || "");
        break;
      }
    } catch {
      // 继续往上找
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cachedVersion;
}

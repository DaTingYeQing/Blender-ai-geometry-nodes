// 生成更新清单 update.json：程序版本 + 两个运行时包的 ID / 大小 / sha256 / 多源地址。
//
// 用法：
//   node scripts/build/update-manifest.mjs
//   node scripts/build/update-manifest.mjs --check
//   node scripts/build/update-manifest.mjs --release-dir <目录> --assets-dir <目录> --base-url <URL>
//
// 约定：
//   - 程序版本来自 package.json；tag / latest.yml / update.json 必须一致。
//   - Blender / CovTrace 的 id 是压缩包内容哈希，文件没变就不变。
//   - 地址默认按 GitHub Release 生成，国内代理在前；可用 --base-url 覆盖。
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const GH_MIRRORS = ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"];

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

const RELEASE_DIR = path.resolve(argValue("--release-dir", path.join(ROOT, "release")));
const ASSETS_DIR = path.resolve(argValue("--assets-dir", path.join(ROOT, "resources", "blender")));
const BASE_URL = String(argValue("--base-url", "")).trim().replace(/\/+$/, "");
const CHECK_ONLY = process.argv.includes("--check");
const STDOUT = process.argv.includes("--stdout");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

const pkg = readJson(path.join(ROOT, "package.json"));
const versions = readJson(path.join(ROOT, "shard", "versions.json"));

async function hashFile(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .once("end", resolve)
      .once("error", reject);
  });
  return hash.digest("hex");
}

async function fileInfo(file) {
  const stat = await fsp.stat(file);
  return { size: stat.size, sha256: await hashFile(file) };
}

function encodeName(name) {
  return name.split("/").map(encodeURIComponent).join("/");
}

function githubBase() {
  if (BASE_URL) return BASE_URL;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i.exec(remote);
    if (!match) return "";
    return `https://github.com/${match[1]}/${match[2]}/releases/download/v${pkg.version}`;
  } catch {
    return "";
  }
}

/** 国内代理在前；base 本身不是 GitHub 时，把 base 放第一位。 */
function urlsFor(fileName, base) {
  if (!base) return [];
  const direct = `${base}/${encodeName(fileName)}`;
  const proxied = GH_MIRRORS.map((prefix) => `${prefix}${direct}`);
  return /github\.com/i.test(base) ? [...proxied, direct] : [direct, ...proxied];
}

async function findInstaller() {
  const expected = [
    `Pi Flow Setup ${pkg.version}.exe`,
    `Pi-Flow-Setup-${pkg.version}.exe`,
  ];
  for (const name of expected) {
    const file = path.join(RELEASE_DIR, name);
    if (fs.existsSync(file)) return file;
  }
  let entries = [];
  try {
    entries = await fsp.readdir(RELEASE_DIR);
  } catch {
    throw new Error(`找不到 release 目录：${RELEASE_DIR}`);
  }
  const candidates = entries
    .filter((name) => /\.exe$/i.test(name) && !/\.blockmap$/i.test(name))
    .filter((name) => name.includes(pkg.version));
  if (!candidates.length) {
    throw new Error(
      `release 目录里没有 ${pkg.version} 的安装包（先运行 electron-builder，或用 --release-dir 指定）`,
    );
  }
  return path.join(RELEASE_DIR, candidates.sort().at(-1));
}

/** 把运行时包铺到 release/assets；同一卷用硬链接，失败再复制。 */
async function stageAsset(source, fileName, sha256, size) {
  const destDir = path.join(RELEASE_DIR, "assets");
  const dest = path.join(destDir, fileName);

  if (CHECK_ONLY) {
    if (!fs.existsSync(dest)) {
      throw new Error(`release 里缺少 ${path.relative(ROOT, dest)}（先运行 npm run pack）`);
    }
    const digest = await hashFile(dest);
    if (digest !== sha256) {
      throw new Error(`${path.relative(ROOT, dest)} 的 sha256 与源文件不一致`);
    }
    return dest;
  }

  await fsp.mkdir(destDir, { recursive: true });
  if (fs.existsSync(dest)) {
    const current = await fileInfo(dest);
    if (current.size === size && current.sha256 === sha256) return dest;
    fs.rmSync(dest, { force: true });
  }
  try {
    await fsp.link(source, dest);
  } catch {
    await fsp.copyFile(source, dest);
  }
  return dest;
}

async function assetEntry(prefix, fileName, label) {
  const file = path.join(ASSETS_DIR, fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`缺少运行时包：${file}`);
  }
  const info = await fileInfo(file);
  if (!STDOUT) await stageAsset(file, fileName, info.sha256, info.size);
  return {
    id: `${prefix}-${info.sha256.slice(0, 12)}`,
    version: label || "",
    file: fileName,
    size: info.size,
    sha256: info.sha256,
    urls: urlsFor(fileName, base),
  };
}

function checkLatestYml() {
  const file = path.join(RELEASE_DIR, "latest.yml");
  if (!fs.existsSync(file)) return;
  try {
    const text = fs.readFileSync(file, "utf8");
    const match = /^version:\s*(.+)$/m.exec(text);
    if (match && match[1].trim() !== pkg.version) {
      console.warn(
        `  警告：latest.yml 是 ${match[1].trim()}，package.json 是 ${pkg.version}`,
      );
    }
  } catch {
    // latest.yml 只做提示，不阻塞清单生成。
  }
}

const base = githubBase();
const installerFile = await findInstaller();
const installerName = path.basename(installerFile);
const installerInfo = await fileInfo(installerFile);

const manifest = {
  schema: 1,
  app: {
    version: pkg.version,
    installer: {
      file: installerName,
      size: installerInfo.size,
      sha256: installerInfo.sha256,
      urls: urlsFor(installerName, base),
    },
  },
  runtime: {
    blender: await assetEntry("b", "blender-4.5.0-trace-win64.zip", versions.blenderBuild),
    covtrace: await assetEntry("c", "covtrace-toolchain.zip", versions.covtraceVersion),
  },
};

const output = JSON.stringify(manifest, null, 2) + "\n";

if (!STDOUT) checkLatestYml();

if (STDOUT) {
  process.stdout.write(output);
} else {
  const target = path.join(RELEASE_DIR, "update.json");
  if (CHECK_ONLY) {
    if (!fs.existsSync(target)) throw new Error(`缺少 ${target}`);
    const current = fs.readFileSync(target, "utf8");
    if (current !== output) throw new Error(`${target} 与当前文件不一致`);
    console.log(`更新清单校验通过：${target}`);
  } else {
    await fsp.writeFile(target, output, "utf8");
    console.log(`已写入 ${target}`);
  }
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
console.log(`  程序      ${pkg.version}  ${mb(installerInfo.size)}  ${installerName}`);
console.log(`  Blender   ${manifest.runtime.blender.id}  ${mb(manifest.runtime.blender.size)}`);
console.log(`  CovTrace  ${manifest.runtime.covtrace.id}  ${mb(manifest.runtime.covtrace.size)}`);
if (!base) console.warn("  警告：没有下载地址（未传 --base-url，也读不到 GitHub remote）");

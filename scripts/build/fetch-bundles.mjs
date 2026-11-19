// 构建时下载离线安装包到 resources/bundles/，供打包进安装器。
// 用法：
//   npm run fetch:bundles     下载缺失的包，校验并更新 manifest.json
//   npm run check:bundles     只校验，打包前使用
// 二进制不入库（见 .gitignore），manifest.json 入库，用于固定版本和 SHA256。
//
// 注：Python 几何依赖（numpy / scipy / pyvista / trimesh / manifold3d 等）不再走
// wheelhouse 离线安装 —— 它们由编译机 pip 进 Blender 的内置 python，随
// blender-4.5.0-trace-win64.zip 一起分发。这里只剩 Git / fd / rg 三个小工具。
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BUNDLE_DIR = path.join(ROOT, "resources", "bundles");
const MANIFEST_PATH = path.join(BUNDLE_DIR, "manifest.json");
const CHECK_ONLY = process.argv.includes("--check");

const GIT_VERSION = "2.56.1";
const GIT_TAG = `v${GIT_VERSION}.windows.1`;
const FD_VERSION = "10.5.2";
const RG_VERSION = "15.2.0";

// 当前只产出 win32-x64 安装包，因此统一内置 x64 版本。
const GIT_FILE = `PortableGit-${GIT_VERSION}-64-bit.7z.exe`;
const FD_FILE = `fd-v${FD_VERSION}-x86_64-pc-windows-msvc.zip`;
const RG_FILE = `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip`;

const GH_MIRRORS = ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"];
const github = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;
const githubWithMirrors = (repo, tag, file) =>
  [...GH_MIRRORS.map((prefix) => prefix + github(repo, tag, file)), github(repo, tag, file)];

const bundles = [
  {
    name: "git",
    version: GIT_VERSION,
    file: GIT_FILE,
    minBytes: 30_000_000,
    urls: [
      `https://registry.npmmirror.com/-/binary/git-for-windows/${GIT_TAG}/${GIT_FILE}`,
      `https://mirrors.huaweicloud.com/git-for-windows/${GIT_TAG}/${GIT_FILE}`,
      ...githubWithMirrors("git-for-windows/git", GIT_TAG, GIT_FILE),
    ],
  },
  {
    name: "fd",
    version: FD_VERSION,
    file: FD_FILE,
    minBytes: 500_000,
    urls: githubWithMirrors("sharkdp/fd", `v${FD_VERSION}`, FD_FILE),
  },
  {
    name: "rg",
    version: RG_VERSION,
    file: RG_FILE,
    minBytes: 500_000,
    urls: githubWithMirrors("BurntSushi/ripgrep", RG_VERSION, RG_FILE),
  },
];

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest() {
  try {
    return JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return null;
  }
}

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

function runCurl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl 退出码 ${code}${stderr.trim() ? `：${stderr.trim()}` : ""}`));
    });
  });
}

// curl 的 --speed-limit/--speed-time 会在连接卡住时主动中断，避免构建一直挂着。
async function download(url, dest) {
  const args = ["-fLsS", "--connect-timeout", "10", "--speed-limit", "1024", "--speed-time", "45", "--max-time", "1800"];
  const size = (await exists(dest)) ? (await fsp.stat(dest)).size : 0;
  if (size > 0) args.push("-C", "-");
  args.push("-o", dest, url);
  try {
    await runCurl(args);
  } catch (error) {
    if (error.message.includes("curl 退出码 33")) {
      // 服务器不支持断点续传，丢掉残包下次从头下。
      await fsp.rm(dest, { force: true });
    }
    throw error;
  }
}

async function fetchBundle(bundle, expected) {
  const dest = path.join(BUNDLE_DIR, bundle.file);
  await fsp.mkdir(BUNDLE_DIR, { recursive: true });

  const errors = [];
  for (const url of bundle.urls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      console.log(`  下载 ${bundle.file}（${attempt}/2）：${url}`);
      try {
        await download(url, dest);
        const size = (await fsp.stat(dest)).size;
        if (size < bundle.minBytes) {
          await fsp.rm(dest, { force: true });
          throw new Error(`文件过小：${size} 字节`);
        }
        const sha256 = await hashFile(dest);
        if (expected?.sha256 && expected.sha256 !== sha256) {
          await fsp.rm(dest, { force: true });
          throw new Error(`SHA256 不匹配（期望 ${expected.sha256}，实际 ${sha256}）`);
        }
        console.log(`  完成 ${bundle.file}（${(size / 1048576).toFixed(1)} MB）`);
        return { size, sha256 };
      } catch (error) {
        errors.push(`${url} -> ${error.message}`);
        console.log(`  失败：${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  throw new Error(`${bundle.file} 下载失败：\n${errors.join("\n")}`);
}

async function main() {
  const manifest = await readManifest();
  const expected = (file) => manifest?.bundles?.[file] ?? null;
  const missing = [];
  const result = { bundles: {} };

  for (const bundle of bundles) {
    const dest = path.join(BUNDLE_DIR, bundle.file);
    const expectedInfo = expected(bundle.file);
    if (await exists(dest)) {
      const size = (await fsp.stat(dest)).size;
      const sha256 = await hashFile(dest);
      if (expectedInfo && expectedInfo.sha256 !== sha256) {
        if (CHECK_ONLY) {
          missing.push(`${bundle.file}（SHA256 不一致）`);
          continue;
        }
        console.log(`已有 ${bundle.file} 校验不一致，重新下载`);
        await fsp.rm(dest, { force: true });
      } else {
        console.log(`已存在 ${bundle.file}`);
        result.bundles[bundle.file] = { ...metadata(bundle), size, sha256 };
        continue;
      }
    }

    if (CHECK_ONLY) {
      missing.push(bundle.file);
      continue;
    }

    const info = await fetchBundle(bundle, expectedInfo);
    result.bundles[bundle.file] = { ...metadata(bundle), ...info };
  }

  if (CHECK_ONLY) {
    if (missing.length > 0) {
      throw new Error(`缺少离线安装包：\n  ${missing.join("\n  ")}\n先运行 npm run fetch:bundles`);
    }
    const bundleTotal = Object.values(result.bundles).reduce((sum, item) => sum + item.size, 0);
    console.log(
      `离线资源校验通过（安装包 ${Object.keys(result.bundles).length} 个，${(bundleTotal / 1048576).toFixed(1)} MB）`,
    );
    return;
  }

  const next = { bundles: result.bundles };
  if (JSON.stringify(next) !== JSON.stringify(manifest)) {
    await fsp.writeFile(MANIFEST_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
    console.log("已更新 resources/bundles/manifest.json（请提交到仓库）");
  }
}

function metadata(bundle) {
  return { name: bundle.name, version: bundle.version, file: bundle.file, urls: bundle.urls };
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exit(1);
});

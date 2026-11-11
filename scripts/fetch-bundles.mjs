// 构建时下载离线安装包到 resources/bundles/，供打包进安装器。
// 用法：
//   npm run fetch:bundles     下载缺失的包，校验并更新 manifest.json
//   npm run check:bundles     只校验，打包前使用
// 二进制不入库（见 .gitignore），manifest.json 入库，用于固定版本和 SHA256。
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_DIR = path.join(ROOT, "resources", "bundles");
const MANIFEST_PATH = path.join(BUNDLE_DIR, "manifest.json");
const PACKAGES_FILE = path.join(ROOT, "shard", "py_packages.json");
const WHEELS_DIR = path.join(BUNDLE_DIR, "wheels");
const WHEELS_CONSTRAINTS = path.join(BUNDLE_DIR, "wheels-constraints.txt");
const CHECK_ONLY = process.argv.includes("--check");

const PYTHON_VERSION = "3.13.17";
const GIT_VERSION = "2.56.1";
const GIT_TAG = `v${GIT_VERSION}.windows.1`;
const FD_VERSION = "10.5.2";
const RG_VERSION = "15.2.0";

// 当前只产出 win32-x64 安装包，因此统一内置 x64 版本。
const PYTHON_FILE = `python-${PYTHON_VERSION}-amd64.exe`;
const GIT_FILE = `PortableGit-${GIT_VERSION}-64-bit.7z.exe`;
const FD_FILE = `fd-v${FD_VERSION}-x86_64-pc-windows-msvc.zip`;
const RG_FILE = `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip`;

const GH_MIRRORS = ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"];
const github = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;
const githubWithMirrors = (repo, tag, file) =>
  [...GH_MIRRORS.map((prefix) => prefix + github(repo, tag, file)), github(repo, tag, file)];

const PIP_INDEXES = [
  "https://pypi.tuna.tsinghua.edu.cn/simple",
  "https://mirrors.aliyun.com/pypi/simple",
  "https://pypi.org/simple",
];

const bundles = [
  {
    name: "python",
    version: PYTHON_VERSION,
    file: PYTHON_FILE,
    minBytes: 15_000_000,
    urls: [
      `https://registry.npmmirror.com/-/binary/python/${PYTHON_VERSION}/${PYTHON_FILE}`,
      `https://mirrors.aliyun.com/python-release/windows/${PYTHON_FILE}`,
      `https://mirrors.huaweicloud.com/python/${PYTHON_VERSION}/${PYTHON_FILE}`,
      `https://www.python.org/ftp/python/${PYTHON_VERSION}/${PYTHON_FILE}`,
    ],
  },
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

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} 退出码 ${code}${stderr.trim() ? `：${stderr.trim()}` : ""}`));
    });
  });
}

function runInherit(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
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

async function readPackages() {
  const config = JSON.parse(await fsp.readFile(PACKAGES_FILE, "utf8"));
  const packages = Array.isArray(config.packages) ? config.packages.filter(Boolean) : [];
  if (packages.length === 0) throw new Error(`${PACKAGES_FILE} 里没有 packages`);
  return { python: String(config.python || "3.13"), packages };
}

async function findPython() {
  for (const [command, prefix] of [["py", ["-3.13"]], ["python", []]]) {
    try {
      const code = "import sys; print('%d.%d' % sys.version_info[:2])";
      const version = (await runCapture(command, [...prefix, "-c", code])).trim();
      if (version === "3.13") return { command, prefix };
    } catch {
      // 换下一个候选
    }
  }
  throw new Error("生成 wheelhouse 需要 Python 3.13：请安装后重试（https://www.python.org/downloads/）");
}

async function orderPipIndexes() {
  const probes = await Promise.all(
    PIP_INDEXES.map(async (url) => {
      const started = Date.now();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        await response.body?.cancel();
        return { url, latency: Date.now() - started };
      } catch {
        return { url, latency: Number.POSITIVE_INFINITY };
      }
    }),
  );
  return probes.sort((a, b) => a.latency - b.latency).map((item) => item.url);
}

async function hashWheels() {
  const names = (await fsp.readdir(WHEELS_DIR)).filter((name) => name.endsWith(".whl")).sort();
  const files = {};
  for (const name of names) {
    const file = path.join(WHEELS_DIR, name);
    const stat = await fsp.stat(file);
    files[name] = { size: stat.size, sha256: await hashFile(file) };
  }
  return files;
}

async function wheelsMatch(expected) {
  for (const [name, info] of Object.entries(expected)) {
    const file = path.join(WHEELS_DIR, name);
    if (!(await exists(file))) return false;
    if ((await fsp.stat(file)).size !== info.size) return false;
    if ((await hashFile(file)) !== info.sha256) return false;
  }
  return true;
}

function constraintsFromWheels(names) {
  const lines = new Set();
  for (const name of names) {
    const [distribution, version] = name.replace(/\.whl$/i, "").split("-");
    if (distribution && /^\d/.test(version || "")) {
      lines.add(`${distribution.replace(/_/g, "-")}==${version}`);
    }
  }
  return [...lines].sort();
}

async function ensureWheels(manifest) {
  const { packages } = await readPackages();
  const expected = manifest?.wheels?.files ?? {};
  await fsp.mkdir(WHEELS_DIR, { recursive: true });
  const existing = (await fsp.readdir(WHEELS_DIR)).filter((name) => name.endsWith(".whl"));

  if (existing.length > 0 && Object.keys(expected).length > 0 && (await wheelsMatch(expected))) {
    console.log(`wheelhouse 已存在（${existing.length} 个）`);
    return { files: expected };
  }

  if (CHECK_ONLY) {
    throw new Error("缺少 wheelhouse，先运行 npm run fetch:bundles");
  }

  const python = await findPython();
  const indexes = await orderPipIndexes();
  let lastError = null;
  for (const index of indexes) {
    const args = [
      ...python.prefix,
      "-m", "pip", "download",
      "--only-binary=:all:",
      "--dest", WHEELS_DIR,
      "--index-url", index,
      "--disable-pip-version-check",
      "--no-input",
      "--retries", "3",
      "--timeout", "60",
    ];
    if (await exists(WHEELS_CONSTRAINTS)) args.push("-c", WHEELS_CONSTRAINTS);
    args.push(...packages);
    console.log(`  下载 wheelhouse（${index}）`);
    try {
      await runInherit(python.command, args);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      console.log(`  失败：${error.message}`);
    }
  }
  if (lastError) throw new Error(`wheelhouse 下载失败：${lastError.message}`);

  const files = await hashWheels();
  if (Object.keys(expected).length > 0) {
    const mismatch = Object.keys(expected).filter(
      (name) => !files[name] || files[name].sha256 !== expected[name].sha256,
    );
    if (mismatch.length > 0) {
      throw new Error(
        `wheelhouse 与 manifest 不一致（上游文件可能变化）：\n  ${mismatch.join("\n  ")}\n` +
          "确认无误后删除 manifest.json 里的 wheels 段再重新生成。",
      );
    }
  }

  const constraints = constraintsFromWheels(Object.keys(files));
  await fsp.writeFile(WHEELS_CONSTRAINTS, constraints.join("\n") + "\n", "utf8");
  console.log(`  wheelhouse 完成（${Object.keys(files).length} 个）`);
  return { files };
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

  const wheels = await ensureWheels(manifest);
  const packagesConfig = await readPackages();

  if (CHECK_ONLY) {
    if (missing.length > 0) {
      throw new Error(`缺少离线安装包：\n  ${missing.join("\n  ")}\n先运行 npm run fetch:bundles`);
    }
    const bundleTotal = Object.values(result.bundles).reduce((sum, item) => sum + item.size, 0);
    const wheelTotal = Object.values(wheels.files).reduce((sum, item) => sum + item.size, 0);
    const total = (bundleTotal + wheelTotal) / 1048576;
    console.log(
      `离线资源校验通过（安装包 ${Object.keys(result.bundles).length} 个 + wheel ${Object.keys(wheels.files).length} 个，${total.toFixed(1)} MB）`,
    );
    return;
  }

  const next = {
    bundles: result.bundles,
    wheels: { python: packagesConfig.python, platform: "win_amd64", files: wheels.files },
  };
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

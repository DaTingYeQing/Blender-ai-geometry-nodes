import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function listFiles(dir, extensions = [".mjs"]) {
  const files = [];
  async function walk(current) {
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (extensions.includes(path.extname(entry.name))) files.push(absolute);
    }
  }
  await walk(dir);
  return files;
}

export function importSpecifiers(source) {
  return [...source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g)].map((match) => match[1]);
}

export async function browserAssetPaths() {
  const appRoot = path.join(projectRoot, "app");
  const modulesRoot = path.join(projectRoot, "modules");
  const appFiles = await listFiles(appRoot, [".mjs", ".css"]);
  const moduleFiles = (await listFiles(modulesRoot, [".mjs", ".css"])).filter((file) => {
    const parts = path.relative(modulesRoot, file).split(path.sep);
    return (parts.length === 2 && parts[1] === "index.mjs") || parts[1] === "web";
  });
  const appUrls = appFiles.map((file) => `/app/${path.relative(appRoot, file).split(path.sep).join("/")}`);
  const moduleUrls = moduleFiles.map((file) => `/${path.relative(projectRoot, file).split(path.sep).join("/")}`);
  return ["/", ...appUrls, ...moduleUrls];
}

/**
 * agents.json 的唯一结构校验。
 *
 * 服务端启动和 shard/sync.mjs 共用这一份：清单写错时两边报同样的错，
 * 不再出现「sync 能跑、应用启动静默跳过」的分叉。
 *
 * 这里只做结构和引用校验，不碰文件系统；目录是否存在由调用方诊断。
 */

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function validateManifest(raw, { file = "agents.json" } = {}) {
  if (!isObject(raw)) throw new Error(`Agent 清单 ${file} 必须是 JSON 对象`);

  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  const tools = raw.tools ?? {};
  if (!isObject(tools)) {
    fail("tools 必须是对象");
  } else {
    for (const [name, target] of Object.entries(tools)) {
      if (typeof target !== "string" || !target.trim()) fail(`tools.${name} 必须是文件路径`);
    }
  }

  const profiles = raw.profiles ?? {};
  if (!isObject(profiles)) {
    fail("profiles 必须是对象");
  } else {
    for (const [name, list] of Object.entries(profiles)) {
      if (!Array.isArray(list)) {
        fail(`profiles.${name} 必须是数组`);
        continue;
      }
      for (const tool of list) {
        if (typeof tool !== "string") fail(`profiles.${name} 里有非字符串工具名`);
        else if (isObject(tools) && !Object.hasOwn(tools, tool)) {
          fail(`profiles.${name} 引用了不存在的工具：${tool}`);
        }
      }
    }
  }

  const defaults = raw.defaults ?? {};
  if (!isObject(defaults)) {
    fail("defaults 必须是对象");
  } else {
    for (const key of ["defaultProvider", "defaultModel"]) {
      if (defaults[key] !== undefined && typeof defaults[key] !== "string") {
        fail(`defaults.${key} 必须是字符串`);
      }
    }
    if (defaults.defaultTools !== undefined && !Array.isArray(defaults.defaultTools)) {
      fail("defaults.defaultTools 必须是数组");
    }
  }

  if (raw.projectsBase !== undefined && typeof raw.projectsBase !== "string") {
    fail("projectsBase 必须是字符串");
  }
  if (raw.previousHomes !== undefined && !Array.isArray(raw.previousHomes)) {
    fail("previousHomes 必须是数组");
  }

  const projects = raw.projects ?? {};
  if (!isObject(projects)) {
    fail("projects 必须是对象");
  } else {
    const paths = new Map();
    for (const [project, entry] of Object.entries(projects)) {
      if (!isObject(entry)) {
        fail(`projects.${project} 必须是对象`);
        continue;
      }

      if (entry.path !== undefined && (typeof entry.path !== "string" || !entry.path.trim())) {
        fail(`projects.${project}.path 必须是非空字符串`);
      }
      if (entry.profile !== undefined) {
        if (typeof entry.profile !== "string") fail(`projects.${project}.profile 必须是字符串`);
        else if (isObject(profiles) && !Object.hasOwn(profiles, entry.profile)) {
          fail(`projects.${project} 引用了不存在的 profile：${entry.profile}`);
        }
      }
      if (entry.tools !== undefined) {
        if (!Array.isArray(entry.tools)) fail(`projects.${project}.tools 必须是数组`);
        else {
          for (const tool of entry.tools) {
            if (typeof tool !== "string") fail(`projects.${project}.tools 里有非字符串工具名`);
            else if (isObject(tools) && !Object.hasOwn(tools, tool)) {
              fail(`projects.${project}.tools 引用了不存在的工具：${tool}`);
            }
          }
        }
      }

      for (const key of ["isolate", "register", "enabled"]) {
        if (entry[key] !== undefined && typeof entry[key] !== "boolean") {
          fail(`projects.${project}.${key} 必须是布尔值`);
        }
      }
      for (const key of ["displayName", "workspace"]) {
        if (entry[key] !== undefined && typeof entry[key] !== "string") {
          fail(`projects.${project}.${key} 必须是字符串`);
        }
      }

      const declared = entry.path ?? project;
      if (paths.has(declared)) {
        warn(`projects.${project} 与 ${paths.get(declared)} 使用同一个路径：${declared}`);
      } else {
        paths.set(declared, project);
      }
    }
  }

  if (errors.length) {
    throw new Error(`Agent 清单 ${file} 有问题：\n${errors.map((item) => `- ${item}`).join("\n")}`);
  }

  return { manifest: raw, warnings };
}

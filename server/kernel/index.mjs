/**
 * 内核 · 块注册与启动
 *
 * 每个块在自己的目录里放一个 block.mjs，用代码登记：
 *   id       块名
 *   version  接口版本
 *   provides 我对外提供哪些能力（方法名 + 类型）
 *   requires 我需要谁、具体用哪个方法
 *   create   拿到依赖后返回 { api, routes?, meta? }
 *
 * 这里只在启动时组装一次，不是运行时事件总线：
 *   - 重复 id、缺依赖、缺方法、声明未实现、循环依赖，全部当场抛错；
 *   - 块之间拿依赖只走 create({ api })，不允许互相 import。
 */

const BLOCK_ID_RE = /^[a-z][a-z0-9-]*$/i;
const PROVIDE_KINDS = new Set([
  "function",
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "any",
]);

function assert(condition, message) {
  if (!condition) throw new Error(`[kernel] ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateBlock(block) {
  assert(isPlainObject(block), "块必须是对象");
  assert(typeof block.id === "string" && block.id.trim(), "块缺少 id");

  const id = block.id.trim();
  assert(BLOCK_ID_RE.test(id), `块 id 不合法：${id}`);

  const version = block.version ?? 1;
  assert(Number.isInteger(version) && version > 0, `块 ${id} 的 version 必须是正整数`);
  assert(typeof block.create === "function", `块 ${id} 缺少 create({ api, context })`);

  const provides = block.provides ?? {};
  assert(isPlainObject(provides), `块 ${id} 的 provides 必须是对象`);
  for (const [name, kind] of Object.entries(provides)) {
    assert(name, `块 ${id} 的 provides 有空方法名`);
    assert(
      typeof kind === "string" && PROVIDE_KINDS.has(kind),
      `块 ${id}.${name} 的类型未知：${kind}`,
    );
  }

  const requires = block.requires ?? {};
  assert(isPlainObject(requires), `块 ${id} 的 requires 必须是对象`);
  for (const [dep, methods] of Object.entries(requires)) {
    assert(dep && dep !== id, `块 ${id} 不能依赖自己`);
    assert(Array.isArray(methods) && methods.length > 0, `块 ${id} 对 ${dep} 的 requires 必须是非空数组`);
    for (const method of methods) {
      assert(typeof method === "string" && method.trim(), `块 ${id} 对 ${dep} 的方法名不合法`);
    }
  }

  return { block, id, version, provides, requires };
}

function validateRoute(blockId, route, index) {
  const label = `块 ${blockId} 的第 ${index + 1} 条路由`;
  assert(isPlainObject(route), `${label}不是对象`);
  assert(typeof route.method === "string" && route.method, `${label}缺少 method`);
  assert(typeof route.handler === "function", `${label}缺少 handler`);
  const hasPath = typeof route.path === "string" && route.path.length > 0;
  const hasPattern = route.pattern instanceof RegExp || typeof route.pattern === "string";
  assert(Boolean(hasPath) !== Boolean(hasPattern), `${label}的 path 与 pattern 只能有一个`);
}

function assertProvides(blockId, provides, api) {
  for (const [name, kind] of Object.entries(provides)) {
    assert(api[name] !== undefined && api[name] !== null, `块 ${blockId} 声明提供 ${name}，但 api 里没有`);
    if (kind === "function") {
      assert(typeof api[name] === "function", `块 ${blockId}.${name} 应为函数`);
    } else if (kind === "object") {
      assert(isPlainObject(api[name]), `块 ${blockId}.${name} 应为对象`);
    } else if (kind === "array") {
      assert(Array.isArray(api[name]), `块 ${blockId}.${name} 应为数组`);
    } else if (kind !== "any") {
      assert(typeof api[name] === kind, `块 ${blockId}.${name} 应为 ${kind}`);
    }
  }
}

export function createKernel({ context = {} } = {}) {
  const definitions = new Map();
  const instances = new Map();
  let booted = false;
  let booting = false;

  function define(block) {
    assert(!booted && !booting, "启动后不能再登记块");
    const entry = validateBlock(block);
    assert(!definitions.has(entry.id), `块 id 重复：${entry.id}`);
    definitions.set(entry.id, entry);
    return kernel;
  }

  function defineAll(blocks) {
    assert(Array.isArray(blocks), "defineAll 需要块数组");
    for (const block of blocks) define(block);
    return kernel;
  }

  /** 依赖优先；同时把循环依赖的完整路径报出来。 */
  function sortDefinitions() {
    for (const [id, entry] of definitions) {
      for (const dep of Object.keys(entry.requires)) {
        assert(definitions.has(dep), `块 ${id} 依赖未登记的块：${dep}`);
      }
    }

    const result = [];
    const state = new Map();
    const stack = [];

    function visit(id) {
      const status = state.get(id) ?? 0;
      if (status === 2) return;
      if (status === 1) {
        const start = stack.indexOf(id);
        const cycle = [...stack.slice(start), id].join(" -> ");
        throw new Error(`[kernel] 循环依赖：${cycle}`);
      }

      state.set(id, 1);
      stack.push(id);
      const entry = definitions.get(id);
      for (const dep of Object.keys(entry.requires)) visit(dep);
      stack.pop();
      state.set(id, 2);
      result.push(entry);
    }

    for (const id of definitions.keys()) visit(id);
    return result;
  }

  async function boot() {
    assert(!booted && !booting, "内核已经启动过");
    booting = true;

    try {
      const ordered = sortDefinitions();
      const routes = [];
      const meta = {};
      instances.clear();

      for (const entry of ordered) {
        const dependencies = {};
        for (const [depId, methods] of Object.entries(entry.requires)) {
          const dep = instances.get(depId);
          assert(dep, `块 ${entry.id} 启动时找不到依赖：${depId}`);
          for (const method of methods) {
            assert(
              dep.api[method] !== undefined && dep.api[method] !== null,
              `块 ${entry.id} 需要 ${depId}.${method}，但 ${depId} 没有提供`,
            );
          }
          dependencies[depId] = dep.api;
        }

        let created;
        try {
          created = await entry.block.create({ api: dependencies, context });
        } catch (error) {
          throw new Error(`[kernel] 块 ${entry.id} 启动失败：${error?.message || error}`, {
            cause: error,
          });
        }

        assert(isPlainObject(created), `块 ${entry.id} 的 create() 必须返回 { api, routes? }`);
        const api = created.api;
        assert(isPlainObject(api), `块 ${entry.id} 没有返回 api 对象`);
        assertProvides(entry.id, entry.provides, api);

        const blockRoutes = created.routes ?? [];
        assert(Array.isArray(blockRoutes), `块 ${entry.id} 的 routes 必须是数组`);
        blockRoutes.forEach((route, index) => validateRoute(entry.id, route, index));

        instances.set(entry.id, {
          id: entry.id,
          version: entry.version,
          api,
          routes: blockRoutes,
          meta: created.meta ?? null,
        });
        routes.push(...blockRoutes);
        meta[entry.id] = created.meta ?? null;
      }

      booted = true;
      const apis = {};
      for (const [id, instance] of instances) apis[id] = instance.api;
      return { apis, routes, meta };
    } finally {
      booting = false;
    }
  }

  function api(id) {
    assert(booted, "内核还没启动");
    const instance = instances.get(id);
    assert(instance, `没有已启动的块：${id}`);
    return instance.api;
  }

  /** 从代码现算的注册图，供诊断 / AI 查看，不是手写清单。 */
  function catalog() {
    return [...definitions.values()].map((entry) => {
      const instance = instances.get(entry.id);
      return {
        id: entry.id,
        version: entry.version,
        provides: Object.keys(entry.provides),
        requires: Object.fromEntries(
          Object.entries(entry.requires).map(([dep, methods]) => [dep, [...methods]]),
        ),
        routes: instance ? instance.routes.length : 0,
        booted: Boolean(instance),
      };
    });
  }

  const kernel = {
    define,
    defineAll,
    boot,
    api,
    get: api,
    catalog,
    get booted() {
      return booted;
    },
  };

  return kernel;
}

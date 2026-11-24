/* ===== 组装根：命令路由器 =====
 * 把“谁来执行这条命令”从 boot.js 的手写 if 链里搬出来：
 * 每个 Effects / 控制器建好之后自己 register，组装根只建一份 router。
 *
 * 语义与旧 if 链一致：按注册顺序依次尝试，第一个返回 true 的即“已处理”，
 * 后面的处理者不再看到这条命令。注册顺序就是优先级，所以每一项都必须带名字；
 * 谁都没接住时能直接说清是哪条命令漏了，而不是静默吞掉。
 *
 * 不吞异常：处理者抛错会原样冒出去，由 store / 调用方决定怎么降级。
 */

/**
 * @param {{
 *   onUnhandled?: ((command: any) => void) | null,
 * }} [options]
 */
export function createCommandRouter({ onUnhandled = null } = {}) {
  /** @type {Array<{ name: string, execute: (command: any) => any }>} */
  const entries = [];
  const names = new Set();
  /** 同一条命令只报一次，避免轮询 / 连点把控制台刷满。 */
  const reported = new Set();

  /**
   * @param {string} name 处理者名字，用于报错与漏接提示
   * @param {(command: any) => any} execute 返回 true 表示“这条命令我处理了”
   * @returns {() => void} 摘掉这个处理者（销毁期或测试用）
   */
  function register(name, execute) {
    if (typeof name !== 'string' || !name) {
      throw new Error('commandRouter.register: 需要处理者名字');
    }
    if (typeof execute !== 'function') {
      throw new Error(`commandRouter.register: ${name} 必须传一个 execute 函数`);
    }
    if (names.has(name)) {
      throw new Error(`commandRouter.register: ${name} 重复注册`);
    }
    names.add(name);
    entries.push({ name, execute });

    return function unregister() {
      const index = entries.findIndex((entry) => entry.name === name);
      if (index >= 0) entries.splice(index, 1);
      names.delete(name);
    };
  }

  /**
   * @param {import('../ui/contracts/events.js').UiCommand} command
   * @returns {Promise<boolean>} 是否有处理者接了这条命令
   */
  async function execute(command) {
    for (const entry of entries) {
      if (await entry.execute(command)) return true;
    }

    const type = command?.type;
    if (type && !reported.has(type)) {
      reported.add(type);
      onUnhandled?.(command);
    }
    return false;
  }

  return { register, execute };
}

/* ===== Single Adapter：启动单人模式的外部终端 =====
 * 只发请求。"团队 / 单人"的分支属于用例逻辑，留给 Effects。
 */

/** @param {{ request: (path: string, init?: Object) => Promise<any> }} deps */
export function createSingleAdapter({ request }) {
  return {
    /* POST /api/single/launch */
    async launch() {
      return request('/api/single/launch', { method: 'POST' });
    },
  };
}

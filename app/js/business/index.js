/* ===== 业务装配清单 =====
 * 全项目唯一"知道总共有哪些业务"的地方。不是模块，是清单。
 *
 * 加一块业务 = 加一个 registerXxx 文件 + 在这里挂一行。
 * 接真后端 = 换 api 那个对象，这里一行不用改。
 */

import { registerTeam } from './team.js';
import { registerCanvas } from './canvas.js';
import { registerWorkspace } from './workspace.js';
import { registerAgent } from './agent.js';
import { registerSettings } from './settings.js';

export function installBusiness(bus, ctx) {
  registerTeam(bus, ctx);
  registerCanvas(bus, ctx);
  registerWorkspace(bus, ctx);
  registerAgent(bus, ctx);
  registerSettings(bus, ctx);
}

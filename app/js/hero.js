/* ===== UI：主标题 =====
 * "标题飞到左上角"不是一次点击的产物，是 business.workspace.entered 变了之后的结果。
 * 所以这里没有 enterWorkspace() 这种函数供别人调用 —— 别人要进工作区，发意图就行。
 * （以前 hero.js 导出这个函数、注释写着"供拖拽调用"，但 main.js 拿了却没用，
 *   导致拖卡片到画布永远弹回。现在这条路径是状态驱动的，不存在漏接。）
 *
 * 动画分层：
 *   外层 h1 的 transform —— 只用于"飞到左上角"
 *   内层 .logo-inner     —— 只用于"点击时的缩放弹跳"
 * 两层各管各的属性，互不覆盖。
 */

import { BIZ, UI } from './core/intent.js';
import { confirmDialog } from './core/confirm.js';
import { toast } from './core/dom.js';
import { t } from './core/i18n.js';

export function mountHero({ store, bus, saver }) {
  const logoClick = document.getElementById('logoClick');
  const logoInner = document.getElementById('logoInner');
  const mainArea = document.getElementById('main');

  // 用 offsetLeft/offsetTop（布局坐标，不受 transform 影响、随布局自动更新），
  // 侧栏拖宽或窗口缩放后重算，标题始终钉在左上角
  function pinToCorner() {
    const dx = 16 - logoClick.offsetLeft;
    const dy = 10 - logoClick.offsetTop;
    logoClick.style.transform = `translate(${dx}px, ${dy}px) scale(0.28)`;
  }

  new ResizeObserver(() => {
    if (store.getState().business.workspace.entered) pinToCorner();
  }).observe(mainArea);

  /* ---------- 交互 ---------- */

  /* 离开工作区前先看一眼有没有没保存的改动。
   * 返回 false = 用户点了取消，哪儿都别去。 */
  async function ensureSaved() {
    const { saveState } = store.getState().view;
    if (saveState !== 'dirty' && saveState !== 'failed') return true;

    const choice = await confirmDialog({
      title: t('还有改动没保存'),
      message: t('离开工作区前，要先保存这个流程吗？'),
      buttons: [t('保存并离开'), t('不保存'), t('取消')],
    });
    if (choice === 2) return false;
    if (choice === 1) return true;

    const ok = await saver.flush();
    if (!ok) {
      toast(t('保存失败，先别离开'));
      return false;
    }
    return true;
  }

  logoClick.addEventListener('click', async () => {
    if (store.getState().business.workspace.entered) {
      if (!(await ensureSaved())) return;
      bus.send(BIZ.WORKSPACE_LEAVE);   // 返回：清 transform 后动画自己滑回中间
      return;
    }
    logoInner.classList.remove('pop');
    void logoInner.offsetWidth;        // 强制重排，连点时动画也能重新触发
    logoInner.classList.add('pop');
  });

  logoInner.addEventListener('animationend', () => {
    logoInner.classList.remove('pop');
    bus.send(UI.PANEL_OPEN, { id: 'logoPanel' });
  });

  // 工作区面板里的方框：现在只负责"选中"，确定按钮才进工作区。
  // 选中/增删的交互挪到了 modals.js（那里负责渲染方框列表）。

  /* ---------- 渲染 ---------- */

  let prevEntered = null;

  function render(state) {
    const entered = state.business.workspace.entered;
    if (entered === prevEntered) return;
    prevEntered = entered;

    mainArea.classList.toggle('in-workspace', entered);
    if (entered) pinToCorner();
    else logoClick.style.transform = '';
  }

  store.subscribe(render);
}

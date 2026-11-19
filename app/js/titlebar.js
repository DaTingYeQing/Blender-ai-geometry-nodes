/* ===== 自绘标题栏：窗口按钮 =====
 * 窗口是无边框的（frame: false），右上角三个点分别是最小化 / 最大化还原 / 关闭。
 * 拖动不写 JS：顶栏整条是 -webkit-app-region: drag，由系统处理。
 */

export function mountTitlebar() {
  const bridge = window.piFlow;
  const dots = document.querySelectorAll('.topbar .dots span');
  if (!bridge || !dots.length) return;   // 浏览器里跑没有宿主，直接跳过

  const actions = {
    minimize: () => bridge.minimizeWindow(),
    maximize: () => bridge.toggleMaximizeWindow(),
    close: () => bridge.closeWindow(),
  };

  for (const dot of dots) {
    const action = actions[dot.dataset.win];
    if (action) dot.addEventListener('click', action);
  }
}

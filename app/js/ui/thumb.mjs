// 选中滑块：按目标元素的位置和尺寸移动，animate 为 false 时直接落位。
export function moveThumb(thumb, target, animate = true) {
  if (!thumb) return;
  if (!target) {
    thumb.style.opacity = "0";
    return;
  }
  if (!animate) thumb.style.transition = "none";
  thumb.style.opacity = "1";
  thumb.style.width = `${target.offsetWidth}px`;
  thumb.style.height = `${target.offsetHeight}px`;
  thumb.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
  if (!animate) {
    void thumb.offsetWidth;
    thumb.style.transition = "";
  }
}

/**
 * 让滑块跟随容器尺寸、字体加载和显式状态变化重新对齐。
 * resolve 可以是选择器字符串，也可以返回目标元素的函数。
 */
export function createThumbTracker({ track, thumb, resolve }) {
  if (!track || !thumb) return { place() {}, refresh() {}, destroy() {} };

  let frame = 0;
  const target = () => (typeof resolve === "function" ? resolve() : track.querySelector(resolve));
  const place = (animate = true) => moveThumb(thumb, target(), animate);

  const observer = new ResizeObserver(() => {
    if (!track.isConnected) {
      observer.disconnect();
      return;
    }
    refresh();
  });
  observer.observe(track);

  function refresh() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => place(true));
  }

  document.fonts?.ready.then(refresh).catch(() => {});
  place(false);

  return {
    place,
    refresh,
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}

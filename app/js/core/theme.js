/* ===== 主题：团队配色 =====
 * 颜色在数据里只存三个数 h/s/l —— 可序列化，能跨 API 传（HSL 比 hex 更适合做渐变）。
 * 转成 CSS 字符串是显示层的事，放在这里的纯函数里，谁都能调。
 */

// 彩虹色板：柔和低饱和，参考右上角三个窗口点的配色。第 8 个起从头循环。
const HUES = [
  [6, 65, 58],    // 红（珊瑚）
  [28, 65, 58],   // 橙
  [45, 66, 58],   // 黄（琥珀）
  [97, 41, 59],   // 绿
  [187, 41, 58],  // 青
  [219, 41, 58],  // 蓝
  [280, 35, 60],  // 紫
];

/** 按序取一组 h/s/l。真后端一般会自己配色，这只是内存实现的占位。 */
export function pickHue(index) {
  const [h, s, l] = HUES[index % HUES.length];
  return { h, s, l };
}

/** h/s/l → CSS 颜色串 */
export function hsl({ h, s, l }) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** 团队色派生出的几种用法 */
export function paint(team) {
  const base = hsl(team);
  return {
    bg: base,
    border: base,
    text: '#1b1b1b',
  };
}

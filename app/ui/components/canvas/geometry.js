/* ===== 画布几何：纯函数 =====
 * 输入输出全部是世界坐标，不碰 DOM、不读视图状态 —— 独立可测。
 * 与旧 `app/js/canvas/geometry.js` 的算法保持一致，搬到新层是为了让
 * 组件不 import 旧内核；旧文件随画布退场一起删除。
 */

/* 立方体在布局里的边长。必须和 canvas.css 里 .canvas-card.team-card .ghost-cube-lockup svg 的 width/height 一致。 */
export const CUBE_SIZE = 90;

/* 立方体剪影 = 八边形（512 空间，顺时针），是底板 + 立方体两块的并集边界。 */
const OUTLINE = [
  [256.00, 89.45],
  [430.33, 107.88],
  [392.52, 262.99],
  [476.16, 306.93],
  [256.00, 422.55],
  [35.84, 306.93],
  [130.19, 257.38],
  [130.19, 155.52],
];

/**
 * 锚点：从立方体中心朝 point 发射线，与轮廓求交。
 * @param {{cx:number, cy:number, width:number, height:number}} box 立方体在世界坐标里的外框
 * @param {{x:number, y:number}} point 目标点（世界坐标）
 */
export function anchorToward(box, point) {
  const scale = box.width / 512;
  const dx = point.x - box.cx;
  const dy = point.y - box.cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x: box.cx, y: box.cy };
  const dirX = dx / len;
  const dirY = dy / len;

  let bestT = Infinity;
  for (let i = 0; i < OUTLINE.length; i++) {
    const j = (i + 1) % OUTLINE.length;
    const ax = (OUTLINE[i][0] - 256) * scale;
    const ay = (OUTLINE[i][1] - 256) * scale;
    const bx = (OUTLINE[j][0] - 256) * scale;
    const by = (OUTLINE[j][1] - 256) * scale;
    const ex = bx - ax;
    const ey = by - ay;
    const denom = dirX * ey - dirY * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (ax * by - ay * bx) / denom;
    const u = (dirX * ey - dirY * ex - (dirX * by - dirY * bx)) / denom;
    if (t > 0 && u >= 0 && u <= 1 && t < bestT) bestT = t;
  }
  if (!isFinite(bestT)) {
    return { x: box.cx + dirX * box.width / 2, y: box.cy + dirY * box.height / 2 };
  }
  return { x: box.cx + bestT * dirX, y: box.cy + bestT * dirY };
}

/** 节点中心 (x,y) 的外框；纯算术，给连线算锚点用。 */
export function boxOf(x, y) {
  return {
    left: x - CUBE_SIZE / 2,
    top: y - CUBE_SIZE / 2,
    cx: x,
    cy: y,
    width: CUBE_SIZE,
    height: CUBE_SIZE,
  };
}

/** 贝塞尔的两个控制点：沿主轴伸出控制臂；bow 让反向成对的边分道 */
function controls(p1, p2, bow = 0) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = Math.sign(dx || 1);
    const k = Math.max(40, Math.abs(dx) * 0.4);
    return {
      c1: { x: p1.x + s * k, y: p1.y + bow },
      c2: { x: p2.x - s * k, y: p2.y + bow },
    };
  }
  const s = Math.sign(dy || 1);
  const k = Math.max(40, Math.abs(dy) * 0.4);
  return {
    c1: { x: p1.x + bow, y: p1.y + s * k },
    c2: { x: p2.x + bow, y: p2.y - s * k },
  };
}

/** 路径的 d 属性 */
export function bezierPath(p1, p2, bow = 0) {
  const { c1, c2 } = controls(p1, p2, bow);
  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

/** 曲线中点（t=0.5），用来摆连线上那颗可点的圆点 */
export function bezierMidpoint(p1, p2, bow = 0) {
  const { c1, c2 } = controls(p1, p2, bow);
  return {
    x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
    y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
  };
}

/** 团队色 → CSS 颜色；缺团队时给一个中性灰，别让节点消失。 */
export function colorOf(team) {
  if (!team) return 'hsl(0, 0%, 60%)';
  return `hsl(${team.h}, ${team.s}%, ${team.l}%)`;
}

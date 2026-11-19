/* ===== 连线几何：纯函数 =====
 * 输入输出全部是世界坐标，不碰 DOM、不读视图状态 —— 独立可测。
 */

/* 立方体剪影 = 八边形（512 空间，顺时针）。
 *
 * 它是"底板 + 立方体"两块的**真实并集边界**，是凹的，不是凸包。
 * 关键在两边那两个缺口：立方体的边和底板的边相交，交点之后边界要折出去。
 *   左边：立方体那条竖线 x=130.19（从 y=155.52 一直到 257.38），
 *         到底板左上边就折向左下 → 底板左角 (35.84,306.93)
 *   右边：立方体的右边线往下到 (392.52,262.99)，
 *         之后折向右下 → 底板右角 (476.16,306.93)
 *
 * 早先这里写的是六个点的凸包，等于用一段斜线把这两个缺口"抄近路"连过去：
 * 立方体的竖线和斜边都被吃掉了，看着就是"左右各缺一条往上的直线"，
 * 连线锚点也因此贴在一条并不存在的边上。 */
const OUTLINE = [
  [256.00, 89.45],     // 顶点
  [430.33, 107.88],    // 右上
  [392.52, 262.99],    // 立方体右边线 × 底板右上边
  [476.16, 306.93],    // 底板右角
  [256.00, 422.55],    // 底点
  [35.84, 306.93],     // 底板左角
  [130.19, 257.38],    // 底板左上边 × 立方体左竖边
  [130.19, 155.52],    // 左上
];

/**
 * 锚点：从立方体中心朝 point 发射线，与六边形轮廓求交。
 * 交点永远贴在 logo 轮廓上，方向一变就沿轮廓滑动。
 * @param {{cx:number, cy:number, width:number, height:number}} box 立方体在世界坐标里的外框
 * @param {{x:number, y:number}} point 目标点（世界坐标）
 */
export function anchorToward(box, point) {
  const scale = box.width / 512;
  const dx = point.x - box.cx, dy = point.y - box.cy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x: box.cx, y: box.cy };        // 重合时兜底
  const dirX = dx / len, dirY = dy / len;

  // 射线（自 cube 中心出发）与六边形各边求交，取最近命中
  let bestT = Infinity;
  for (let i = 0; i < OUTLINE.length; i++) {
    const j = (i + 1) % OUTLINE.length;
    // 顶点换算到"以 cube 中心为原点、单位=世界像素"
    const ax = (OUTLINE[i][0] - 256) * scale, ay = (OUTLINE[i][1] - 256) * scale;
    const bx = (OUTLINE[j][0] - 256) * scale, by = (OUTLINE[j][1] - 256) * scale;
    const ex = bx - ax, ey = by - ay;                  // 边向量
    const denom = dirX * ey - dirY * ex;               // 射线方向 × 边向量
    if (Math.abs(denom) < 1e-9) continue;              // 平行：无交点
    // 解 t·D = A + u·E
    const t = (ax * by - ay * bx) / denom;
    const u = (dirX * ey - dirY * ex - (dirX * by - dirY * bx)) / denom;
    if (t > 0 && u >= 0 && u <= 1 && t < bestT) bestT = t;
  }
  if (!isFinite(bestT)) {
    // 理论上不会发生，兜底用外框边缘
    return { x: box.cx + dirX * box.width / 2, y: box.cy + dirY * box.height / 2 };
  }
  return { x: box.cx + bestT * dirX, y: box.cy + bestT * dirY };
}

/** 贝塞尔的两个控制点：沿主轴伸出控制臂；bowY 让反向成对的边分道 */
function controls(p1, p2, bowY = 0) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = Math.sign(dx || 1);
    const k = Math.max(40, Math.abs(dx) * 0.4);
    return {
      c1: { x: p1.x + s * k, y: p1.y + bowY },
      c2: { x: p2.x - s * k, y: p2.y + bowY },
    };
  }
  const s = Math.sign(dy || 1);
  const k = Math.max(40, Math.abs(dy) * 0.4);
  return {
    c1: { x: p1.x + bowY, y: p1.y + s * k },
    c2: { x: p2.x + bowY, y: p2.y - s * k },
  };
}

/** 路径的 d 属性 */
export function bezierPath(p1, p2, bowY = 0) {
  const { c1, c2 } = controls(p1, p2, bowY);
  return `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
}

/** 曲线中点（t=0.5），用来摆连线上那颗可点的圆点 */
export function bezierMidpoint(p1, p2, bowY = 0) {
  const { c1, c2 } = controls(p1, p2, bowY);
  return {
    x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
    y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
  };
}

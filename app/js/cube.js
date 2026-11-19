/* ===== 立方体图标：内联 SVG 模板 =====
 * 从 cube-icon.svg 复制而来，两处动态化：
 * 1. 顶部的圆点颜色 = 团队色
 * 2. 三根拉线的渐变 = 团队色的明暗渐变（保留原渐变的衰减节奏：
 *    饱和度 100%→65%→45%→12%、明度 100%→68%→45%→30%，末段趋近深灰）
 * 注意：渐变靠 id 引用，每次调用生成唯一后缀，
 * 否则页面上多个立方体会全部引用到第一份渐变（id 撞车）。
 */

let uid = 0;

export function cubeSvg(color) {
  const u = ++uid;
  const dot = `hsl(${color.h}, ${color.s}%, ${color.l}%)`;
  // 原版渐变四段的饱和度/明度衰减节奏（相对起始色）
  const ramp = [
    [0,    1,    1   ],
    [0.35, 0.65, 0.68],
    [0.7,  0.45, 0.45],
    [1,    0.12, 0.30],
  ];
  const opac = [1, 0.803, 0.675, 0.58];
  const grad = (name, x2, y2) => {
    const stops = ramp.map(([o, sf, lf], i) =>
      `<stop offset="${o}" stop-color="hsl(${color.h}, ${Math.round(color.s * sf)}%, ${Math.round(color.l * lf)}%)" stop-opacity="${opac[i]}"/>`
    ).join('');
    return `<linearGradient id="${name}-${u}" gradientUnits="userSpaceOnUse" x1="430.33" y1="107.88" x2="${x2}" y2="${y2}">${stops}</linearGradient>`;
  };

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Agent cube icon">
<defs>
${grad('pull0', 256.00, 89.45)}
${grad('pull1', 256.00, 221.59)}
${grad('pull2', 381.81, 306.93)}
<linearGradient id="board-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#faf6ec"/><stop offset="0.55" stop-color="#f2ecdd"/><stop offset="1" stop-color="#e4dcc9"/></linearGradient>
<clipPath id="boardClip-${u}"><polygon points="35.84,306.93 256.00,422.55 476.16,306.93 256.00,191.31"/></clipPath>
</defs>
<polygon points="35.84,306.93 256.00,422.55 476.16,306.93 256.00,191.31" fill="url(#board-${u})" stroke="rgba(150,141,120,0.45)" stroke-width="1.2" stroke-linejoin="round"/>
<polygon points="130.19,306.93 256.00,373.00 320.05,373.00 514.53,306.93 320.05,240.86 256.00,240.86" fill="rgba(96,78,52,0.450)" clip-path="url(#boardClip-${u})"/>
<polygon points="130.19,306.93 256.00,373.00 256.00,221.59" fill="rgb(90,91,88)" stroke="rgb(90,91,88)" stroke-width="0.9" stroke-linejoin="round"/>
<polygon points="256.00,373.00 381.81,306.93 430.33,107.88" fill="rgb(31,34,40)" stroke="rgb(31,34,40)" stroke-width="0.9" stroke-linejoin="round"/>
<polygon points="256.00,373.00 430.33,107.88 256.00,221.59" fill="rgb(31,34,40)" stroke="rgb(31,34,40)" stroke-width="0.9" stroke-linejoin="round"/>
<polygon points="130.19,306.93 256.00,221.59 130.19,155.52" fill="rgb(90,91,88)" stroke="rgb(90,91,88)" stroke-width="0.9" stroke-linejoin="round"/>
<polygon points="130.19,155.52 256.00,221.59 430.33,107.88" fill="rgb(182,178,167)" stroke="rgb(182,178,167)" stroke-width="0.9" stroke-linejoin="round"/>
<polygon points="130.19,155.52 430.33,107.88 256.00,89.45" fill="rgb(189,184,173)" stroke="rgb(189,184,173)" stroke-width="0.9" stroke-linejoin="round"/>
<g stroke="rgba(46,44,39,0.550)" stroke-width="2.44" stroke-linecap="round" stroke-linejoin="round"><line x1="130.19" y1="306.93" x2="130.19" y2="155.52"/><line x1="130.19" y1="306.93" x2="256.00" y2="373.00"/><line x1="130.19" y1="155.52" x2="256.00" y2="89.45"/><line x1="130.19" y1="155.52" x2="256.00" y2="221.59"/><line x1="256.00" y1="373.00" x2="256.00" y2="221.59"/><line x1="256.00" y1="373.00" x2="381.81" y2="306.93"/></g>
<g stroke-linecap="round"><line x1="430.33" y1="107.88" x2="256.00" y2="89.45" stroke="url(#pull0-${u})" stroke-width="5.61"/><line x1="430.33" y1="107.88" x2="256.00" y2="221.59" stroke="url(#pull1-${u})" stroke-width="5.61"/><line x1="430.33" y1="107.88" x2="381.81" y2="306.93" stroke="url(#pull2-${u})" stroke-width="5.61"/></g>
<g class="node-dot"><circle cx="430.33" cy="107.88" r="40" fill="rgba(0,0,0,0)" pointer-events="all"/><circle class="dot-fill" cx="430.33" cy="107.88" r="16.90" fill="${dot}"/><path class="dot-x" d="M${430.33-32},${107.88-32} L${430.33+32},${107.88+32} M${430.33+32},${107.88-32} L${430.33-32},${107.88+32}" stroke="${dot}" stroke-width="16" stroke-linecap="round" fill="none"/></g>
</svg>`;
}

/** 把版本统一成 x.y.z 再比较：Blender 的 ProductVersion 是 "4.5"，压缩包名里是 "4.5.0"。 */
export function normalizeVersion(value) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value || "").trim());
  if (!match) return "";
  return `${match[1]}.${match[2]}.${match[3] || 0}`;
}

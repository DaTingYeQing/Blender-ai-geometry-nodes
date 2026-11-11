import { getLocale, t } from "./i18n.mjs";

export async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", "x-pi-locale": getLocale(), ...options.headers },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || t("请求失败（{status}）", { status: res.status }));
  return payload;
}

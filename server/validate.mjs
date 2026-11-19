import { t } from "../shared/messages.mjs";
import { ApiError } from "./store/index.mjs";

const CHECKS = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
  object: (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value),
  array: (value) => Array.isArray(value),
};

/** 按契约里 request / query 的最小描述校验载荷；未知字段原样放行。 */
export function validateFields(spec, value, label) {
  if (!spec) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, t("{label}必须是对象", { label }));
  }

  for (const [name, rule] of Object.entries(spec)) {
    const present =
      Object.hasOwn(value, name) && value[name] !== undefined && value[name] !== null;
    if (!present) {
      if (rule.required) throw new ApiError(400, t("缺少字段 {name}", { name }));
      continue;
    }
    const check = CHECKS[rule.type];
    if (check && !check(value[name])) {
      throw new ApiError(400, t("字段 {name} 应为 {type}", { name, type: rule.type }));
    }
  }
}

export function validateEndpointPayload(entry, { body = {}, query = {} } = {}) {
  if (!entry) return;
  if (entry.request) validateFields(entry.request, body, t("请求体"));
  if (entry.query) validateFields(entry.query, query, t("查询参数"));
}

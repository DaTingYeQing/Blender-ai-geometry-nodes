/**
 * hook_skill.ts —— 计划落盘后，提示加载 blender-exec skill（hook 家族：hook_rules / hook_skill）
 *
 * 时序：
 *   wf_plan 成功返回（计划落盘）→ 立刻发一条消息，提示去 read 执行 skill。
 *   用 deliverAs="steer"：本 turn 的工具执行完、下一次 LLM 调用之前送达，
 *   所以模型下一轮一定看得到。
 *
 * 多次 wf_plan（同一个 session 内）：
 *   每一次成功都发一次 —— 新计划 = 新任务 = 新的执行阶段，都该重新加载 skill。
 *   （不做去重；若嫌吵把 DEDUPE_PER_PROJECT 改成 true）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ===== 可配置 =====
const ARM_TOOL = "wf_plan"; // 它成功跑完 = 计划落盘
const SKILL_NAME = "blender-exec";
// 相对地址：本文件在 <agent>/extensions/ 下，skill 在 <agent>/skills/execution/ 下
const SKILL_PATH = path.join(__dirname, "..", "skills", "execution", "SKILL.md");
const INLINE_CONTENT = false; // true = 直接把 SKILL.md 全文注入；false = 只发提示让模型自己 read
const DEDUPE_PER_PROJECT = false; // true = 同一个 project 只在第一次 wf_plan 时发

export default function (pi: ExtensionAPI) {
	const seenProjects = new Set<string>();

	pi.on("session_start", async () => {
		seenProjects.clear();
	});

	pi.on("tool_result", async (event) => {
		try {
			const e = event as any;
			if (e.toolName !== ARM_TOOL || e.isError) return;

			const project = String(e.input?.project ?? "(未知)");
			if (DEDUPE_PER_PROJECT) {
				if (seenProjects.has(project)) return;
				seenProjects.add(project);
			}

			let content = "";
			if (INLINE_CONTENT) {
				try {
					content = fs.readFileSync(SKILL_PATH, "utf8").trim();
				} catch {
					content = "";
				}
			}
			if (!content) {
				content = [
					`# 计划已落盘 → 进入执行阶段（project: ${project}）`,
					"",
					`下一步必须加载 skill **${SKILL_NAME}**：用 read 工具读 \`${SKILL_PATH}\`，严格按它的流程执行。`,
				].join("\n");
			}

			pi.sendMessage(
				{
					customType: "hook_skill",
					content,
					display: true,
				},
				{ deliverAs: "steer" },
			);
		} catch {
			// 注入失败绝不能影响主流程
		}
	});
}

import { esc } from "../core/dom.mjs";
import { t } from "../core/i18n.mjs";
import { createModal } from "./modal.mjs";

let active = null;

/** 统一确认框，返回 Promise<boolean>。detail 可传可信 HTML（例如 <code>）。 */
export function confirmDialog({
  title = t("确认操作"),
  message = "",
  detail = "",
  confirmText = t("确认"),
  cancelText = t("取消"),
  danger = false,
} = {}) {
  active?.close(false);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      active = null;
      resolve(value);
    };

    const modal = createModal({
      className: "ui-confirm",
      title,
      initialFocus: "[data-confirm-cancel]",
      body: `<p class="ui-confirm__message">${esc(message)}</p>${detail ? `<p class="ui-hint">${detail}</p>` : ""}`,
      actions: `
        <button type="button" class="ui-btn" data-confirm-cancel>${esc(cancelText)}</button>
        <button type="button" class="ui-btn ${danger ? "ui-btn--danger" : "ui-btn--primary"}" data-confirm-ok>${esc(
          confirmText,
        )}</button>`,
      onClose: () => {
        settle(false);
        modal.destroy();
      },
    });

    modal.panel.querySelector("[data-confirm-cancel]").addEventListener("click", () => modal.close("cancel"));
    modal.panel.querySelector("[data-confirm-ok]").addEventListener("click", () => {
      settle(true);
      modal.close("confirm");
    });

    active = { close: () => modal.close("replaced") };
    modal.open();
  });
}

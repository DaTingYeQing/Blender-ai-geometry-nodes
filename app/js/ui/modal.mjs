import { esc, uid } from "../core/dom.mjs";
import { t } from "../core/i18n.mjs";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusablesIn = (panel) =>
  [...panel.querySelectorAll(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);

const isTopmost = (root) => {
  const open = [...document.querySelectorAll(".ui-modal-backdrop:not(.hidden)")];
  return open[open.length - 1] === root;
};

/**
 * 给已有弹窗 DOM 补上统一行为：role/aria、焦点陷阱、焦点返回、Esc 和遮罩关闭。
 * 只处理最顶层弹窗，避免确认框打开时把下面的弹窗一起关掉。
 */
export function bindModal(
  root,
  { canDismiss = () => true, initialFocus = "", label = "", onClose } = {},
) {
  const panel = root.querySelector(".ui-modal") || root;
  const heading = panel.querySelector("h2");

  if (heading && !heading.id) heading.id = uid("ui-modal-title");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  if (heading?.id) panel.setAttribute("aria-labelledby", heading.id);
  else if (label) panel.setAttribute("aria-label", label);

  let open = false;
  let lastFocus = null;

  function onKeydown(event) {
    if (!open || !isTopmost(root)) return;

    if (event.key === "Escape") {
      if (!canDismiss()) return;
      event.preventDefault();
      event.stopPropagation();
      close("escape");
      return;
    }

    if (event.key !== "Tab") return;
    const items = focusablesIn(panel);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onClick(event) {
    if (!open) return;
    const closeButton = event.target.closest?.("[data-modal-close]");
    if (closeButton && panel.contains(closeButton)) {
      if (canDismiss()) close("close");
      return;
    }
    if (event.target === root && canDismiss()) close("backdrop");
  }

  function show() {
    if (open) return;
    open = true;
    lastFocus = document.activeElement;
    root.classList.remove("hidden");
    document.addEventListener("keydown", onKeydown, true);
    requestAnimationFrame(() => {
      const target = initialFocus ? panel.querySelector(initialFocus) : focusablesIn(panel)[0] || panel;
      target?.focus?.();
    });
  }

  function close(reason = "close") {
    if (!open) return;
    open = false;
    root.classList.add("hidden");
    document.removeEventListener("keydown", onKeydown, true);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.();
    onClose?.(reason);
  }

  root.addEventListener("click", onClick);

  return {
    root,
    panel,
    open: show,
    close,
    isOpen: () => open,
    destroy() {
      close("destroy");
      root.removeEventListener("click", onClick);
      root.remove();
    },
  };
}

/**
 * 创建弹窗再交给 bindModal。body / actions / headExtra 传入可信 HTML，title 按纯文本转义。
 */
export function createModal({
  id,
  title = "",
  headExtra = "",
  body = "",
  actions = "",
  className = "",
  closable = true,
  initialFocus = "",
  onClose,
} = {}) {
  const backdrop = document.createElement("div");
  if (id) backdrop.id = id;
  backdrop.className = "ui-modal-backdrop hidden";

  backdrop.innerHTML = `
    <div class="ui-modal ${className}">
      ${
        title
          ? `<div class="ui-modal__head">
              <h2>${esc(title)}</h2>
              ${headExtra}
              ${
                closable
                  ? `<button type="button" class="ui-btn ui-btn--icon" data-modal-close aria-label="${esc(
                      t("关闭"),
                    )}">×</button>`
                  : ""
              }
            </div>`
          : ""
      }
      <div class="ui-modal__body">${body}</div>
      ${actions ? `<div class="ui-modal__actions">${actions}</div>` : ""}
    </div>`;
  document.body.append(backdrop);

  return bindModal(backdrop, {
    canDismiss: () => closable,
    initialFocus,
    onClose,
  });
}

import { esc } from "../core/dom.mjs";
import { createThumbTracker } from "./thumb.mjs";

/** items: [{ value, label, dot? }]，value 默认选中项。 */
export function segmentedMarkup({ value, items, thumb = true }) {
  return `<div class="ui-segmented ui-well" role="radiogroup">
    ${thumb ? '<i class="ui-thumb" aria-hidden="true"></i>' : ""}
    ${items
      .map((item) => {
        const active = item.value === value;
        return `<button type="button" class="ui-seg ${active ? "is-active" : ""}"
          role="radio" aria-checked="${active}" tabindex="${active ? 0 : -1}"
          data-value="${esc(item.value)}"
        >${item.dot === false ? "" : '<span class="ui-seg__dot"></span>'}${esc(item.label)}</button>`;
      })
      .join("")}
  </div>`;
}

/** 绑定滑块组：点击、方向键、Home/End、ARIA 状态和滑块跟随都在这里处理。 */
export function bindSegmented(root, { value, onChange } = {}) {
  if (!root) return null;

  const buttons = [...root.querySelectorAll(".ui-seg")];
  if (!buttons.length) return null;

  let current =
    value ??
    buttons.find((button) => button.classList.contains("is-active"))?.dataset.value ??
    buttons[0].dataset.value;

  const tracker = createThumbTracker({
    track: root,
    thumb: root.querySelector(".ui-thumb"),
    resolve: () => root.querySelector(".ui-seg.is-active"),
  });

  function set(next, { emit = true, animate = true } = {}) {
    if (next == null) return;
    const changed = next !== current;
    current = next;
    for (const button of buttons) {
      const active = button.dataset.value === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    tracker.place(animate);
    if (emit && changed) onChange?.(next);
  }

  function onClick(event) {
    const button = event.target.closest(".ui-seg");
    if (!button || !root.contains(button)) return;
    set(button.dataset.value);
  }

  function onKeydown(event) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const index = buttons.findIndex((button) => button.dataset.value === current);
    let nextIndex = index;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + buttons.length) % buttons.length;
    } else {
      nextIndex = (index + 1) % buttons.length;
    }

    set(buttons[nextIndex].dataset.value);
    buttons[nextIndex].focus();
  }

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  set(current, { emit: false, animate: false });

  return {
    set,
    get value() {
      return current;
    },
    place: (animate = true) => tracker.place(animate),
    destroy() {
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeydown);
      tracker.destroy();
    },
  };
}

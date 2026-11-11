import { esc } from "../core/dom.mjs";

export function switchMarkup({ id, name, checked = false, label } = {}) {
  return `<label class="ui-switch"${label ? ` aria-label="${esc(label)}"` : ""}>
    <input type="checkbox"${id ? ` id="${esc(id)}"` : ""}${name ? ` name="${esc(name)}"` : ""}${
      checked ? " checked" : ""
    } />
    <span class="ui-switch__track"><i class="ui-switch__knob"></i></span>
  </label>`;
}

export function bindSwitch(input, { onChange } = {}) {
  if (!input) return null;

  const listener = () => onChange?.(input.checked);
  input.addEventListener("change", listener);

  return {
    get checked() {
      return input.checked;
    },
    set(checked) {
      input.checked = Boolean(checked);
    },
    destroy() {
      input.removeEventListener("change", listener);
    },
  };
}

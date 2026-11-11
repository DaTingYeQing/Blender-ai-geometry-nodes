import { t } from "../../../app/js/core/i18n.mjs";
import { loadStyle } from "../../../app/js/core/style.mjs";
import { toast } from "../../../app/js/core/toast.mjs";
import { createModal } from "../../../app/js/ui/index.mjs";

export function mountArtifacts({ request }) {
  loadStyle("/modules/artifacts/web/styles.css");

  const modal = createModal({
    id: "previewModal",
    title: t("产物预览"),
    className: "preview-modal",
    body: '<pre id="previewBody" class="preview-body"></pre>',
  });
  const title = modal.panel.querySelector(".ui-modal__head h2");
  const body = modal.panel.querySelector("#previewBody");

  async function preview(path, name) {
    try {
      const data = await request(`/api/file?path=${encodeURIComponent(path)}`);
      title.textContent = name || t("产物预览");
      body.textContent = data.content || data.error || t("无法读取");
      modal.open();
    } catch (error) {
      toast(error.message, true);
    }
  }

  return { preview };
}

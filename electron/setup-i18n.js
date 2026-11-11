// 安装窗口是 file:// 页面，不能直接 import 应用模块，这里只放安装页自己的文案。
globalThis.SETUP_I18N = {
  "Pi Flow 运行环境": "Pi Flow Runtime",
  "安装": "Install",
  "日志": "Log",
  "最小化": "Minimize",
  "关闭": "Close",
  "界面语言": "Interface language",
  "正在检查运行环境…": "Checking runtime…",
  "Blender 已内置在安装包中，无需联网下载。其余依赖首次安装时需要网络，失败后重启应用会接着上次的进度继续。":
    "Blender is bundled with the installer, so no download is needed. Other dependencies require a network connection on first install; if it fails, restarting the app resumes from where it left off.",
  "准备完成，正在启动…": "Ready, starting…",
  "准备安装运行环境…": "Preparing runtime installation…",
  "检查网络": "Check network",
  "准备 pi": "Prepare pi",
  "准备 Git Bash": "Prepare Git Bash",
  "配置 Python 环境": "Configure Python environment",
  "部署 Blender": "Deploy Blender",
  "准备 fd / rg": "Prepare fd / rg",
  "写入配置": "Write configuration",
  "检查网络与磁盘": "Check network and disk",
  "解压内置 Blender": "Extract bundled Blender",
  "安装 Python 依赖": "Install Python dependencies",
  "校验 CovTrace 工具链": "Verify CovTrace toolchain",
  "准备 Agent 工作区": "Prepare Agent workspace",
  "预览模式：不会执行真实安装。": "Preview mode: no real installation is performed.",
  "运行环境就绪（预览）。": "Runtime ready (preview).",
};

globalThis.resolveSetupLocale = (stored) => (stored === "zh" ? "zh" : "en");

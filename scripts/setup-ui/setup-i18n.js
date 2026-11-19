// 安装窗口是 file:// 页面，不能直接 import 应用模块，这里只放安装页自己的文案。
globalThis.SETUP_I18N = {
  "Pi Flow 运行环境": "Pi Flow Runtime",
  "安装向导": "Setup",
  "安装": "Install",
  "日志": "Log",
  "最小化": "Minimize",
  "关闭": "Close",
  "界面语言": "Interface language",
  "准备安装运行环境": "Preparing the runtime",
  "将依次准备 {n} 项运行依赖": "{n} runtime dependencies will be prepared in order",
  "正在安装，请稍候…": "Installing, please wait…",
  "运行环境就绪，正在启动…": "Runtime ready, starting…",
  "全部 {n} 项已完成": "All {n} items completed",
  "第 {n} 项中断，日志里有详细原因": "Item {n} was interrupted — see the log for details",
  "安装中断": "Installation interrupted",
  "Blender 已内置在安装包中，无需联网下载。其余依赖首次安装时需要网络，失败后重新运行会接着上次的进度继续。":
    "Blender is bundled with the installer, so no download is needed. Other dependencies need a network connection on first install; if it fails, rerunning resumes from where it left off.",
  "检查网络": "Check network",
  "准备 pi": "Prepare pi",
  "准备 Git Bash": "Prepare Git Bash",
  "部署 Blender": "Deploy Blender",
  "部署 CovTrace 工具链": "Deploy CovTrace toolchain",
  "准备 fd / rg": "Prepare fd / rg",
  "写入配置": "Write configuration",
};

globalThis.resolveSetupLocale = (stored) => (stored === "zh" ? "zh" : "en");

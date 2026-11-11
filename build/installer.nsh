; NSIS 自定义卸载钩子。
; electron-builder 在删除 $INSTDIR 之后才执行 customUnInstall，
; 所以清理脚本必须在 setup 时复制到 %APPDATA%\Pi Flow 下。

!macro customUnInstall
  SetShellVarContext current

  ; 卸载语言跟着安装窗口的选择；文件缺失或没选过默认英文。
  StrCpy $R0 "en"
  IfFileExists "$APPDATA\Pi Flow\ui-locale.txt" 0 piflow_locale_ready
    FileOpen $R1 "$APPDATA\Pi Flow\ui-locale.txt" r
    FileRead $R1 $R2
    FileClose $R1
    StrCpy $R2 $R2 2
    StrCmp $R2 "zh" 0 piflow_locale_ready
    StrCpy $R0 "zh"
  piflow_locale_ready:

  IfSilent piflow_skip_notice
  StrCmp $R0 "zh" 0 piflow_notice_en
    MessageBox MB_OK|MB_ICONEXCLAMATION "卸载 Pi Flow 会同时删除运行环境、流程数据和产物（workspace、agents、state.json），以及本次安装的 Python / Node / pi。"
    Goto piflow_skip_notice
  piflow_notice_en:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Uninstalling Pi Flow also removes the runtime, flow data and artifacts (workspace, agents, state.json), plus the Python / Node / pi installed by this setup."
  piflow_skip_notice:

  IfFileExists "$APPDATA\Pi Flow\uninstall-runtime.ps1" 0 piflow_cleanup_fallback
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$APPDATA\Pi Flow\uninstall-runtime.ps1"'
    Pop $R3
  piflow_cleanup_fallback:

  RMDir /r "$APPDATA\Pi Flow"
  SetShellVarContext all
!macroend

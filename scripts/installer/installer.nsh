; NSIS 自定义卸载钩子。
; electron-builder 在删除 $INSTDIR 之后才执行 customUnInstall，
; 所以清理脚本必须在 setup 时复制到 %APPDATA%\Pi Flow 下。

!macro customUnInstall
  ; 升级时 electron-builder 会静默调用旧卸载器；这时只替换程序文件，
  ; 清理运行时/数据留给真正的卸载。旧版本没有这段判断，所以从旧版升上来那次仍会重置。
  ${ifNot} ${isUpdated}
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
    MessageBox MB_OK|MB_ICONEXCLAMATION "卸载 Pi Flow 会同时删除运行环境、流程数据和产物（workspace、agents、state.json），以及本次安装的 Node / pi。"
    Goto piflow_skip_notice
  piflow_notice_en:
    MessageBox MB_OK|MB_ICONEXCLAMATION "Uninstalling Pi Flow also removes the runtime, flow data and artifacts (workspace, agents, state.json), plus the Node / pi installed by this setup."
  piflow_skip_notice:

  StrCpy $R3 "missing"
  IfFileExists "$APPDATA\Pi Flow\uninstall-runtime.ps1" 0 piflow_cleanup_done
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$APPDATA\Pi Flow\uninstall-runtime.ps1"'
    Pop $R3
  piflow_cleanup_done:

  ; 清理脚本返回非 0 表示有组件没删掉；静默卸载不弹窗，日志在 %TEMP%。
  StrCmp $R3 "0" piflow_cleanup_ok
  IfSilent piflow_cleanup_ok
  StrCmp $R3 "missing" 0 piflow_cleanup_partial
    StrCmp $R0 "zh" 0 piflow_cleanup_missing_en
      MessageBox MB_OK|MB_ICONEXCLAMATION "卸载清理脚本缺失，本次安装的 Node / pi 可能没有被删除。"
      Goto piflow_cleanup_ok
    piflow_cleanup_missing_en:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The uninstall cleanup script is missing; Node / pi installed by this setup may not have been removed."
      Goto piflow_cleanup_ok
  piflow_cleanup_partial:
    StrCmp $R0 "zh" 0 piflow_cleanup_partial_en
      MessageBox MB_OK|MB_ICONEXCLAMATION "部分组件未能删除，详见 %TEMP%\PiFlow-uninstall.log。"
      Goto piflow_cleanup_ok
    piflow_cleanup_partial_en:
      MessageBox MB_OK|MB_ICONEXCLAMATION "Some components could not be removed. See %TEMP%\PiFlow-uninstall.log."
  piflow_cleanup_ok:

  RMDir /r "$APPDATA\Pi Flow"
  SetShellVarContext all
  ${endif}
!macroend

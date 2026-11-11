# Pi Flow 卸载清理
#
# 由 NSIS 的 customUnInstall 在删除安装目录之后调用，脚本位于 %APPDATA%\Pi Flow。
# 只回收 setup-result.json 里记录为“本次安装创建”的东西，最后清空整个数据目录。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File uninstall-runtime.ps1 [-DryRun]

param(
    [switch]$DryRun,
    [string]$Locale = ''
)

# 没传 -Locale 时读安装窗口留下的标记；文件缺失或无效按英文。
if (-not $Locale) {
    $localeFile = Join-Path $PSScriptRoot 'ui-locale.txt'
    try {
        $Locale = (Get-Content -LiteralPath $localeFile -Raw -ErrorAction Stop).Trim()
    }
    catch {
        $Locale = 'en'
    }
}
$script:UiLocale = if ($Locale -eq 'zh') { 'zh' } else { 'en' }

function T([string]$Zh, [string]$En) {
    if ($script:UiLocale -eq 'zh') { return $Zh }
    return $En
}

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$resultFile = Join-Path $root 'setup-result.json'
$logFile = Join-Path $root 'uninstall.log'
$selfName = $MyInvocation.MyCommand.Name

function Write-Log([string]$Message) {
    $prefix = if ($DryRun) { '[dry-run] ' } else { '' }
    Write-Host ($prefix + $Message)
    try {
        Add-Content -LiteralPath $logFile -Value ("[" + (Get-Date -Format 'HH:mm:ss') + "] " + $prefix + $Message) -Encoding UTF8
    }
    catch {
        # 日志写不进去不影响清理。
    }
}

function Invoke-CleanupProcess {
    param([string]$FilePath, [string[]]$ArgumentList = @(), [int]$TimeoutSeconds = 600, [string]$What = 'command')
    $process = $null
    try {
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $FilePath
        $info.Arguments = ($ArgumentList -join ' ')
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $info
        [void]$process.Start()
        $null = $process.StandardOutput.ReadToEndAsync()
        $null = $process.StandardError.ReadToEndAsync()

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
            & $taskkill /PID $process.Id /T /F 2>$null | Out-Null
            if (-not $process.WaitForExit(15000)) {
                try { $process.Kill() } catch { }
            }
            Write-Log (T "  $What 超时，已终止" "  $What timed out; terminated")
            return -1
        }
        $process.WaitForExit()
        Write-Log (T "  $What 退出码 $($process.ExitCode)" "  $What exited with code $($process.ExitCode)")
        return $process.ExitCode
    }
    catch {
        Write-Log (T "  $What 执行失败：$($_.Exception.Message)" "  $What failed: $($_.Exception.Message)")
        return -2
    }
    finally {
        if ($process) { $process.Dispose() }
    }
}

function Uninstall-WingetPackage([string]$Id) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Log (T "  没有 winget，跳过 $Id" "  winget not found; skipping $Id")
        return
    }
    Write-Log (T "  winget 卸载 $Id" "  winget uninstall $Id")
    if ($DryRun) { return }
    $null = Invoke-CleanupProcess $winget.Source @(
        'uninstall', '--id', $Id, '-e', '--source', 'winget',
        '--accept-source-agreements', '--disable-interactivity'
    ) 900 "winget uninstall $Id"
}

function Read-Managed {
    if (-not (Test-Path -LiteralPath $resultFile)) {
        Write-Log (T "没有找到安装清单，按保守方式只清理数据目录" "No install manifest found; cleaning only the data directory")
        return $null
    }
    try {
        $raw = [System.IO.File]::ReadAllText($resultFile, [System.Text.Encoding]::UTF8)
        $data = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
        return $data.managed
    }
    catch {
        Write-Log (T "读取安装清单失败：$($_.Exception.Message)" "Failed to read the install manifest: $($_.Exception.Message)")
        return $null
    }
}

$managed = Read-Managed

Write-Log (T "Pi Flow 卸载清理开始：$root" "Pi Flow uninstall cleanup started: $root")

if ($managed) {
    # 1. 全局 pi（必须在卸载 Node 之前，否则 npm 先没了）。
    if ($managed.piInstalled) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if ($npm) {
            Write-Log (T "卸载全局 pi" "Uninstalling global pi")
            if (-not $DryRun) {
                $null = Invoke-CleanupProcess $env:ComSpec @(
                    '/d', '/s', '/c', "`"$($npm.Source)`" uninstall -g @earendil-works/pi-coding-agent"
                ) 600 'npm uninstall pi'
            }
        }
        else {
            Write-Log (T "  没有找到 npm，跳过全局 pi" "  npm not found; skipping global pi")
        }
    }

    # 2. Python：优先用当初的安装包卸载，找不到再试 winget。
    if ($managed.pythonInstalled) {
        $method = [string]$managed.pythonMethod
        $installer = [string]$managed.pythonInstaller
        if ($method -eq 'installer' -and $installer -and (Test-Path -LiteralPath $installer)) {
            $downloads = [System.IO.Path]::GetFullPath((Join-Path $root 'runtime\downloads'))
            $fullInstaller = [System.IO.Path]::GetFullPath($installer)
            if ($fullInstaller.StartsWith($downloads, [System.StringComparison]::OrdinalIgnoreCase)) {
                Write-Log (T "卸载 Python 3.13（$installer）" "Uninstalling Python 3.13 ($installer)")
                if (-not $DryRun) {
                    $null = Invoke-CleanupProcess $installer @('/uninstall', '/quiet') 900 (T 'Python 卸载' 'Python uninstall')
                }
            }
            else {
                Write-Log (T "  Python 安装包不在 downloads 目录，改用 winget" "  Python installer is outside downloads; using winget")
                Uninstall-WingetPackage 'Python.Python.3.13'
            }
        }
        else {
            Uninstall-WingetPackage 'Python.Python.3.13'
        }
    }

    # 3. Git（只有 winget 安装的才回收；PortableGit 在 runtime 里随目录删除）。
    if ($managed.gitMethod -eq 'winget') {
        Uninstall-WingetPackage 'Git.Git'
    }

    # 4. fd / rg：只删本次新建的文件。
    $agentBinDir = [string]$managed.agentBinDir
    if ($agentBinDir -and $managed.tools) {
        foreach ($name in @('fd', 'rg')) {
            $state = $null
            if ($managed.tools.PSObject.Properties[$name]) { $state = $managed.tools.$name }
            if ($state -ne 'created') { continue }
            $fileName = if ($name -eq 'rg') { 'rg.exe' } else { 'fd.exe' }
            $file = Join-Path $agentBinDir $fileName
            if (Test-Path -LiteralPath $file) {
                Write-Log (T "删除 $file" "Removing $file")
                if (-not $DryRun) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
            }
        }
        # 空目录才删除，避免动到用户其他内容。
        foreach ($dir in @($agentBinDir, (Split-Path -Parent $agentBinDir))) {
            if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
            if (Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue) { continue }
            if (-not $DryRun) { Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue }
        }
    }

    # 5. Node 最后卸载，避免影响前面的 npm。
    if ($managed.nodeInstalled) {
        Uninstall-WingetPackage 'OpenJS.NodeJS'
    }
}

# 6. 清空整个数据目录（含 runtime / config / workspace / agents / state.json / 缓存）。
Write-Log (T "删除 Pi Flow 数据目录内容：$root" "Removing Pi Flow data directory contents: $root")
if (-not $DryRun) {
    foreach ($item in (Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue)) {
        if ($item.Name -eq $selfName -or $item.Name -eq 'uninstall.log') { continue }
        try {
            Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Log (T "  未能删除 $($item.FullName)：$($_.Exception.Message)" "  Could not remove $($item.FullName): $($_.Exception.Message)")
        }
    }
}

Write-Log (T "Pi Flow 卸载清理完成" "Pi Flow uninstall cleanup finished")
exit 0

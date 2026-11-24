# 安装引擎的公共能力：日志、进程超时、探测和内置资源定位。
# 所有函数通过 $script:Setup 读取路径和开关，不直接依赖入口参数。

$MinNode = [version]'22.19.0'
$NpmPackage = '@earendil-works/pi-coding-agent'
$CnNpmRegistry = 'https://registry.npmmirror.com'

function Resolve-FullPath([string]$Path) {
    if (-not $Path) { return $Path }
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        $Path = Join-Path (Get-Location) $Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Ensure-Directory([string]$Path) {
    if (-not $Path) { return }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Yellow
}

# 在安装包内置的离线资源目录里按通配符找文件，找不到返回 $null。
function Get-BundledFile([string[]]$Patterns) {
    $bundleDir = $script:Setup.BundleDir
    if (-not $bundleDir -or -not (Test-Path -LiteralPath $bundleDir)) { return $null }
    foreach ($pattern in $Patterns) {
        # 目录里同时存在新旧版本时，用最后写入时间选最新的，避免版本号字符串排序出错。
        $found = Get-ChildItem -LiteralPath $bundleDir -File -Filter $pattern -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

# 带硬超时的外部命令执行：网络卡住时杀掉整个进程树，避免安装脚本无限等待。
# 返回退出码；超时返回 -1。
function Invoke-ProcessWithTimeout {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int]$TimeoutSeconds = 600,
        [string]$What = '外部命令'
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $process = $null
    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $FilePath
        if ($ArgumentList.Count -gt 0) { $startInfo.Arguments = ($ArgumentList -join ' ') }
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        # 异步读流，避免子进程写满管道缓冲区后卡住。
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            Write-WarnLine "$What 超过 $TimeoutSeconds 秒未完成，已终止"
            $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
            & $taskkill /PID $process.Id /T /F 2>$null | Out-Null
            if (-not $process.WaitForExit(15000)) {
                try { $process.Kill() } catch { }
            }
            Write-ProcessOutput $outTask $errTask 40
            return -1
        }

        $process.WaitForExit()
        Write-ProcessOutput $outTask $errTask 200
        return $process.ExitCode
    }
    finally {
        $ErrorActionPreference = $previous
        if ($process) { $process.Dispose() }
    }
}

function Write-ProcessOutput($OutTask, $ErrTask, [int]$TailLines) {
    foreach ($task in @($OutTask, $ErrTask)) {
        try {
            # 子进程已退出，但外部孙进程可能仍占着管道，不能无限等 Result。
            if ($task.Wait(3000) -and $task.IsCompleted -and -not $task.IsFaulted) {
                $text = $task.Result
                if ($text) {
                    $text -split '\r?\n' | Where-Object { $_.Trim() } | Select-Object -Last $TailLines | Out-Host
                }
            }
        }
        catch {
            # 读流失败只影响日志，不影响退出码。
        }
    }
}

# winget 自身没有下载超时，统一走这个封装；超时返回 -1。
function Invoke-Winget {
    param(
        [string[]]$WingetArgs,
        [string]$What,
        [int]$TimeoutSeconds = 900
    )
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { return -2 }
    # 只用 winget 源，避免 msstore 源更新或协议交互把安装卡住。
    $allArgs = @($WingetArgs) + @(
        '--source', 'winget',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity'
    )
    return (Invoke-ProcessWithTimeout -FilePath $winget.Source -ArgumentList $allArgs -TimeoutSeconds $TimeoutSeconds -What $What)
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-GithubReachable {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $true }
    & curl.exe -fsI --connect-timeout 5 --max-time 8 -o NUL "https://github.com" | Out-Null
    return $LASTEXITCODE -eq 0
}

function Get-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}

function Get-NodeVersion {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & node -v 2>$null
        if ($LASTEXITCODE -eq 0 -and $raw) {
            return [version]($raw.Trim().TrimStart('v'))
        }
        $nodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (Test-Path -LiteralPath $nodeExe) {
            $raw = & $nodeExe -v 2>$null
            if ($LASTEXITCODE -eq 0 -and $raw) {
                return [version]($raw.Trim().TrimStart('v'))
            }
        }
        return $null
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-GitBash {
    $portable = Join-Path $script:Setup.RuntimeDir 'git\bin\bash.exe'
    if (Test-Path -LiteralPath $portable) { return $portable }
    foreach ($candidate in @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
    )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($bash -and $bash.Source) { return $bash.Source }
    return $null
}

function Get-AgentDir {
    if ($env:PI_CODING_AGENT_DIR) { return $env:PI_CODING_AGENT_DIR }
    return Join-Path $env:USERPROFILE '.pi\agent'
}

function Get-AgentBinDir {
    return Join-Path (Get-AgentDir) 'bin'
}

function Get-PiCommand {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $cmd = Get-Command pi -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) {
            $out = & $cmd.Source --version 2>$null
            if ($LASTEXITCODE -eq 0) {
                $version = (($out | Select-Object -Last 1) -as [string]).Trim()
                return [pscustomobject]@{ Path = $cmd.Source; Version = $version }
            }
        }

        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if ($npm -and $npm.Source) {
            $prefix = (& $npm.Source prefix -g 2>$null | Select-Object -Last 1)
            if ($prefix) {
                foreach ($name in @('pi.cmd', 'pi.ps1', 'pi')) {
                    $candidate = Join-Path $prefix.Trim() $name
                    if (Test-Path -LiteralPath $candidate) {
                        $out = & $candidate --version 2>$null
                        if ($LASTEXITCODE -eq 0) {
                            $version = (($out | Select-Object -Last 1) -as [string]).Trim()
                            return [pscustomobject]@{ Path = $candidate; Version = $version }
                        }
                    }
                }
            }
        }
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-PiCliPath {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm -or -not $npm.Source) { return $null }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $root = (& $npm.Source root -g 2>$null | Select-Object -Last 1)
        if (-not $root) { return $null }
        foreach ($rel in @(
            '@earendil-works/pi-coding-agent/dist/bundle/cli.js',
            '@earendil-works/pi-coding-agent/dist/cli.js'
        )) {
            $candidate = Join-Path $root.Trim() $rel
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-TarExe {
    # PATH 里可能先命中 Git 自带的 GNU tar，它会把 C:\ 当成远程主机，必须用 Windows 自带的。
    foreach ($name in @('tar.exe', 'bsdtar.exe')) {
        $candidate = Join-Path $env:SystemRoot "System32\$name"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Test-BlenderArchive([string]$Archive) {
    if (-not (Test-Path -LiteralPath $Archive)) { return $false }
    if ((Get-Item -LiteralPath $Archive).Length -lt 100000000) { return $false }
    $tar = Get-TarExe
    if (-not $tar) { return $true }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $listing = & $tar -tf $Archive 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return ($code -eq 0) -and ([bool]($listing | Where-Object { $_ -like '*blender.exe' }))
}

function Get-BlenderExe {
    $srcBlender = $script:Setup.BlenderSrcBlender
    $srcExe = $script:Setup.BlenderSrcBlenderExe
    if (Test-Path -LiteralPath $srcExe) { return $srcExe }
    $nested = Join-Path $srcBlender 'bin\blender.exe'
    if (Test-Path -LiteralPath $nested) { return $nested }

    # 兼容旧版部署位置：<runtime>\blender\...
    $legacyRoot = Join-Path $script:Setup.RuntimeDir 'blender'
    if (-not (Test-Path -LiteralPath $legacyRoot)) { return $null }
    $direct = Join-Path $legacyRoot 'blender.exe'
    if (Test-Path -LiteralPath $direct) { return $direct }
    $found = Get-ChildItem -LiteralPath $legacyRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'blender.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    return $found
}

# 统一成 x.y.z 再比较：Blender 的 ProductVersion 是 "4.5"，压缩包名里是 "4.5.0"。
function Normalize-BlenderVersion([string]$Version) {
    if ($Version -and ($Version -match '^(\d+)\.(\d+)(?:\.(\d+))?')) {
        $patch = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
        return "$($Matches[1]).$($Matches[2]).$patch"
    }
    return ''
}

# 记录安装结果时用真实文件版本，避免旧机器被误记成本版期望的版本。
function Get-BlenderFileVersion([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
    try {
        $version = (Get-Item -LiteralPath $Path).VersionInfo.ProductVersion
        return (Normalize-BlenderVersion $version)
    }
    catch {
        return ''
    }
}

# 已铺好的 Blender 构建标记：只有 setup 真正解压过压缩包才会写，用它识别同版本换包。
function Get-BlenderInstalledBuild {
    $file = $script:Setup.BlenderBuildFile
    if (-not $file -or -not (Test-Path -LiteralPath $file)) { return '' }
    try {
        return (Get-Content -LiteralPath $file -Raw -ErrorAction Stop).Trim()
    }
    catch {
        return ''
    }
}

# Blender 内置 python：与 blender.exe 同目录的 4.5\python\bin\python.exe。
# 安装器不再单独装 Python —— 外层胶水脚本直接用它（几何包已 pip 进 zip 里的 site-packages）。
function Get-BlenderPythonExe([string]$BlenderExe) {
    if (-not $BlenderExe) { return $null }
    $root = Split-Path -Parent $BlenderExe
    # Blender 把内置 python 放在 <版本目录>\python\bin\python.exe，版本目录名随 Blender 变化。
    $direct = Join-Path $root 'python\bin\python.exe'
    if (Test-Path -LiteralPath $direct) { return $direct }
    $found = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'python\bin\python.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    return $found
}

function Test-ToolReady([string]$Name) {
    $fileName = if ($Name -eq 'rg') { 'rg.exe' } else { 'fd.exe' }
    $local = Join-Path $script:Setup.BinDir $fileName
    $candidates = @()
    if (Test-Path -LiteralPath $local) { $candidates += $local }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $candidates += $cmd.Source }
    foreach ($candidate in $candidates) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $candidate --version 1>$null 2>$null
            $ok = ($LASTEXITCODE -eq 0)
        }
        finally {
            $ErrorActionPreference = $previous
        }
        if ($ok) { return $candidate }
    }
    return $null
}

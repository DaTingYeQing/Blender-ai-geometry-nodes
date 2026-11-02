# One-click installer (Windows): Pi + Python venv + Blender.
# 一键安装（Windows）：Pi + Python 虚拟环境 + Blender。
# Install the latest Pi, a Python 3.13 venv with pinned packages, and Blender 4.5.0.
# 安装最新版 Pi、一个 Python 3.13 虚拟环境（含固定版本依赖），以及 Blender 4.5.0。
# Blender / fd / rg 三个文件并行下载，只显示进度条。
# 运行时按提示输入 Blender 目录和 venv 目录；国内/官方源自动判断。
#
# Usage / 用法:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Pi / Node
$MinNode = [version]'22.19.0'
$NpmPackage = '@earendil-works/pi-coding-agent'
$CnNpmRegistry = 'https://registry.npmmirror.com'
$GhMirrors = @(
    'https://ghfast.top/',
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
    'https://mirror.ghproxy.com/'
)

# Python
$MinPython = [version]'3.13.0'
$Packages = @(
    'numpy==2.5.3',
    'scipy==1.18.1',
    'pyvista==0.49.0',
    'trimesh==5.1.0',
    'manifold3d==3.5.3'
)
$OfficialPipIndexes = @('https://pypi.org/simple')
$CnPipIndexes = @(
    'https://pypi.tuna.tsinghua.edu.cn/simple',
    'https://mirrors.aliyun.com/pypi/simple',
    'https://mirrors.cloud.tencent.com/pypi/simple'
)

# Blender
$BlenderZipUrl = 'https://download.blender.org/release/Blender4.5/blender-4.5.0-windows-x64.zip'
$BlenderMirrors = @(
    'https://mirrors.tuna.tsinghua.edu.cn/blender/release/Blender4.5/blender-4.5.0-windows-x64.zip',
    'https://mirror.nju.edu.cn/blender/release/Blender4.5/blender-4.5.0-windows-x64.zip'
)
$BlenderFolder = 'blender-4.5.0-windows-x64'

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Yellow
}

# Reload PATH from the registry after winget installs a program. / winget 装完程序后，从注册表重新加载 PATH。
function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

# A short GitHub check decides China mirrors versus official sources. / 用一次短连接判断走国内镜像还是官方源。
function Test-GithubReachable {
    & curl.exe -fsI --connect-timeout 5 --max-time 8 -o NUL "https://github.com" | Out-Null
    return $LASTEXITCODE -eq 0
}

# China tries mirrors first; elsewhere tries GitHub first, then the same mirrors. / 国内先试镜像，其他地区先试 GitHub，失败后再试同样的镜像。
function Get-SourceOrder([string]$GithubUrl) {
    $mirrored = foreach ($prefix in $GhMirrors) { $prefix + $GithubUrl }
    if ($script:PreferCn) {
        return @($mirrored) + $GithubUrl
    }
    return @($GithubUrl) + @($mirrored)
}

# China tries mirrors first; elsewhere tries PyPI first, then the same mirrors. / 国内先试镜像，其他地区先试官方源，失败后再试镜像。
function Get-PipIndexOrder {
    if ($script:PreferCn) {
        return @($CnPipIndexes) + $OfficialPipIndexes
    }
    return @($OfficialPipIndexes) + @($CnPipIndexes)
}

# China tries Blender mirrors first; elsewhere tries the official site first, then mirrors. / 国内先试 Blender 镜像，其他地区先试官方站，失败后再试镜像。
function Get-BlenderUrlOrder {
    if ($script:PreferCn) {
        return @($BlenderMirrors) + $BlenderZipUrl
    }
    return @($BlenderZipUrl) + @($BlenderMirrors)
}

# Read the GitHub releases page and pick a matching asset. / 读取 GitHub 发布页，选出匹配当前系统的安装包。
function Find-InReleasePages([string]$Repo, [string]$FileRegex) {
    $tmp = Join-Path $script:WorkDir 'releases.html'
    foreach ($source in (Get-SourceOrder "https://github.com/$Repo/releases")) {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
        & curl.exe -fsSL --connect-timeout 12 --max-time 45 -A "pi-setup" -o $tmp $source
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp)) { continue }
        $html = Get-Content -LiteralPath $tmp -Raw
        $match = [regex]::Match($html, "releases/download/([^""'\s>]+)/($FileRegex)")
        if ($match.Success) {
            $tag = $match.Groups[1].Value
            $file = $match.Groups[2].Value
            return "https://github.com/$Repo/releases/download/$tag/$file"
        }
    }
    return $null
}

# Follow the /releases/latest redirect when the release page has no matching file. / 发布页没有对应文件时，跟随 /releases/latest 跳转取得版本号。
function Get-LatestVersion([string]$Repo) {
    $headerFile = Join-Path $script:WorkDir 'latest-headers.txt'
    foreach ($source in (Get-SourceOrder "https://github.com/$Repo/releases/latest")) {
        if (Test-Path -LiteralPath $headerFile) { Remove-Item -LiteralPath $headerFile -Force }
        & curl.exe -sI -L --max-redirs 5 --connect-timeout 12 --max-time 30 -A "pi-setup" -o $headerFile $source
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $headerFile)) { continue }
        $headers = Get-Content -LiteralPath $headerFile -Raw
        $tagMatch = [regex]::Match($headers, '/releases/tag/v?([0-9]+\.[0-9]+\.[0-9]+)')
        if ($tagMatch.Success) { return $tagMatch.Groups[1].Value }
    }
    return $null
}

# fd tags look like v10.2.0; ripgrep tags have no v prefix. / fd 的标签带 v，例如 v10.2.0；ripgrep 的标签不带 v。
function Resolve-ToolUrl([string]$Repo, [string]$TagPrefix, [string[]]$FileTemplates) {
    foreach ($template in $FileTemplates) {
        $regex = [regex]::Escape($template).Replace('\{version\}', '[0-9]+\.[0-9]+\.[0-9]+')
        $found = Find-InReleasePages $Repo $regex
        if ($found) { return $found }
    }

    $template = $FileTemplates[0]
    if ($template -notmatch '\{version\}') {
        $versionMatch = [regex]::Match($template, '([0-9]+\.[0-9]+\.[0-9]+)')
        if (-not $versionMatch.Success) { return $null }
        $tag = "$TagPrefix$($versionMatch.Groups[1].Value)"
        return "https://github.com/$Repo/releases/download/$tag/$template"
    }

    $version = Get-LatestVersion $Repo
    if (-not $version) { return $null }
    $file = $template.Replace('{version}', $version)
    return "https://github.com/$Repo/releases/download/$TagPrefix$version/$file"
}

# Pi requires Node.js 22.19 or newer. / Pi 需要 Node.js 22.19 或更新版本。
function Get-NodeVersion {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & node -v 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
        return [version]($raw.Trim().TrimStart('v'))
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

# Ask before upgrading an existing Node.js that is too old. Y continues, N exits. / 已安装的 Node.js 版本过低时先询问。按 Y 更新并继续，按 N 退出。
function Read-NodeUpgradeChoice {
    while ($true) {
        Write-Host "按 Y 更新并继续，按 N 退出。 / Press Y to upgrade and continue, N to exit" -ForegroundColor Yellow
        $key = $null
        if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            $pressed = [Console]::ReadKey($true)
            $key = $pressed.KeyChar
            Write-Host $key
        }
        else {
            $line = Read-Host "请输入 Y 或 N / Enter Y or N"
            if ($line) { $key = $line.Trim()[0] }
        }
        switch -Regex ([string]$key) {
            '^[yY]$' { return $true }
            '^[nN]$' { return $false }
        }
        Write-Host "请按 Y 或 N。 / Please press Y or N"
    }
}

# Silent Node.js install when Node is missing. No confirmation prompt. / 电脑上没有 Node.js 时静默安装，不再询问确认。
function Install-Node {
    Write-Step "安装 Node.js（需要 $MinNode 或更新） / Installing Node.js (requires $MinNode or newer)"
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "没有找到 Node.js 和 winget。请先安装 Node.js $MinNode 或更新: https://nodejs.org / Neither Node.js nor winget was found. Install Node.js $MinNode or newer first: https://nodejs.org"
    }
    & winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        throw "winget 安装 Node.js 失败，退出码 $LASTEXITCODE / winget failed to install Node.js, exit code $LASTEXITCODE"
    }
    Refresh-Path
}

# Upgrade Node.js after the user presses Y. / 用户按 Y 之后升级 Node.js。
function Update-Node {
    Write-Step "更新 Node.js（需要 $MinNode 或更新） / Updating Node.js (requires $MinNode or newer)"
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "没有 winget，无法自动更新。请安装 Node.js $MinNode 或更新: https://nodejs.org / winget is missing, so the automatic update cannot run. Install Node.js $MinNode or newer: https://nodejs.org"
    }
    & winget upgrade --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        & winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) {
            throw "winget 更新 Node.js 失败，退出码 $LASTEXITCODE / winget failed to update Node.js, exit code $LASTEXITCODE"
        }
    }
    Refresh-Path
}

# Run a Python version probe. Returns [version] or $null. / 探测 Python 版本，成功返回 [version]，失败返回 $null。
function Get-PythonVersion([string[]]$Cmd) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $rest = @($Cmd | Select-Object -Skip 1)
        $out = & $Cmd[0] @rest --version 2>$null | Out-String
        if ($LASTEXITCODE -ne 0) { return $null }
        $m = [regex]::Match($out, '(\d+)\.(\d+)\.(\d+)')
        if (-not $m.Success) { return $null }
        return [version]$m.Value
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

# Prefer the py launcher pinned to 3.13, then python, then py -3. / 优先用 py -3.13，其次 python，再其次 py -3。
function Find-Python {
    foreach ($candidate in @(@('py', '-3.13'), @('python'), @('py', '-3'))) {
        $v = Get-PythonVersion $candidate
        if ($v -and $v.Major -eq 3 -and $v.Minor -eq 13) {
            return @{ Cmd = $candidate; Version = $v }
        }
    }
    return $null
}

# Silent Python 3.13 install when it is missing. No confirmation prompt. / 电脑上没有 Python 3.13 时静默安装，不再询问确认。
function Install-Python {
    Write-Step "安装 Python 3.13（需要 $MinPython 或更新） / Installing Python 3.13 (requires $MinPython or newer)"
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "没有找到 Python 3.13 和 winget。请先安装 Python 3.13: https://www.python.org / Neither Python 3.13 nor winget was found. Install Python 3.13 first: https://www.python.org"
    }
    & winget install --id Python.Python.3.13 -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        throw "winget 安装 Python 3.13 失败，退出码 $LASTEXITCODE / winget failed to install Python 3.13, exit code $LASTEXITCODE"
    }
    Refresh-Path
}

# Ask before installing Python 3.13 alongside an existing non-3.13 Python. Y continues, N exits. / 已有 Python 但不是 3.13 时先询问。按 Y 安装 3.13 并继续，按 N 退出。
function Read-PythonInstallChoice {
    while ($true) {
        Write-Host "按 Y 安装 Python 3.13 并继续，按 N 退出。 / Press Y to install Python 3.13 and continue, N to exit" -ForegroundColor Yellow
        $line = Read-Host "请输入 Y 或 N / Enter Y or N"
        $key = $null
        if ($line) { $key = $line.Trim()[0] }
        switch -Regex ([string]$key) {
            '^[yY]$' { return $true }
            '^[nN]$' { return $false }
        }
        Write-Host "请按 Y 或 N。 / Please press Y or N"
    }
}

# Try each pip index in order until one succeeds. / 按顺序尝试每个 pip 源，直到有一个成功。
function Invoke-Pip {
    param([string]$VenvPython, [string[]]$PipArgs)
    $lastError = '没有可用源 / No usable index'
    foreach ($index in (Get-PipIndexOrder)) {
        Write-Host "    pip 源 $index / pip index $index"
        & $VenvPython -m pip @PipArgs --index-url $index --disable-pip-version-check --no-input
        if ($LASTEXITCODE -eq 0) { return }
        $lastError = "pip 退出码 $LASTEXITCODE / pip exit code $LASTEXITCODE"
    }
    throw "pip 失败: $lastError / pip failed: $lastError"
}

# Pi config lives in ~/.pi/agent, unless PI_CODING_AGENT_DIR is set. / Pi 的配置目录默认是 ~/.pi/agent，设置了 PI_CODING_AGENT_DIR 时改用该目录。
function Get-AgentDir {
    if ($env:PI_CODING_AGENT_DIR) { return $env:PI_CODING_AGENT_DIR }
    return Join-Path $env:USERPROFILE '.pi\agent'
}

function Get-AgentBinDir {
    return Join-Path (Get-AgentDir) 'bin'
}

# Create empty extension and skill folders. Existing files stay in place. / 创建空的 extensions 和 skills。目录里已有的文件会保留。
function New-AgentResourceDirs {
    foreach ($name in @('extensions', 'skills')) {
        $path = Join-Path (Get-AgentDir) $name
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-Ok "已创建 $path / Created $path"
    }
}

# Copy the repo's skills, extensions and config into Pi's agent directory. / 把仓库里的技能、扩展和配置复制到 Pi 的 agent 目录。
function Copy-RepoToAgent {
    param([string]$RepoDir)

    $agentDir = Get-AgentDir
    $skillsDir = Join-Path $agentDir 'skills'
    $extDir = Join-Path $agentDir 'extensions'

    # 4 folders -> skills / 4 个文件夹放进 skills
    foreach ($name in @('_shared', 'execution', 'math', 'node_information')) {
        $src = Join-Path $RepoDir $name
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $skillsDir -Recurse -Force
            Write-Ok "已复制 $name -> $skillsDir / Copied $name -> $skillsDir"
        }
    }

    # All .ts files -> extensions / 所有 .ts 文件放进 extensions
    $tsFiles = @(Get-ChildItem -LiteralPath $RepoDir -Filter '*.ts' -File)
    foreach ($f in $tsFiles) {
        Copy-Item -LiteralPath $f.FullName -Destination $extDir -Force
    }
    Write-Ok "已复制 $($tsFiles.Count) 个 .ts 文件 -> $extDir / Copied $($tsFiles.Count) .ts files -> $extDir"

    # py_environment.json + APPEND_SYSTEM.md -> agent dir / 两个配置文件放进 agent 目录
    foreach ($name in @('py_environment.json', 'APPEND_SYSTEM.md')) {
        $src = Join-Path $RepoDir $name
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $agentDir -Force
            Write-Ok "已复制 $name -> $agentDir / Copied $name -> $agentDir"
        }
    }
}

# Skip the download when Pi's bin directory or PATH already has a working tool. / Pi 的 bin 目录或 PATH 里已经有可用工具时，跳过下载。
function Test-ToolReady([string]$Name) {
    $fileName = if ($Name -eq 'rg') { 'rg.exe' } else { 'fd.exe' }
    $local = Join-Path $script:BinDir $fileName
    $candidates = @()
    if (Test-Path -LiteralPath $local) { $candidates += $local }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $candidates += $cmd.Source }
    foreach ($candidate in $candidates) {
        & $candidate --version 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) { return $candidate }
    }
    return $null
}

# Pi's command tool on Windows runs through Git Bash. Install it without prompts. / Windows 上 Pi 的命令工具依赖 Git Bash。安装过程不再询问。
function Install-GitBash {
    $candidates = @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            Write-Ok "Git Bash 已存在: $candidate / Git Bash already present: $candidate"
            return
        }
    }
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($bash) {
        Write-Ok "bash 已在 PATH: $($bash.Source) / bash is already on PATH: $($bash.Source)"
        return
    }

    Write-Step "安装 Git for Windows（Pi 的命令工具要用 Git Bash，安装过程不再询问） / Installing Git for Windows (Pi's command tool needs Git Bash; the install runs without prompts)"
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-WarnLine "没有 winget，跳过 Git。Pi 可以打开，但 bash 工具需要 Git for Windows。 / winget is missing, so Git is skipped. Pi still opens, but the bash tool needs Git for Windows."
        return
    }
    & winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) {
        Write-WarnLine "Git 静默安装失败（退出码 $LASTEXITCODE）。Pi 本体不受影响，bash 工具需要稍后安装 Git for Windows。 / The silent Git install failed (exit code $LASTEXITCODE). Pi itself is unaffected, but the bash tool needs Git for Windows installed later."
        return
    }
    Refresh-Path
    Write-Ok "Git for Windows 已安装 / Git for Windows installed"
}

# Install only the official Pi package. Do not change the user's saved npm registry. / 只安装官方 Pi 包，不修改用户原来保存的 npm 源。
function Install-Pi {
    Write-Step "安装最新版 Pi ($NpmPackage) / Installing the latest Pi ($NpmPackage)"
    $registryArgs = @()
    if ($script:PreferCn) {
        $registryArgs = @('--registry', $CnNpmRegistry)
        Write-Ok "npm 使用国内镜像 $CnNpmRegistry / npm uses the China mirror $CnNpmRegistry"
    }
    else {
        Write-Ok "npm 使用官方源 / npm uses the official registry"
    }

    $env:npm_config_fund = 'false'
    $env:npm_config_audit = 'false'
    $env:npm_config_update_notifier = 'false'
    & npm install -g --ignore-scripts --no-fund --no-audit --loglevel=error @registryArgs $NpmPackage
    if ($LASTEXITCODE -ne 0) {
        throw "npm 安装 Pi 失败，退出码 $LASTEXITCODE / npm failed to install Pi, exit code $LASTEXITCODE"
    }

    $prefix = (& npm prefix -g).Trim()
    $piCmd = Join-Path $prefix 'pi.cmd'
    if (-not (Test-Path -LiteralPath $piCmd)) {
        $piCmd = Join-Path $prefix 'pi'
    }
    $version = & $piCmd --version
    if ($LASTEXITCODE -ne 0) {
        throw "Pi 已安装，但 pi --version 失败 / Pi is installed, but pi --version failed"
    }
    Write-Ok ("Pi " + ($version | Select-Object -Last 1))
    $script:PiCommand = $piCmd
}

# Fetch Content-Length from the first reachable URL so the progress bar can show a percentage. / 从第一个可访问的地址取文件大小，进度条才能显示百分比。
function Get-ContentLength([string[]]$Urls) {
    foreach ($u in $Urls) {
        $headers = & curl.exe -fsIL --connect-timeout 12 --max-time 30 $u 2>$null
        if ($LASTEXITCODE -eq 0) {
            $text = $headers | Out-String
            $ms = [regex]::Matches($text, '(?i)content-length:\s*(\d+)')
            if ($ms.Count -gt 0) {
                return [long]$ms[$ms.Count - 1].Groups[1].Value
            }
        }
    }
    return $null
}

# Download several files at once and show one progress bar per file. / 并行下载多个文件，每个文件显示一条进度条。
function Invoke-ParallelDownloads {
    param([hashtable[]]$Items)

    $prevProgress = $ProgressPreference
    $ProgressPreference = 'Continue'

    try {
        $jobs = @()
        $id = 0
        foreach ($item in $Items) {
            $id++
            $total = Get-ContentLength $item.Urls
            $job = Start-Job -ArgumentList (,$item) -ScriptBlock {
                param($it)
                foreach ($u in $it.Urls) {
                    if (Test-Path -LiteralPath $it.Dest) { Remove-Item -LiteralPath $it.Dest -Force }
                    for ($attempt = 0; $attempt -lt 3; $attempt++) {
                        & curl.exe -fLsS -C - --connect-timeout 12 --max-time 1800 -o $it.Dest $u
                        if ($LASTEXITCODE -eq 0) { break }
                        Start-Sleep -Seconds 1
                    }
                    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $it.Dest) -and ((Get-Item -LiteralPath $it.Dest).Length -ge $it.MinBytes)) {
                        return @{ Ok = $true; Url = $u }
                    }
                }
                return @{ Ok = $false; Url = '' }
            }
            $jobs += [pscustomobject]@{ Id = $id; Name = $item.Name; Dest = $item.Dest; Total = $total; Job = $job }
        }

        if ($jobs.Count -eq 0) { return }

        $running = @($jobs)
        while ($running.Count -gt 0) {
            foreach ($entry in $jobs) {
                if ($entry.Job.State -in @('Completed', 'Failed')) {
                    Write-Progress -Id $entry.Id -Activity "下载 $($entry.Name) / Downloading $($entry.Name)" -Status '完成 / done' -PercentComplete 100
                }
                else {
                    $size = 0
                    if (Test-Path -LiteralPath $entry.Dest) { $size = (Get-Item -LiteralPath $entry.Dest).Length }
                    $pct = -1
                    $status = "{0:N1} MB" -f ($size / 1MB)
                    if ($entry.Total -gt 0) {
                        $pct = [math]::Min(100, [int]($size * 100 / $entry.Total))
                        $status = "{0:N1} / {1:N1} MB" -f ($size / 1MB), ($entry.Total / 1MB)
                    }
                    Write-Progress -Id $entry.Id -Activity "下载 $($entry.Name) / Downloading $($entry.Name)" -Status $status -PercentComplete $pct
                }
            }
            Start-Sleep -Milliseconds 500
            $running = @($jobs | Where-Object { $_.Job.State -notin @('Completed', 'Failed') })
        }

        foreach ($entry in $jobs) {
            Write-Progress -Id $entry.Id -Activity "下载 $($entry.Name) / Downloading $($entry.Name)" -Completed
        }

        foreach ($entry in $jobs) {
            $state = $entry.Job.State
            $result = Receive-Job -Job $entry.Job -ErrorAction SilentlyContinue
            Remove-Job -Job $entry.Job -Force
            if ($state -eq 'Failed' -or -not $result -or -not $result.Ok) {
                throw "下载 $($entry.Name) 失败 / Downloading $($entry.Name) failed"
            }
            Write-Ok "$($entry.Name) 下载完成: $($result.Url) / $($entry.Name) downloaded: $($result.Url)"
        }
    }
    finally {
        $ProgressPreference = $prevProgress
    }
}

# Extract the Blender zip into the chosen install directory. / 把 Blender 压缩包解压到所选安装目录。
function Install-Blender([string]$Archive, [string]$DestRoot) {
    Write-Step "解压 Blender / Extracting Blender"
    New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
    & tar.exe -xf $Archive -C $DestRoot
    if ($LASTEXITCODE -ne 0) {
        Expand-Archive -LiteralPath $Archive -DestinationPath $DestRoot -Force
    }
    $exe = Join-Path $DestRoot "$BlenderFolder\blender.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "解压后没有找到 blender.exe / blender.exe was not found after extraction"
    }
    Write-Ok "Blender 已安装到 $exe / Blender installed to $exe"
}

# Extract a downloaded tool archive and copy the binary where Pi looks first. / 解压已下载的工具压缩包，把可执行文件复制到 Pi 优先查找的目录。
function Install-ToolFromArchive([string]$Name, [string]$Archive, [string]$BinaryName) {
    $extractDir = Join-Path $script:WorkDir ("extract-" + $Name)
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    & tar.exe -xf $Archive -C $extractDir
    if ($LASTEXITCODE -ne 0) {
        if ($Archive -like '*.zip') {
            Expand-Archive -LiteralPath $Archive -DestinationPath $extractDir -Force
        }
        else {
            throw "解压 $Archive 失败 / Failed to extract $Archive"
        }
    }
    $found = Get-ChildItem -Path $extractDir -Recurse -Filter $BinaryName -File | Select-Object -First 1
    if (-not $found) {
        throw "压缩包里没有 $BinaryName / The archive does not contain $BinaryName"
    }
    New-Item -ItemType Directory -Force -Path $script:BinDir | Out-Null
    $target = Join-Path $script:BinDir $BinaryName
    Copy-Item -LiteralPath $found.FullName -Destination $target -Force
    Unblock-File -LiteralPath $target
    & $target --version 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "$BinaryName 已放到 $target，但无法运行 / $BinaryName was placed at $target but cannot run"
    }
    Write-Ok "$Name 已安装到 $target / $Name installed to $target"
}

Write-Host "Windows 已适配。macOS 和 Linux 未确认。 / Windows is supported. macOS and Linux are unverified." -ForegroundColor Red
Write-Host ""

$script:PreferCn = $false
$script:PiCommand = 'pi'
$script:WorkDir = Join-Path $env:TEMP ("pi-py-blender-setup-" + $PID)
$script:BinDir = Get-AgentBinDir
New-Item -ItemType Directory -Force -Path $script:WorkDir | Out-Null

try {
    Write-Step "选择安装位置 / Choosing the install locations"
    $blenderDir = (Read-Host "请输入 Blender 安装目录（留空使用当前目录）/ Enter the Blender install directory (empty = current directory)").Trim()
    if (-not $blenderDir) { $blenderDir = (Get-Location).Path }
    if (-not [System.IO.Path]::IsPathRooted($blenderDir)) {
        $blenderDir = Join-Path (Get-Location) $blenderDir
    }
    $blenderDir = [System.IO.Path]::GetFullPath($blenderDir)
    Write-Ok "Blender 目录: $blenderDir / Blender dir: $blenderDir"

    $venvDir = (Read-Host "请输入 venv 安装目录（留空使用当前目录下的 venv）/ Enter the venv directory (empty = <current>\venv)").Trim()
    if (-not $venvDir) { $venvDir = Join-Path (Get-Location) 'venv' }
    if (-not [System.IO.Path]::IsPathRooted($venvDir)) {
        $venvDir = Join-Path (Get-Location) $venvDir
    }
    $venvDir = [System.IO.Path]::GetFullPath($venvDir)
    Write-Ok "venv 目录: $venvDir / venv dir: $venvDir"

    Write-Step "判断网络 / Checking the network"
    if (Test-GithubReachable) {
        $script:PreferCn = $false
        Write-Ok "可以访问 GitHub，使用官方源 / GitHub is reachable, so official sources are used"
    }
    else {
        $script:PreferCn = $true
        Write-Ok "访问 GitHub 失败，改用国内镜像（npm 使用 npmmirror） / GitHub is unreachable, so China mirrors are used and npm uses npmmirror"
    }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }

    Write-Step "检查 Node.js / Checking Node.js"
    $nodeVersion = Get-NodeVersion
    if (-not $nodeVersion) {
        Install-Node
        $nodeVersion = Get-NodeVersion
    }
    elseif ($nodeVersion -lt $MinNode) {
        Write-Host "当前 Node.js 是 $nodeVersion，Pi 需要 $MinNode 或更新。不更新就无法继续安装。 / Current Node.js is $nodeVersion, but Pi needs $MinNode or newer. Installation cannot continue without updating." -ForegroundColor Yellow
        if (-not (Read-NodeUpgradeChoice)) {
            Write-Host "已退出，未继续安装。 / Exited without installing."
            exit 1
        }
        Update-Node
        $nodeVersion = Get-NodeVersion
    }
    if ((-not $nodeVersion) -or $nodeVersion -lt $MinNode) {
        throw "需要 Node.js $MinNode 或更新，当前是 $nodeVersion。可从 https://nodejs.org 安装。 / Node.js $MinNode or newer is required, but the current version is $nodeVersion. Install it from https://nodejs.org"
    }
    Write-Ok "Node.js $nodeVersion"

    Write-Step "检查 Python / Checking Python"
    $py = Find-Python
    if (-not $py) {
        $any = Get-PythonVersion @('python')
        if (-not $any) { $any = Get-PythonVersion @('py', '-3') }
        if (-not $any) {
            Install-Python
            $py = Find-Python
        }
        else {
            Write-Host "当前 Python 是 $any，需要 3.13。不安装 3.13 就无法继续。 / Current Python is $any, but 3.13 is required. Installation cannot continue without installing 3.13." -ForegroundColor Yellow
            if (-not (Read-PythonInstallChoice)) {
                Write-Host "已退出，未继续安装。 / Exited without installing."
                exit 1
            }
            Install-Python
            $py = Find-Python
        }
    }
    if (-not $py) {
        throw "需要 Python 3.13 或更新，未找到。可从 https://www.python.org 安装。 / Python 3.13 or newer is required, but none was found. Install it from https://www.python.org"
    }
    Write-Ok "Python $($py.Version) ($(($py.Cmd) -join ' '))"

    Write-Step "准备下载 / Preparing downloads"
    $downloads = @()
    $toolJobs = @()
    $needBlender = $false

    $blenderArchive = Join-Path $script:WorkDir 'blender-4.5.0-windows-x64.zip'
    $blenderExe = Join-Path $blenderDir "$BlenderFolder\blender.exe"
    if (Test-Path -LiteralPath $blenderExe) {
        Write-Ok "Blender 已存在: $blenderExe / Blender already present: $blenderExe"
    }
    else {
        $needBlender = $true
        $downloads += @{ Name = 'Blender 4.5.0'; Urls = @(Get-BlenderUrlOrder); Dest = $blenderArchive; MinBytes = 100000000 }
    }

    if (Test-ToolReady 'fd') {
        Write-Ok "fd 已可用 / fd is already available"
    }
    else {
        $fdUrl = Resolve-ToolUrl 'sharkdp/fd' 'v' @("fd-v{version}-$arch-pc-windows-msvc.zip")
        if (-not $fdUrl) { throw "没有找到 fd 的安装包 / No package was found for fd" }
        $fdArchive = Join-Path $script:WorkDir ($fdUrl -split '/')[-1]
        $downloads += @{ Name = 'fd'; Urls = @(Get-SourceOrder $fdUrl); Dest = $fdArchive; MinBytes = 100000 }
        $toolJobs += @{ Name = 'fd'; Archive = $fdArchive; Binary = 'fd.exe' }
    }

    if (Test-ToolReady 'rg') {
        Write-Ok "rg 已可用 / rg is already available"
    }
    else {
        $rgUrl = Resolve-ToolUrl 'BurntSushi/ripgrep' '' @("ripgrep-{version}-$arch-pc-windows-msvc.zip")
        if (-not $rgUrl) { throw "没有找到 rg 的安装包 / No package was found for rg" }
        $rgArchive = Join-Path $script:WorkDir ($rgUrl -split '/')[-1]
        $downloads += @{ Name = 'rg'; Urls = @(Get-SourceOrder $rgUrl); Dest = $rgArchive; MinBytes = 100000 }
        $toolJobs += @{ Name = 'rg'; Archive = $rgArchive; Binary = 'rg.exe' }
    }

    if ($downloads.Count -gt 0) {
        Write-Step "并行下载 / Downloading in parallel"
        Invoke-ParallelDownloads $downloads
    }

    if ($needBlender) { Install-Blender $blenderArchive $blenderDir }
    foreach ($t in $toolJobs) { Install-ToolFromArchive $t.Name $t.Archive $t.Binary }

    Write-Step "创建 Python 虚拟环境 / Creating the Python virtual environment"
    $cmd = $py.Cmd
    $rest = @($cmd | Select-Object -Skip 1)
    & $cmd[0] @rest -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw "创建 venv 失败，退出码 $LASTEXITCODE / venv creation failed, exit code $LASTEXITCODE"
    }
    Write-Ok "已创建 $venvDir / Created $venvDir"

    $venvPy = Join-Path $venvDir 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPy)) {
        $venvPy = Join-Path $venvDir 'bin\python'
    }

    Write-Step "升级 pip / Upgrading pip"
    Invoke-Pip $venvPy @('install', '--upgrade', 'pip')
    Write-Ok "pip 已升级 / pip upgraded"

    Write-Step "安装固定版本的包 / Installing pinned packages"
    Invoke-Pip $venvPy (@('install') + $Packages)
    Write-Ok "包已安装 / Packages installed"
    $reqFile = Join-Path $venvDir 'requirements.txt'
    [System.IO.File]::WriteAllLines($reqFile, $Packages)
    Write-Ok "已写入版本清单 $reqFile / Wrote pinned list to $reqFile"

    Write-Step "验证 Python 包 / Verifying Python packages"
    $verify = "import numpy,scipy,pyvista,trimesh,manifold3d`nfor m in (numpy,scipy,pyvista,trimesh,manifold3d): print(m.__name__, getattr(m,'__version__','ok'))"
    & $venvPy -c $verify
    if ($LASTEXITCODE -ne 0) {
        throw "导入检查失败 / Import check failed"
    }
    Write-Ok "所有包均可导入 / All packages import successfully"

    Install-Pi
    Install-GitBash
    Write-Step "创建 extensions 和 skills / Creating extensions and skills"
    New-AgentResourceDirs

    Write-Step "复制仓库技能和扩展到 Pi 目录 / Copying repo skills and extensions into Pi's agent directory"
    $repoDir = $PSScriptRoot
    if (-not (Test-Path -LiteralPath (Join-Path $repoDir '_shared'))) {
        Write-WarnLine "脚本目录下没有找到仓库文件（_shared 等），跳过复制。请把 install.ps1 放在仓库目录里运行。 / No repo files found next to the script; skipping the copy. Put install.ps1 inside the repo directory and run it there."
    }
    else {
        Copy-RepoToAgent $repoDir
    }

    Write-Step "填写 py_environment.json / Filling in py_environment.json"
    $envJson = Join-Path (Get-AgentDir) 'py_environment.json'
    if (Test-Path -LiteralPath $envJson) {
        $cfg = Get-Content -LiteralPath $envJson -Raw | ConvertFrom-Json
        $cfg.python.exe = $venvPy
        $cfg.blender.exe = $blenderExe

        $workspace = (Read-Host "请输入工作区路径 / Enter the workspace path").Trim()
        if (-not $workspace) { throw "未输入工作区路径 / No workspace path was provided" }
        if (-not [System.IO.Path]::IsPathRooted($workspace)) { $workspace = Join-Path (Get-Location) $workspace }
        $workspace = [System.IO.Path]::GetFullPath($workspace)
        $cfg.workspace.root = $workspace

        [System.IO.File]::WriteAllText($envJson, (($cfg | ConvertTo-Json -Depth 5) + "`r`n"))
        Write-Ok "已写入 python/blender/workspace 路径（反斜杠已转义为 JSON 双斜杠）/ Wrote python/blender/workspace paths (backslashes escaped for JSON)"
    }
    else {
        Write-WarnLine "未找到 $envJson，跳过路径填写。 / $envJson not found; skipped filling paths."
    }

    Write-Host ""
    Write-Host "安装完成。 / Installation finished." -ForegroundColor Green
    Write-Host "Blender: $blenderExe"
    Write-Host "Python venv: $venvDir"
    Write-Host "激活方式 / Activate:"
    Write-Host "  PowerShell: & `"$venvDir\Scripts\Activate.ps1`""
    Write-Host "  CMD:        $venvDir\Scripts\activate.bat"
    Write-Host "  Python:     $venvPy"
    Write-Host "Pi: 进入项目目录后运行 pi，再用 /login 登录模型。 / cd into your project, run pi, then use /login to sign in."
    Write-Host "工具目录: $script:BinDir / Tools dir: $script:BinDir"
    Write-Host ""
    Write-Host "提示：想让模型默认使用 PowerShell，而不是 Bash，可在 settings.json 的 defaultTools 里写成 read、powershell、edit、write。 / Tip: to make the model use PowerShell instead of Bash by default, set defaultTools in settings.json to read, powershell, edit, write." -ForegroundColor Blue
    Write-Host "提示：只有 Git Bash 不在 Program Files 里时，才需要在 settings.json 里写 shellPath。 / Tip: you only need shellPath in settings.json when Git Bash is not under Program Files." -ForegroundColor Blue
}
finally {
    Remove-Item -LiteralPath $script:WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

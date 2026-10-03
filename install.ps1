# Pi blank-slate installer (Windows).
# Pi 白板一键安装（Windows）。
# Install the latest Pi, and place ripgrep (rg) and fd beforehand so startup does not download them from GitHub or ask for confirmation.
# 安装最新版 Pi，并预先放好 ripgrep（rg）和 fd，启动时不再从 GitHub 现拉，也不再询问。
#
# Usage / 用法:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Region cn       # China mirrors / 国内镜像
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Region global   # Official sources / 官方源
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Plan             # Show the plan only / 只显示计划
#
#Requires -Version 5.1
param(
    [ValidateSet('auto', 'cn', 'global')]
    [string]$Region = 'auto',
    [switch]$Plan
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$MinNode = [version]'22.19.0'
$NpmPackage = '@earendil-works/pi-coding-agent'
$CnNpmRegistry = 'https://registry.npmmirror.com'
$GhMirrors = @(
    'https://ghfast.top/',
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
    'https://mirror.ghproxy.com/'
)

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

# Download the first URL that returns a real archive. / 下载第一个能拿到真实压缩包的地址。
function Save-FirstReachable([string]$GithubUrl, [string]$Destination, [int]$MinBytes) {
    $lastError = '没有可用地址 / No usable source'
    foreach ($source in (Get-SourceOrder $GithubUrl)) {
        Write-Host "    尝试 $source / Trying $source"
        if (Test-Path -LiteralPath $Destination) {
            Remove-Item -LiteralPath $Destination -Force
        }
        & curl.exe -fL --retry 2 --retry-delay 1 --connect-timeout 12 --max-time 180 -o $Destination $source
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $Destination)) {
            $size = (Get-Item -LiteralPath $Destination).Length
            if ($size -ge $MinBytes) {
                return $source
            }
            $lastError = "文件过小 ($size 字节) / File too small ($size bytes)"
        }
        else {
            $lastError = "curl 退出码 $LASTEXITCODE / curl exit code $LASTEXITCODE"
        }
        if (Test-Path -LiteralPath $Destination) {
            Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        }
    }
    throw "下载失败: $GithubUrl ($lastError) / Download failed: $GithubUrl ($lastError)"
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
        if ($Plan) {
            Write-Ok "计划创建 $path / Would create $path"
            continue
        }
        New-Item -ItemType Directory -Force -Path $path | Out-Null
        Write-Ok "已创建 $path / Created $path"
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

# Put fd.exe and rg.exe where Pi looks first, so Pi will not download them itself. / 把 fd.exe 和 rg.exe 放到 Pi 优先查找的目录，Pi 就不会自己再下载。
function Install-ToolBinary([string]$Name, [string]$Repo, [string]$TagPrefix, [string[]]$FileTemplates) {
    $existing = Test-ToolReady $Name
    if ($existing) {
        Write-Ok "$Name 已可用: $existing / $Name is already available: $existing"
        return
    }

    Write-Step "下载 $Name / Downloading $Name"
    $assetUrl = Resolve-ToolUrl $Repo $TagPrefix $FileTemplates
    if (-not $assetUrl) {
        throw "没有找到 $Name 的安装包。可稍后重试，或手动把 $($Name).exe 放到 $script:BinDir / No package was found for $Name. Retry later, or copy $($Name).exe into $script:BinDir manually"
    }
    Write-Ok "安装包 $assetUrl / Package $assetUrl"

    $archiveName = ($assetUrl -split '/')[-1]
    $archive = Join-Path $script:WorkDir $archiveName
    if ($Plan) {
        Write-Ok "计划下载到 $script:BinDir / Would download into $script:BinDir"
        return
    }

    Save-FirstReachable $assetUrl $archive 100000 | Out-Null
    $extractDir = Join-Path $script:WorkDir ("extract-" + $Name)
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    & tar.exe -xf $archive -C $extractDir
    if ($LASTEXITCODE -ne 0) {
        if ($archiveName -like '*.zip') {
            Expand-Archive -LiteralPath $archive -DestinationPath $extractDir -Force
        }
        else {
            throw "解压 $archiveName 失败 / Failed to extract $archiveName"
        }
    }

    $binaryName = if ($Name -eq 'rg') { 'rg.exe' } else { 'fd.exe' }
    $found = Get-ChildItem -Path $extractDir -Recurse -Filter $binaryName -File | Select-Object -First 1
    if (-not $found) {
        throw "压缩包里没有 $binaryName / The archive does not contain $binaryName"
    }
    New-Item -ItemType Directory -Force -Path $script:BinDir | Out-Null
    $target = Join-Path $script:BinDir $binaryName
    Copy-Item -LiteralPath $found.FullName -Destination $target -Force
    Unblock-File -LiteralPath $target
    & $target --version 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "$binaryName 已放到 $target，但无法运行 / $binaryName was placed at $target but cannot run"
    }
    Write-Ok "$Name 已安装到 $target / $Name installed to $target"
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
    if ($Plan) {
        Write-Ok "计划用 winget 安装 Git.Git / Would install Git.Git with winget"
        return
    }
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
    if ($Plan) { return }

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

Write-Host "Windows 已适配。macOS 和 Linux 未确认。 / Windows is supported. macOS and Linux are unverified." -ForegroundColor Red
Write-Host ""

$script:PreferCn = $false
$script:PiCommand = 'pi'
$script:WorkDir = Join-Path $env:TEMP ("pi-setup-" + $PID)
$script:BinDir = Get-AgentBinDir
New-Item -ItemType Directory -Force -Path $script:WorkDir | Out-Null

try {
    Write-Step "判断网络 / Checking the network"
    if ($Region -eq 'cn') {
        $script:PreferCn = $true
        Write-Ok "已指定国内源 / China sources were requested"
    }
    elseif ($Region -eq 'global') {
        $script:PreferCn = $false
        Write-Ok "已指定官方源 / Official sources were requested"
    }
    elseif (Test-GithubReachable) {
        $script:PreferCn = $false
        Write-Ok "可以访问 GitHub，使用官方源 / GitHub is reachable, so official sources are used"
    }
    else {
        $script:PreferCn = $true
        Write-Ok "访问 GitHub 失败，改用国内镜像下载 fd 和 ripgrep，npm 使用 npmmirror / GitHub is unreachable, so China mirrors are used for fd and ripgrep and npmmirror for npm"
    }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }

    $nodeVersion = Get-NodeVersion
    if (-not $nodeVersion) {
        if ($Plan) { Write-Ok "计划安装 Node.js / Would install Node.js" }
        else {
            Install-Node
            $nodeVersion = Get-NodeVersion
        }
    }
    elseif ($nodeVersion -lt $MinNode) {
        if ($Plan) {
            Write-Ok "计划询问是否将 Node.js $nodeVersion 更新到 $MinNode 或更新 / Would ask whether to update Node.js $nodeVersion to $MinNode or newer"
        }
        else {
            Write-Host "当前 Node.js 是 $nodeVersion，Pi 需要 $MinNode 或更新。不更新就无法继续安装。 / Current Node.js is $nodeVersion, but Pi needs $MinNode or newer. Installation cannot continue without updating." -ForegroundColor Yellow
            if (-not (Read-NodeUpgradeChoice)) {
                Write-Host "已退出，未继续安装。 / Exited without installing."
                exit 1
            }
            Update-Node
            $nodeVersion = Get-NodeVersion
        }
    }
    if (-not $Plan -and ((-not $nodeVersion) -or $nodeVersion -lt $MinNode)) {
        throw "需要 Node.js $MinNode 或更新，当前是 $nodeVersion。可从 https://nodejs.org 安装。 / Node.js $MinNode or newer is required, but the current version is $nodeVersion. Install it from https://nodejs.org"
    }
    if ($nodeVersion -and $nodeVersion -ge $MinNode) {
        Write-Ok "Node.js $nodeVersion"
    }

    Install-Pi
    Install-ToolBinary 'fd' 'sharkdp/fd' 'v' @("fd-v{version}-$arch-pc-windows-msvc.zip")
    Install-ToolBinary 'rg' 'BurntSushi/ripgrep' '' @("ripgrep-{version}-$arch-pc-windows-msvc.zip")
    Install-GitBash
    Write-Step "创建 extensions 和 skills / Creating extensions and skills"
    New-AgentResourceDirs

    Write-Host ""
    if ($Plan) {
        Write-Host "以上是计划，没有改动本机。 / That was only the plan; nothing on this machine was changed." -ForegroundColor Cyan
    }
    else {
        Write-Host "安装完成。进入项目目录后运行 pi，再用 /login 登录模型。 / Installation finished. cd into your project, run pi, then use /login to sign in to a model." -ForegroundColor Green
        Write-Host "这是默认白板：只有读、写、改、命令四个工具，没有额外扩展。 / This is the blank slate: only the read, write, edit, and command tools, with no extra extensions."
        Write-Host "工具目录: $script:BinDir / Tools dir: $script:BinDir"
        Write-Host "扩展目录: $(Join-Path (Get-AgentDir) 'extensions') / Extensions dir: $(Join-Path (Get-AgentDir) 'extensions')"
        Write-Host "技能目录: $(Join-Path (Get-AgentDir) 'skills') / Skills dir: $(Join-Path (Get-AgentDir) 'skills')"
        Write-Host ""
        Write-Host "提示：想让模型默认使用 PowerShell，而不是 Bash，可在 settings.json 的 defaultTools 里写成 read、powershell、edit、write。这项保持默认，脚本没有修改。 / Tip: to make the model use PowerShell instead of Bash by default, set defaultTools in settings.json to read, powershell, edit, write. This script leaves it at the default and changes nothing." -ForegroundColor Blue
        Write-Host "提示：只有 Git Bash 不在 Program Files 里时，才需要在 settings.json 里写 shellPath。装在标准位置就不用写。 / Tip: you only need shellPath in settings.json when Git Bash is not under Program Files. A standard install needs no entry." -ForegroundColor Blue
    }
}
finally {
    Remove-Item -LiteralPath $script:WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

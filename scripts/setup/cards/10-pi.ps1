# 准备 pi：需要 Node.js + npm，目前只有动态安装。

function Install-Node {
    Write-Step "安装 Node.js（需要 $MinNode 或更新）"
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "没有找到 Node.js 和 winget。请先安装 Node.js $MinNode 或更新：https://nodejs.org"
    }
    $exitCode = Invoke-Winget @('install', '--id', 'OpenJS.NodeJS', '-e') 'winget 安装 Node.js'
    if ($exitCode -ne 0) {
        Write-WarnLine "winget 返回退出码 $exitCode（-1 表示超时），可能是已安装。刷新 PATH 后重新检测。"
    }
    Refresh-Path
    $v = Get-NodeVersion
    if (-not $v -or $v -lt $MinNode) {
        throw "Node.js 安装失败（winget 退出码 $exitCode），当前版本 $v。可从 https://nodejs.org 手动安装。"
    }
    Write-Ok "Node.js $v"
}

function Update-Node {
    Write-Step "更新 Node.js（需要 $MinNode 或更新）"
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "没有 winget，无法自动更新。请手动安装 Node.js $MinNode 或更新：https://nodejs.org"
    }
    $exitCode = Invoke-Winget @('upgrade', '--id', 'OpenJS.NodeJS', '-e') 'winget 升级 Node.js'
    if ($exitCode -ne 0) {
        $exitCode = Invoke-Winget @('install', '--id', 'OpenJS.NodeJS', '-e') 'winget 安装 Node.js'
    }
    Refresh-Path
    $v = Get-NodeVersion
    if (-not $v -or $v -lt $MinNode) {
        throw "Node.js 更新失败（winget 退出码 $exitCode），当前版本 $v。可从 https://nodejs.org 手动更新。"
    }
    Write-Ok "Node.js $v"
}

function Ensure-Node {
    $v = Get-NodeVersion
    if (-not $v) {
        Install-Node
        $v = Get-NodeVersion
    }
    elseif ($v -lt $MinNode) {
        if (-not $script:Setup.AutoUpgradeNode) {
            throw "当前 Node.js 是 $v，需要 $MinNode 或更新。请手动升级，或加 -AutoUpgradeNode 让脚本尝试 winget 升级。"
        }
        Update-Node
        $v = Get-NodeVersion
    }
    if (-not $v -or $v -lt $MinNode) {
        throw "需要 Node.js $MinNode 或更新，当前是 $v。可从 https://nodejs.org 安装。"
    }
    return $v
}

function Install-Pi {
    Write-Step "全局安装 pi（$NpmPackage）"
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw "找不到 npm，无法安装 pi。请先安装 Node.js $MinNode 或更新：https://nodejs.org"
    }

    $env:npm_config_fund = 'false'
    $env:npm_config_audit = 'false'
    $env:npm_config_update_notifier = 'false'
    # 网络差时快速失败并重试，而不是无限等待。
    $env:npm_config_fetch_timeout = '60000'
    $env:npm_config_fetch_retries = '3'
    $env:npm_config_fetch_retry_mintimeout = '5000'
    $env:npm_config_fetch_retry_maxtimeout = '60000'

    $registries = if ($script:Setup.PreferCn) { @($CnNpmRegistry, $null) } else { @($null, $CnNpmRegistry) }
    $exitCode = 0
    foreach ($registry in $registries) {
        $npmArgs = @('install', '-g', '--ignore-scripts', '--no-fund', '--no-audit', '--loglevel=error')
        if ($registry) {
            Write-Ok "npm 使用国内镜像 $registry"
            $npmArgs += @('--registry', $registry)
        }
        else {
            Write-Ok "npm 使用官方源"
        }
        & npm @npmArgs $NpmPackage 2>&1 | Out-Host
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) { break }
        Write-WarnLine "npm 退出码 $exitCode，换源重试"
    }
    if ($exitCode -ne 0) {
        throw "npm 安装 pi 失败，退出码 $exitCode"
    }

    $pi = Get-PiCommand
    if (-not $pi) {
        throw "pi 已安装，但 pi --version 仍不可用。请检查 npm 全局 bin 是否在 PATH 中。"
    }
    Write-Ok ("pi " + $pi.Version)
}

function Ensure-Pi {
    $existing = Get-PiCommand
    if ($existing -and -not $script:Setup.UpdatePi) {
        Write-Ok "pi 已存在：$($existing.Path)（$($existing.Version)）"
        return $existing
    }
    if ($script:Setup.SkipNode) {
        throw "安装/更新 pi 需要 Node.js，但当前加了 -SkipNode。"
    }
    Ensure-Node | Out-Null
    Install-Pi
    $pi = Get-PiCommand
    if (-not $pi) {
        throw "pi 安装后仍无法运行。"
    }
    return $pi
}

function Invoke-PiCardDynamic {
    $setup = $script:Setup
    if ($setup.SkipPi) {
        $pi = Get-PiCommand
        if ($pi) { Write-Ok "pi 已存在：$($pi.Path)" } else { Write-WarnLine "加了 -SkipPi，且没有找到 pi" }
        $setup.Pi = $pi
        return $true
    }
    $piBefore = Get-PiCommand
    $nodeBefore = Get-NodeVersion
    $setup.Pi = Ensure-Pi
    # 只有本次从无到有装的才在卸载时回收。
    if (-not $piBefore -and $setup.Pi) { $setup.Managed.PiInstalled = $true }
    if (-not $nodeBefore -and (Get-NodeVersion)) { $setup.Managed.NodeInstalled = $true }
    return $true
}

@{
    Id            = 'pi'
    Title         = '准备 pi'
    InvokeDynamic = 'Invoke-PiCardDynamic'
}

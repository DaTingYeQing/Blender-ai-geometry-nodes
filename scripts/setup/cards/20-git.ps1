# Git Bash：优先解压内置 PortableGit（不需要管理员），否则回退 winget。

function Install-PortableGit([string]$Archive) {
    $setup = $script:Setup
    $target = Join-Path $setup.RuntimeDir 'git'
    $bash = Join-Path $target 'bin\bash.exe'
    if (Test-Path -LiteralPath $bash) {
        Write-Ok "Git Bash 已存在：$bash"
        return $bash
    }

    Write-Step "解压内置 Git for Windows"
    Ensure-Directory $target
    # PortableGit 是 7z 自解压包，-y 全部确认、-o 指定目录；目标路径可能含空格，必须带引号。
    $exitCode = Invoke-ProcessWithTimeout -FilePath $Archive -ArgumentList @('-y', "-o`"$target`"") -TimeoutSeconds 600 -What 'Git 解压'
    if (-not (Test-Path -LiteralPath $bash)) {
        $alt = Join-Path $target 'usr\bin\bash.exe'
        if (Test-Path -LiteralPath $alt) { $bash = $alt }
    }
    if (-not (Test-Path -LiteralPath $bash)) {
        throw "解压后没有找到 bash.exe（退出码 $exitCode）"
    }
    Write-Ok "Git Bash 已部署到 $bash"
    return $bash
}

function Test-GitCardStatic {
    $setup = $script:Setup
    if ($setup.SkipGit) { return $true }
    if (Get-GitBash) { return $true }
    $gitArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { '64-bit' }
    return [bool](Get-BundledFile @("PortableGit-*-$gitArch.7z.exe"))
}

function Invoke-GitCardStatic {
    $setup = $script:Setup
    if ($setup.SkipGit) {
        $setup.GitBash = Get-GitBash
        return $true
    }
    $existing = Get-GitBash
    if ($existing) {
        Write-Ok "Git Bash 已存在：$existing"
        $setup.GitBash = $existing
        return $true
    }

    $gitArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { '64-bit' }
    $archive = Get-BundledFile @("PortableGit-*-$gitArch.7z.exe")
    if (-not $archive) { return $false }

    $setup.GitBash = Install-PortableGit $archive
    $setup.Managed.GitMethod = 'portable'
    return $true
}

function Invoke-GitCardDynamic {
    $setup = $script:Setup
    if ($setup.SkipGit) {
        $setup.GitBash = Get-GitBash
        return $true
    }
    $existing = Get-GitBash
    if ($existing) {
        Write-Ok "Git Bash 已存在：$existing"
        $setup.GitBash = $existing
        return $true
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-WarnLine "没有找到 Git Bash 和 winget。pi 可以启动，但 bash 工具需要 Git for Windows。"
        return $true
    }

    Write-Step "安装 Git for Windows（pi 的 bash 工具需要 Git Bash）"
    $exitCode = Invoke-Winget @('install', '--id', 'Git.Git', '-e') 'winget 安装 Git for Windows'
    if ($exitCode -ne 0) {
        Write-WarnLine "Git 静默安装失败（退出码 $exitCode，-1 表示超时）。pi 本体不受影响，bash 工具需要稍后安装 Git for Windows。"
        return $true
    }
    Refresh-Path
    $found = Get-GitBash
    if ($found) {
        Write-Ok "Git Bash 已安装：$found"
        $setup.GitBash = $found
        $setup.Managed.GitMethod = 'winget'
    }
    return $true
}

@{
    Id            = 'git'
    Title         = '准备 Git Bash'
    TestStatic    = 'Test-GitCardStatic'
    InvokeStatic  = 'Invoke-GitCardStatic'
    InvokeDynamic = 'Invoke-GitCardDynamic'
}

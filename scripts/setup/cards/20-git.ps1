# Git Bash：只解压内置 PortableGit，不联网安装。

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

@{
    Id            = 'git'
    Title         = '准备 Git Bash'
    TestStatic    = 'Test-GitCardStatic'
    InvokeStatic  = 'Invoke-GitCardStatic'
}

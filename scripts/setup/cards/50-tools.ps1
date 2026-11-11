# fd / rg：优先安装包内置 zip，缺失时走 GitHub 镜像下载。

function Get-ToolSpecs {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }
    return @(
        @{ Name = 'fd'; Repo = 'sharkdp/fd'; Tag = 'v'; Templates = @("fd-v{version}-$arch-pc-windows-msvc.zip"); Bundles = @("fd-v*-$arch-pc-windows-msvc.zip"); Binary = 'fd.exe'; MinBytes = 100000 },
        @{ Name = 'rg'; Repo = 'BurntSushi/ripgrep'; Tag = ''; Templates = @("ripgrep-{version}-$arch-pc-windows-msvc.zip"); Bundles = @("ripgrep-*-$arch-pc-windows-msvc.zip"); Binary = 'rg.exe'; MinBytes = 100000 }
    )
}

function Install-ToolFromArchive([string]$Name, [string]$Archive, [string]$BinaryName) {
    $setup = $script:Setup
    $extractDir = Join-Path $setup.WorkDir ("extract-" + $Name)
    Ensure-Directory $extractDir
    $tar = Get-TarExe
    $extracted = $false
    if ($tar) {
        & $tar -xf $Archive -C $extractDir 1>$null 2>$null
        $extracted = ($LASTEXITCODE -eq 0)
    }
    if (-not $extracted) {
        if ($Archive -like '*.zip') {
            Expand-Archive -LiteralPath $Archive -DestinationPath $extractDir -Force
        }
        else {
            throw "解压 $Archive 失败"
        }
    }
    $found = Get-ChildItem -Path $extractDir -Recurse -Filter $BinaryName -File | Select-Object -First 1
    if (-not $found) {
        throw "压缩包里没有 $BinaryName"
    }
    Ensure-Directory $setup.BinDir
    $target = Join-Path $setup.BinDir $BinaryName
    # 记录归属：原本就存在的文件卸载时不删（可能被用户或其他工具使用）。
    if (-not $setup.Managed.Tools.ContainsKey($Name)) {
        $setup.Managed.Tools[$Name] = if (Test-Path -LiteralPath $target) { 'existing' } else { 'created' }
    }
    Copy-Item -LiteralPath $found.FullName -Destination $target -Force
    Unblock-File -LiteralPath $target
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $target --version 1>$null 2>$null
        $ok = ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if (-not $ok) {
        throw "$BinaryName 已放到 $target，但无法运行"
    }
    Write-Ok "$Name 已安装到 $target"
}

function Ensure-Tools([switch]$Offline) {
    $setup = $script:Setup
    foreach ($tool in (Get-ToolSpecs)) {
        $ready = Test-ToolReady $tool.Name
        if ($ready) {
            Write-Ok "$($tool.Name) 已可用：$ready"
            continue
        }

        $bundled = Get-BundledFile $tool.Bundles
        if ($bundled) {
            try {
                Install-ToolFromArchive $tool.Name $bundled $tool.Binary
                continue
            }
            catch {
                if ($Offline) { throw "内置 $($tool.Name) 安装失败：$($_.Exception.Message)" }
                Write-WarnLine "内置 $($tool.Name) 安装失败，改用在线下载：$($_.Exception.Message)"
            }
        }
        if ($Offline) {
            throw "没有内置的 $($tool.Name) 安装包"
        }

        $url = Resolve-ToolUrl $tool.Repo $tool.Tag $tool.Templates
        if (-not $url) {
            throw "没有找到 $($tool.Name) 的安装包"
        }
        $archive = Join-Path $setup.WorkDir (($url -split '/')[-1])
        Invoke-Download $tool.Name (Get-SourceOrder $url) $archive $tool.MinBytes
        Install-ToolFromArchive $tool.Name $archive $tool.Binary
    }
}

function Test-ToolsCardStatic {
    $setup = $script:Setup
    if ($setup.SkipTools) { return $true }
    foreach ($tool in (Get-ToolSpecs)) {
        if (Test-ToolReady $tool.Name) { continue }
        if (-not (Get-BundledFile $tool.Bundles)) { return $false }
    }
    return $true
}

function Invoke-ToolsCardStatic {
    if ($script:Setup.SkipTools) { return $true }
    try {
        Ensure-Tools -Offline
    }
    catch {
        Write-WarnLine "内置 fd/rg 安装失败：$($_.Exception.Message)"
        return $false
    }
    return $true
}

function Invoke-ToolsCardDynamic {
    if ($script:Setup.SkipTools) { return $true }
    try {
        Ensure-Tools
    }
    catch {
        # fd/rg 不是运行 pi 的硬依赖，失败只警告，保持旧行为。
        Write-WarnLine "fd/rg 安装失败：$($_.Exception.Message)"
    }
    return $true
}

@{
    Id            = 'tools'
    Title         = '准备 fd / rg'
    TestStatic    = 'Test-ToolsCardStatic'
    InvokeStatic  = 'Invoke-ToolsCardStatic'
    InvokeDynamic = 'Invoke-ToolsCardDynamic'
}

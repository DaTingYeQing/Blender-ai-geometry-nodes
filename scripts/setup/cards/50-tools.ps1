# fd / rg：只从安装包内置 zip 解出，不联网下载。

function Get-ToolSpecs {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'aarch64' } else { 'x86_64' }
    return @(
        @{ Name = 'fd'; Bundles = @("fd-v*-$arch-pc-windows-msvc.zip"); Binary = 'fd.exe' },
        @{ Name = 'rg'; Bundles = @("ripgrep-*-$arch-pc-windows-msvc.zip"); Binary = 'rg.exe' }
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
    # 重跑安装时会继承上一次的清单：上次记录为“原本就有”、但文件现在已经不在，
    # 说明这次是我们重新放进去的，改为 created。
    if (-not $setup.Managed.Tools.ContainsKey($Name)) {
        $setup.Managed.Tools[$Name] = if (Test-Path -LiteralPath $target) { 'existing' } else { 'created' }
    }
    elseif ($setup.Managed.Tools[$Name] -ne 'created' -and -not (Test-Path -LiteralPath $target)) {
        $setup.Managed.Tools[$Name] = 'created'
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

function Ensure-Tools {
    $setup = $script:Setup
    foreach ($tool in (Get-ToolSpecs)) {
        $ready = Test-ToolReady $tool.Name
        if ($ready) {
            Write-Ok "$($tool.Name) 已可用：$ready"
            continue
        }
        $bundled = Get-BundledFile $tool.Bundles
        if (-not $bundled) {
            throw "安装包缺少内置 $($tool.Name) 压缩包"
        }
        Install-ToolFromArchive $tool.Name $bundled $tool.Binary
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
    Ensure-Tools
    return $true
}

@{
    Id           = 'tools'
    Title        = '准备 fd / rg'
    TestStatic   = 'Test-ToolsCardStatic'
    InvokeStatic = 'Invoke-ToolsCardStatic'
}

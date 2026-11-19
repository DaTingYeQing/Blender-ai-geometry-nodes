# CovTrace 工具链：安装包内置的 llvm-mini 和 blender-4.5.0-mini-source。
# 解压到 blender-src 下，保持 CovTrace 的 directories.py 能按相对布局找到源码和 llvm-cov。
# 版本标记写在 blender-src\.covtrace-version，版本不符就整块清掉重铺。

function Get-CovtraceVersion {
    $file = $script:Setup.CovtraceVersionFile
    if (-not $file -or -not (Test-Path -LiteralPath $file)) { return '' }
    try {
        return (Get-Content -LiteralPath $file -Raw -ErrorAction Stop).Trim()
    }
    catch {
        return ''
    }
}

function Test-CovtraceFiles {
    $setup = $script:Setup
    return ((Test-Path -LiteralPath $setup.CovtraceLlvmCov) -and (Test-Path -LiteralPath $setup.CovtraceEngine))
}

function Clear-CovtraceDirs {
    $setup = $script:Setup
    $targets = @(Join-Path $setup.BlenderSrcRoot 'llvm-mini')
    $targets += @(Get-ChildItem -LiteralPath $setup.BlenderSrcRoot -Directory -Filter '*-mini-source' -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName)
    foreach ($target in $targets) {
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
}

function Test-CovtraceCardStatic {
    $setup = $script:Setup
    if ((Test-CovtraceFiles) -and (Get-CovtraceVersion) -eq $setup.CovtraceVersion) { return $true }
    return (Test-Path -LiteralPath $setup.CovtraceArchive)
}

function Expand-CovtraceArchive([string]$Archive) {
    $setup = $script:Setup
    Ensure-Directory $setup.BlenderSrcRoot
    $tar = Get-TarExe
    if ($tar) {
        & $tar -xf $Archive -C $setup.BlenderSrcRoot 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) { return }
    }
    $unpack = Join-Path $setup.WorkDir 'covtrace-unpack'
    if (Test-Path -LiteralPath $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
    Expand-Archive -LiteralPath $Archive -DestinationPath $unpack -Force
    foreach ($item in Get-ChildItem -LiteralPath $unpack -Force) {
        $target = Join-Path $setup.BlenderSrcRoot $item.Name
        if (Test-Path -LiteralPath $target) {
            Get-ChildItem -LiteralPath $item.FullName -Force | Move-Item -Destination $target -Force
        }
        else {
            Move-Item -LiteralPath $item.FullName -Destination $setup.BlenderSrcRoot -Force
        }
    }
}

function Invoke-CovtraceCardStatic {
    $setup = $script:Setup
    if ((Test-CovtraceFiles) -and (Get-CovtraceVersion) -eq $setup.CovtraceVersion) {
        Write-Ok "CovTrace 工具链已存在：$($setup.BlenderSrcRoot)"
        return $true
    }
    if (-not (Test-Path -LiteralPath $setup.CovtraceArchive)) {
        throw "安装包缺少 CovTrace 工具链：$($setup.CovtraceArchive)"
    }
    # 版本不符或没有标记：先清掉旧工具链，避免新旧文件混在一起。
    Clear-CovtraceDirs
    Write-Step "解压 CovTrace 工具链"
    Expand-CovtraceArchive $setup.CovtraceArchive
    if (-not (Test-Path -LiteralPath $setup.CovtraceLlvmCov)) {
        throw "CovTrace 工具链缺少 llvm-cov：$($setup.CovtraceLlvmCov)"
    }
    if (-not (Test-Path -LiteralPath $setup.CovtraceEngine)) {
        throw "CovTrace 工具链缺少 engine.py：$($setup.CovtraceEngine)"
    }
    if ($setup.CovtraceVersion) {
        Set-Content -LiteralPath $setup.CovtraceVersionFile -Value $setup.CovtraceVersion -Encoding ASCII
    }
    Write-Ok "CovTrace 工具链已部署到 $($setup.BlenderSrcRoot)"
    return $true
}

@{
    Id           = 'covtrace'
    Title        = '部署 CovTrace 工具链'
    TestStatic   = 'Test-CovtraceCardStatic'
    InvokeStatic = 'Invoke-CovtraceCardStatic'
}

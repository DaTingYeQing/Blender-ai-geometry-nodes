# Blender：只从安装包内置的便携 zip 部署，没有动态安装方式。

function Install-Blender([string]$Archive) {
    $setup = $script:Setup
    Write-Step "解压 Blender"
    Ensure-Directory $setup.BlenderSrcBlender
    $tar = Get-TarExe
    $extracted = $false
    if ($tar) {
        # 去掉 zip 顶层的 blender-4.5.0-trace-win64\，直接铺到 blender-src\blender。
        & $tar -xf $Archive -C $setup.BlenderSrcBlender --strip-components=1 1>$null 2>$null
        $extracted = ($LASTEXITCODE -eq 0)
    }
    if (-not $extracted) {
        $unpack = Join-Path $setup.WorkDir 'blender-unpack'
        if (Test-Path -LiteralPath $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
        Expand-Archive -LiteralPath $Archive -DestinationPath $unpack -Force
        $inner = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
        if (-not $inner) { throw "解压后没有找到 Blender 目录：$Archive" }
        Get-ChildItem -LiteralPath $inner.FullName -Force |
            Move-Item -Destination $setup.BlenderSrcBlender -Force
    }
    if (-not (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe)) {
        throw "解压后没有找到 blender.exe：$($setup.BlenderSrcBlenderExe)"
    }
    Write-Ok "Blender 已部署到 $($setup.BlenderSrcBlenderExe)"
}

function Test-BlenderCardStatic {
    $setup = $script:Setup
    if ($setup.SkipBlender) { return $true }
    if (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe) { return $true }
    return (Test-BlenderArchive $setup.BlenderArchive)
}

function Invoke-BlenderCardStatic {
    $setup = $script:Setup
    if ($setup.SkipBlender) {
        $existing = Get-BlenderExe
        if ($existing) {
            $setup.BlenderExe = $existing
            return $true
        }
        throw "加了 -SkipBlender，但 Blender 不存在：$($setup.BlenderSrcBlenderExe)"
    }
    if (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe) {
        Write-Ok "Blender 已存在：$($setup.BlenderSrcBlenderExe)"
        $setup.BlenderExe = $setup.BlenderSrcBlenderExe
        return $true
    }
    if (Get-BlenderExe) {
        Write-WarnLine "检测到旧版 Blender，改为部署安装包内置版本"
    }
    if (-not (Test-BlenderArchive $setup.BlenderArchive)) {
        throw "安装包缺少可用的 Blender 压缩包：$($setup.BlenderArchive)"
    }
    Install-Blender $setup.BlenderArchive
    if (-not (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe)) {
        throw "Blender 部署失败：$($setup.BlenderSrcBlenderExe)"
    }
    $setup.BlenderExe = $setup.BlenderSrcBlenderExe
    return $true
}

@{
    Id           = 'blender'
    Title        = '部署 Blender'
    TestStatic   = 'Test-BlenderCardStatic'
    InvokeStatic = 'Invoke-BlenderCardStatic'
}

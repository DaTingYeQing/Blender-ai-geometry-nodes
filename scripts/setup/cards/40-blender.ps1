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

# Blender 内置 python 被直接 spawn 时不会经过 blender.exe 的初始化，
# 找不到 blender.crt 里的 VC++ 运行库。复制到 python.exe 同目录即可独立启动。
function Install-BlenderCrt([string]$BlenderExe) {
    $pythonExe = Get-BlenderPythonExe $BlenderExe
    if (-not $pythonExe) { return }
    $crtDir = Join-Path (Split-Path -Parent $BlenderExe) 'blender.crt'
    if (-not (Test-Path -LiteralPath $crtDir)) { return }
    $pythonBin = Split-Path -Parent $pythonExe
    try {
        foreach ($pattern in @('vcruntime140*.dll', 'msvcp140*.dll', 'concrt140.dll')) {
            Get-ChildItem -LiteralPath $crtDir -Filter $pattern -File -ErrorAction SilentlyContinue |
                Copy-Item -Destination $pythonBin -Force -ErrorAction Stop
        }
        Write-Ok "已补齐 Blender 内置 python 的运行库"
    }
    catch {
        Write-WarnLine "复制 VC++ 运行库失败：$($_.Exception.Message)"
    }
}

function Test-BlenderCardStatic {
    $setup = $script:Setup
    if ($setup.SkipBlender) { return $true }
    # 版本变化：强制替换，但前提是安装包里有可用的压缩包。
    if ($setup.ForceBlender) { return (Test-BlenderArchive $setup.BlenderArchive) }
    if (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe) { return $true }
    return (Test-BlenderArchive $setup.BlenderArchive)
}

function Invoke-BlenderCardStatic {
    $setup = $script:Setup
    if ($setup.SkipBlender) {
        $existing = Get-BlenderExe
        if ($existing) {
            Install-BlenderCrt $existing
            $setup.BlenderExe = $existing
            return $true
        }
        throw "加了 -SkipBlender，但 Blender 不存在：$($setup.BlenderSrcBlenderExe)"
    }
    if ($setup.ForceBlender -and (Test-Path -LiteralPath $setup.BlenderSrcBlender)) {
        Write-Step "替换 Blender（版本变化）"
        Remove-Item -LiteralPath $setup.BlenderSrcBlender -Recurse -Force
    }
    if (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe) {
        Write-Ok "Blender 已存在：$($setup.BlenderSrcBlenderExe)"
        Install-BlenderCrt $setup.BlenderSrcBlenderExe
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
    Install-BlenderCrt $setup.BlenderSrcBlenderExe
    $setup.BlenderExe = $setup.BlenderSrcBlenderExe
    return $true
}

@{
    Id           = 'blender'
    Title        = '部署 Blender'
    TestStatic   = 'Test-BlenderCardStatic'
    InvokeStatic = 'Invoke-BlenderCardStatic'
}

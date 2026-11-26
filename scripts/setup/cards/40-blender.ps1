# Blender：只从安装包内置的便携 zip 部署，没有动态安装方式。

# 构建标记写在 blender 目录里：强制替换会连同旧标记一起删掉，解压成功后再写新的。
function Write-BlenderBuildMarker {
    $setup = $script:Setup
    if (-not $setup.BlenderBuild) { return }
    try {
        Set-Content -LiteralPath $setup.BlenderBuildFile -Value $setup.BlenderBuild -Encoding ASCII
    }
    catch {
        Write-WarnLine "写入 Blender 构建标记失败：$($_.Exception.Message)"
    }
}

function Expand-BlenderArchive([string]$Archive, [string]$Target) {
    Ensure-Directory $Target
    $tar = Get-TarExe
    $extracted = $false
    if ($tar) {
        # 去掉 zip 顶层的 blender-4.5.0-trace-win64\，直接铺到目标目录。
        & $tar -xf $Archive -C $Target --strip-components=1 1>$null 2>$null
        $extracted = ($LASTEXITCODE -eq 0)
    }
    if (-not $extracted) {
        $unpack = Join-Path $script:Setup.WorkDir ('blender-unpack-' + [guid]::NewGuid().ToString('N'))
        if (Test-Path -LiteralPath $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
        Expand-Archive -LiteralPath $Archive -DestinationPath $unpack -Force
        $inner = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
        if (-not $inner) { throw "解压后没有找到 Blender 目录：$Archive" }
        Get-ChildItem -LiteralPath $inner.FullName -Force |
            Move-Item -Destination $Target -Force
        Remove-Item -LiteralPath $unpack -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 先解压到 staging，验证 blender.exe 存在后再替换；失败时把旧目录改回去。
function Install-BlenderAtomically([string]$Archive) {
    $setup = $script:Setup
    $target = $setup.BlenderSrcBlender
    $staging = Join-Path $setup.BlenderSrcRoot ('.staging-blender-' + [guid]::NewGuid().ToString('N'))
    $backup = ''

    # 上一次成功替换后残留的备份可以在目标存在时安全清理。
    if (Test-Path -LiteralPath $target) {
        Get-ChildItem -LiteralPath $setup.BlenderSrcRoot -Directory -Filter 'blender.old-*' -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    try {
        Expand-BlenderArchive $Archive $staging
        if (-not (Test-Path -LiteralPath (Join-Path $staging 'blender.exe'))) {
            throw "解压后没有找到 blender.exe：$Archive"
        }

        if (Test-Path -LiteralPath $target) {
            $backup = $target + '.old-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
            Move-Item -LiteralPath $target -Destination $backup -Force
        }
        Move-Item -LiteralPath $staging -Destination $target -Force
        Write-BlenderBuildMarker

        if ($backup -and (Test-Path -LiteralPath $backup)) {
            Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (-not (Test-Path -LiteralPath $target) -and $backup -and (Test-Path -LiteralPath $backup)) {
            try {
                Move-Item -LiteralPath $backup -Destination $target -Force
            }
            catch {
                Write-WarnLine "Blender 回滚失败：$($_.Exception.Message)；旧目录在 $backup"
            }
        }
        throw
    }
    finally {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
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

    if (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe) {
        if (-not $setup.ForceBlender) {
            Write-Ok "Blender 已存在：$($setup.BlenderSrcBlenderExe)"
            Install-BlenderCrt $setup.BlenderSrcBlenderExe
            $setup.BlenderExe = $setup.BlenderSrcBlenderExe
            return $true
        }
        Write-Step "替换 Blender（版本变化）"
    }
    elseif (Get-BlenderExe) {
        Write-WarnLine "检测到旧版 Blender，改为部署安装包内置版本"
    }

    if (-not (Test-BlenderArchive $setup.BlenderArchive)) {
        throw "安装包缺少可用的 Blender 压缩包：$($setup.BlenderArchive)"
    }
    Install-BlenderAtomically $setup.BlenderArchive
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

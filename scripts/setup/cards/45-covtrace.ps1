# CovTrace 工具链：安装包内置的 llvm-mini 和 blender-4.5.0-mini-source。
# 解压到 blender-src 下，保持 CovTrace 的 directories.py 能按相对布局找到源码和 llvm-cov。
# 版本标记写在 blender-src\.covtrace-version，版本不符就整块替换。

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

function Expand-CovtraceArchive([string]$Archive, [string]$Target) {
    Ensure-Directory $Target
    $tar = Get-TarExe
    if ($tar) {
        & $tar -xf $Archive -C $Target 1>$null 2>$null
        if ($LASTEXITCODE -eq 0) { return }
    }
    $unpack = Join-Path $script:Setup.WorkDir ('covtrace-unpack-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $unpack) { Remove-Item -LiteralPath $unpack -Recurse -Force }
    Expand-Archive -LiteralPath $Archive -DestinationPath $unpack -Force
    foreach ($item in Get-ChildItem -LiteralPath $unpack -Force) {
        Move-Item -LiteralPath $item.FullName -Destination $Target -Force
    }
    Remove-Item -LiteralPath $unpack -Recurse -Force -ErrorAction SilentlyContinue
}

# 先解压到 staging，逐项替换；任一步失败都把旧目录改回去。
function Install-CovtraceAtomically([string]$Archive) {
    $setup = $script:Setup
    $root = $setup.BlenderSrcRoot
    $staging = Join-Path $root ('.staging-covtrace-' + [guid]::NewGuid().ToString('N'))
    $moved = @()

    try {
        Expand-CovtraceArchive $Archive $staging
        $items = @(Get-ChildItem -LiteralPath $staging -Force)
        if (-not $items.Count) { throw "CovTrace 压缩包解压后是空的：$Archive" }

        foreach ($item in $items) {
            $target = Join-Path $root $item.Name
            $backup = ''
            if (Test-Path -LiteralPath $target) {
                $backup = $target + '.old-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
                Move-Item -LiteralPath $target -Destination $backup -Force
            }
            $moved += [pscustomobject]@{ Target = $target; Backup = $backup }
            Move-Item -LiteralPath $item.FullName -Destination $target -Force
        }

        if (-not (Test-Path -LiteralPath $setup.CovtraceLlvmCov)) {
            throw "CovTrace 工具链缺少 llvm-cov：$($setup.CovtraceLlvmCov)"
        }
        if (-not (Test-Path -LiteralPath $setup.CovtraceEngine)) {
            throw "CovTrace 工具链缺少 engine.py：$($setup.CovtraceEngine)"
        }
        if ($setup.CovtraceVersion) {
            Set-Content -LiteralPath $setup.CovtraceVersionFile -Value $setup.CovtraceVersion -Encoding ASCII
        }

        foreach ($entry in $moved) {
            if ($entry.Backup -and (Test-Path -LiteralPath $entry.Backup)) {
                Remove-Item -LiteralPath $entry.Backup -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Ok "CovTrace 工具链已部署到 $root"
    }
    catch {
        foreach ($entry in $moved) {
            if (Test-Path -LiteralPath $entry.Target) {
                Remove-Item -LiteralPath $entry.Target -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        foreach ($entry in $moved) {
            if ($entry.Backup -and (Test-Path -LiteralPath $entry.Backup)) {
                try {
                    Move-Item -LiteralPath $entry.Backup -Destination $entry.Target -Force
                }
                catch {
                    Write-WarnLine "CovTrace 回滚失败：$($_.Exception.Message)；旧目录在 $($entry.Backup)"
                }
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

function Test-CovtraceCardStatic {
    $setup = $script:Setup
    if ((Test-CovtraceFiles) -and (Get-CovtraceVersion) -eq $setup.CovtraceVersion) { return $true }
    return (Test-Path -LiteralPath $setup.CovtraceArchive)
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
    Write-Step "替换 CovTrace 工具链"
    Install-CovtraceAtomically $setup.CovtraceArchive
    return $true
}

@{
    Id           = 'covtrace'
    Title        = '部署 CovTrace 工具链'
    TestStatic   = 'Test-CovtraceCardStatic'
    InvokeStatic = 'Invoke-CovtraceCardStatic'
}

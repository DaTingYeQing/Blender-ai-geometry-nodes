# Python：解释器 + venv + 依赖包。
# 静态路径使用内置安装包和 wheelhouse，全程不联网；动态路径走镜像/官方源并在最后用 winget 兜底。

function Get-PythonInstallerFileName {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    return "python-$PythonInstallerVersion-$arch.exe"
}

# 先探测各源的首字节响应时间，快慢排序后逐个尝试；连不上的源排最后但仍会兜底。
function Get-PythonSourceOrder {
    $setup = $script:Setup
    if ($setup.PythonSourceUrls) { return $setup.PythonSourceUrls }
    $file = Get-PythonInstallerFileName
    $sources = [ordered]@{
        'npmmirror'  = "https://registry.npmmirror.com/-/binary/python/$PythonInstallerVersion/$file"
        'aliyun'     = "https://mirrors.aliyun.com/python-release/windows/$file"
        'huawei'     = "https://mirrors.huaweicloud.com/python/$PythonInstallerVersion/$file"
        'python.org' = "https://www.python.org/ftp/python/$PythonInstallerVersion/$file"
    }

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) {
        $urls = @($sources.Values)
        if (-not $setup.PreferCn) { $urls = @($urls[-1]) + @($urls[0..2]) }
        $setup.PythonSourceUrls = $urls
        return $urls
    }

    $probes = foreach ($name in $sources.Keys) {
        $latency = $null
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $raw = & $curl.Source -sI -o NUL -w '%{time_total}' --connect-timeout 3 --max-time 6 $sources[$name] 2>$null
            if ($LASTEXITCODE -eq 0 -and $raw) { $latency = [double]$raw }
        }
        catch {
            $latency = $null
        }
        finally {
            $ErrorActionPreference = $previous
        }
        [pscustomobject]@{ Name = $name; Url = $sources[$name]; Latency = $latency }
    }

    $ordered = @($probes | Where-Object { $null -ne $_.Latency } | Sort-Object Latency)
    $ordered += @($probes | Where-Object { $null -eq $_.Latency })
    $setup.PythonSourceUrls = @($ordered | ForEach-Object { $_.Url })
    $hosts = ($ordered | ForEach-Object { ([uri]$_.Url).Host }) -join ' > '
    Write-Ok "Python 下载源顺序：$hosts"
    return $setup.PythonSourceUrls
}

function Install-PythonFromInstaller([string]$Installer) {
    $setup = $script:Setup
    Write-Step "静默安装 Python $PythonInstallerVersion"
    $logFile = Join-Path $setup.WorkDir "python-$PythonInstallerVersion-install.log"
    $exitCode = Invoke-ProcessWithTimeout -FilePath $Installer -ArgumentList @(
        '/quiet',
        'InstallAllUsers=0',
        'PrependPath=1',
        'Include_launcher=1',
        'InstallLauncherAllUsers=0',
        'Include_pip=1',
        'Include_test=0',
        'Shortcuts=0',
        'AssociateFiles=0',
        '/log', "`"$logFile`""
    ) -TimeoutSeconds 900 -What 'Python 安装'
    Refresh-Path
    $py = Find-Python
    if ($py) {
        if ($exitCode -ne 0 -and $exitCode -ne 3010) {
            Write-WarnLine "安装程序退出码 $exitCode，但已检测到 Python $($py.Version)"
        }
        Write-Ok "Python $($py.Version) ($(($py.Cmd) -join ' '))"
        $setup.Managed.PythonInstalled = $true
        $setup.Managed.PythonMethod = 'installer'
        $setup.Managed.PythonInstaller = $Installer
        return $true
    }
    Write-WarnLine "Python 安装程序退出码 $exitCode，仍未检测到 Python 3.13（日志：$logFile）"
    return $false
}

function Install-PythonFromBundle {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $installer = Get-BundledFile @("python-3.13.*-$arch.exe")
    if (-not $installer) { return $false }
    if (-not (Test-InstallerSignature $installer $PythonSignature)) {
        Write-WarnLine "内置 Python 安装包签名校验未通过，改用在线下载"
        return $false
    }
    Write-Ok "使用内置安装包：$installer"
    return (Install-PythonFromInstaller $installer)
}

function Install-PythonFromMirror {
    $setup = $script:Setup
    $dest = Join-Path $setup.DownloadDir (Get-PythonInstallerFileName)
    $lastError = $null
    $ready = $false
    foreach ($url in (Get-PythonSourceOrder)) {
        try {
            Invoke-Download "Python $PythonInstallerVersion" @($url) $dest $PythonInstallerMinBytes
        }
        catch {
            $lastError = $_.Exception.Message
            Write-WarnLine "该源下载失败，换下一个：$url"
            continue
        }
        if (Test-InstallerSignature $dest $PythonSignature) {
            $ready = $true
            break
        }
        Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
        $lastError = '安装包签名校验未通过'
        Write-WarnLine "安装包签名校验未通过，换下一个源：$url"
    }
    if (-not $ready) {
        throw "Python 安装包下载失败：$lastError"
    }

    return (Install-PythonFromInstaller $dest)
}

function Install-PythonFromWinget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return }
    Write-Step "用 winget 安装 Python 3.13（兜底）"
    $exitCode = Invoke-Winget @('install', '--id', 'Python.Python.3.13', '-e') 'winget 安装 Python 3.13'
    if ($exitCode -ne 0) {
        Write-WarnLine "winget 返回退出码 $exitCode（-1 表示超时）"
    }
    Refresh-Path
    if (Find-Python) {
        $script:Setup.Managed.PythonInstalled = $true
        $script:Setup.Managed.PythonMethod = 'winget'
        $script:Setup.Managed.PythonInstaller = ''
    }
}

function Invoke-Pip {
    param([string]$VenvPython, [string[]]$PipArgs)
    $lastError = '没有可用源'
    foreach ($index in (Get-PipIndexOrder)) {
        Write-Host "    pip 源 $index"
        & $VenvPython -m pip @PipArgs --index-url $index --disable-pip-version-check --no-input --prefer-binary --timeout 60 --retries 3 2>&1 | Out-Host
        if ($LASTEXITCODE -eq 0) { return }
        $lastError = "pip 退出码 $LASTEXITCODE"
        Write-WarnLine "该源失败，换下一个"
    }
    throw "pip 失败：$lastError"
}

function Test-PythonCardStatic {
    $setup = $script:Setup
    if ($setup.SkipPython) { return $true }
    if (-not (Get-BundledWheelhouse)) { return $false }
    if (Find-Python) { return $true }
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
    $installer = Get-BundledFile @("python-3.13.*-$arch.exe")
    return [bool]($installer -and (Test-InstallerSignature $installer $PythonSignature))
}

function Resolve-SkippedPython {
    $setup = $script:Setup
    if (Test-Path -LiteralPath $setup.VenvPy) {
        $setup.VenvPython = $setup.VenvPy
        Write-Ok "复用已有 venv：$($setup.VenvPy)"
    }
    else {
        Write-WarnLine "加了 -SkipPython，且没有找到 venv"
    }
    return $true
}

function Ensure-Venv($PyInfo, [switch]$Offline) {
    $setup = $script:Setup
    Write-Step "创建 Python 虚拟环境"
    Ensure-Directory $setup.RuntimeDir

    $usable = $false
    if (Test-Path -LiteralPath $setup.VenvPy) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $setup.VenvPy -c "import sys" 2>$null | Out-Null
            $usable = ($LASTEXITCODE -eq 0)
        }
        finally {
            $ErrorActionPreference = $previous
        }
    }
    if (-not $usable) {
        if (Test-Path -LiteralPath $setup.VenvDir) {
            Remove-Item -LiteralPath $setup.VenvDir -Recurse -Force
        }
        $cmd = $PyInfo.Cmd
        $rest = @($cmd | Select-Object -Skip 1)
        & $cmd[0] @rest -m venv $setup.VenvDir 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "创建 venv 失败，退出码 $LASTEXITCODE"
        }
        Write-Ok "已创建 $($setup.VenvDir)"
    }
    else {
        Write-Ok "复用已有 venv：$($setup.VenvDir)"
    }

    if (-not (Test-Path -LiteralPath $setup.VenvPy)) {
        throw "venv 里没有 python.exe：$($setup.VenvPy)"
    }

    $hasPackages = $false
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $setup.VenvPy -c "import numpy, scipy, pyvista, trimesh, manifold3d" 2>$null | Out-Null
        $hasPackages = ($LASTEXITCODE -eq 0)
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($hasPackages) {
        Write-Ok "依赖包已存在"
    }
    else {
        $installed = $false
        if ($Offline) {
            $wheelhouse = Get-BundledWheelhouse
            if (-not $wheelhouse) {
                Write-WarnLine "没有内置 wheelhouse，改用动态安装"
                return $false
            }
            Write-Step "从内置 wheelhouse 安装 Python 包"
            Write-Ok "wheelhouse：$wheelhouse"
            & $setup.VenvPy -m pip install --no-index --find-links $wheelhouse --disable-pip-version-check --no-input @($setup.Packages) 2>&1 | Out-Host
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "包已离线安装"
                $installed = $true
            }
            else {
                Write-WarnLine "内置 wheelhouse 安装失败（退出码 $LASTEXITCODE），改用动态安装"
                return $false
            }
        }

        if (-not $installed) {
            Write-Step "升级 pip"
            try {
                Invoke-Pip -VenvPython $setup.VenvPy -PipArgs @('install', '--upgrade', 'pip')
                Write-Ok "pip 已升级"
            }
            catch {
                # 旧版 pip 一般也能装轮子，升级失败不阻断整个安装。
                Write-WarnLine "pip 升级失败，继续使用当前 pip：$($_.Exception.Message)"
            }

            Write-Step "安装固定版本的包"
            Invoke-Pip -VenvPython $setup.VenvPy -PipArgs (@('install') + @($setup.Packages))
            Write-Ok "包已安装"
        }

        $verify = "import numpy, scipy, pyvista, trimesh, manifold3d`nfor m in (numpy, scipy, pyvista, trimesh, manifold3d): print(m.__name__, getattr(m, '__version__', 'ok'))"
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $setup.VenvPy -c $verify 2>&1 | Out-Host
            $verifyOk = ($LASTEXITCODE -eq 0)
        }
        finally {
            $ErrorActionPreference = $previous
        }
        if (-not $verifyOk) {
            if ($Offline) {
                Write-WarnLine "离线安装的包无法导入，改用动态安装"
                return $false
            }
            throw "Python 包导入检查失败"
        }
        Write-Ok "所有包均可导入"
    }

    $reqFile = Join-Path $setup.VenvDir 'requirements.txt'
    [System.IO.File]::WriteAllLines($reqFile, $setup.Packages)
    Write-Ok "已写入版本清单 $reqFile"
    return $true
}

function Invoke-PythonCardStatic {
    $setup = $script:Setup
    if ($setup.SkipPython) { return (Resolve-SkippedPython) }

    $py = Find-Python
    if (-not $py) {
        if (-not (Install-PythonFromBundle)) {
            Write-WarnLine "内置 Python 安装包不可用，改用动态安装"
            return $false
        }
        $py = Find-Python
        if (-not $py) { throw "内置 Python 安装包安装后仍未检测到 Python 3.13" }
    }

    if (-not (Ensure-Venv $py -Offline)) { return $false }
    $setup.VenvPython = $setup.VenvPy
    return $true
}

function Invoke-PythonCardDynamic {
    $setup = $script:Setup
    if ($setup.SkipPython) { return (Resolve-SkippedPython) }

    $py = Find-Python
    if (-not $py) {
        try {
            [void](Install-PythonFromMirror)
        }
        catch {
            Write-WarnLine $_.Exception.Message
        }
        $py = Find-Python
    }
    if (-not $py) {
        Install-PythonFromWinget
        Refresh-Path
        $py = Find-Python
    }
    if (-not $py) {
        $installer = Join-Path $setup.DownloadDir (Get-PythonInstallerFileName)
        throw "Python 3.13 安装失败。可手动运行 $installer，或从 https://www.python.org/downloads/ 安装 3.13.x 后重试。"
    }

    if (-not (Ensure-Venv $py)) { throw "Python 依赖安装失败" }
    $setup.VenvPython = $setup.VenvPy
    return $true
}

@{
    Id            = 'python'
    Title         = '配置 Python 环境'
    TestStatic    = 'Test-PythonCardStatic'
    InvokeStatic  = 'Invoke-PythonCardStatic'
    InvokeDynamic = 'Invoke-PythonCardDynamic'
}

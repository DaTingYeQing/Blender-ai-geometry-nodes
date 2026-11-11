# 安装引擎的公共能力：日志、进程超时、下载、探测和内置资源定位。
# 所有函数通过 $script:Setup 读取路径和开关，不直接依赖入口参数。

$MinNode = [version]'22.19.0'
$NpmPackage = '@earendil-works/pi-coding-agent'
$CnNpmRegistry = 'https://registry.npmmirror.com'
$GhMirrors = @(
    'https://ghfast.top/',
    'https://gh-proxy.com/',
    'https://ghproxy.net/',
    'https://mirror.ghproxy.com/'
)

$MinPython = [version]'3.13.0'
# 固定安装的补丁版本；升级 Python 补丁时只改这里。
$PythonInstallerVersion = '3.13.17'
$PythonInstallerMinBytes = 15000000
$PythonSignature = 'Python Software Foundation'
$DefaultPackages = @(
    'numpy==2.5.3',
    'scipy==1.18.1',
    'pyvista==0.49.0',
    'trimesh==5.1.0',
    'manifold3d==3.5.3'
)
$OfficialPipIndexes = @('https://pypi.org/simple')
$CnPipIndexes = @(
    'https://pypi.tuna.tsinghua.edu.cn/simple',
    'https://mirrors.aliyun.com/pypi/simple',
    'https://mirrors.cloud.tencent.com/pypi/simple'
)

function Resolve-FullPath([string]$Path) {
    if (-not $Path) { return $Path }
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        $Path = Join-Path (Get-Location) $Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Ensure-Directory([string]$Path) {
    if (-not $Path) { return }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
    Write-Host "    $Message" -ForegroundColor Yellow
}

# 在安装包内置的离线资源目录里按通配符找文件，找不到返回 $null。
function Get-BundledFile([string[]]$Patterns) {
    $bundleDir = $script:Setup.BundleDir
    if (-not $bundleDir -or -not (Test-Path -LiteralPath $bundleDir)) { return $null }
    foreach ($pattern in $Patterns) {
        # 目录里同时存在新旧版本时，用最后写入时间选最新的，避免版本号字符串排序出错。
        $found = Get-ChildItem -LiteralPath $bundleDir -File -Filter $pattern -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Get-BundledWheelhouse {
    $dir = Join-Path $script:Setup.BundleDir 'wheels'
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $wheels = @(Get-ChildItem -LiteralPath $dir -Filter '*.whl' -File -ErrorAction SilentlyContinue)
    if ($wheels.Count -eq 0) { return $null }
    return $dir
}

# 带硬超时的外部命令执行：网络卡住时杀掉整个进程树，避免安装脚本无限等待。
# 返回退出码；超时返回 -1。
function Invoke-ProcessWithTimeout {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int]$TimeoutSeconds = 600,
        [string]$What = '外部命令'
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $process = $null
    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $FilePath
        if ($ArgumentList.Count -gt 0) { $startInfo.Arguments = ($ArgumentList -join ' ') }
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        # 异步读流，避免子进程写满管道缓冲区后卡住。
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            Write-WarnLine "$What 超过 $TimeoutSeconds 秒未完成，已终止"
            $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
            & $taskkill /PID $process.Id /T /F 2>$null | Out-Null
            if (-not $process.WaitForExit(15000)) {
                try { $process.Kill() } catch { }
            }
            Write-ProcessOutput $outTask $errTask 40
            return -1
        }

        $process.WaitForExit()
        Write-ProcessOutput $outTask $errTask 200
        return $process.ExitCode
    }
    finally {
        $ErrorActionPreference = $previous
        if ($process) { $process.Dispose() }
    }
}

function Write-ProcessOutput($OutTask, $ErrTask, [int]$TailLines) {
    foreach ($task in @($OutTask, $ErrTask)) {
        try {
            # 子进程已退出，但外部孙进程可能仍占着管道，不能无限等 Result。
            if ($task.Wait(3000) -and $task.IsCompleted -and -not $task.IsFaulted) {
                $text = $task.Result
                if ($text) {
                    $text -split '\r?\n' | Where-Object { $_.Trim() } | Select-Object -Last $TailLines | Out-Host
                }
            }
        }
        catch {
            # 读流失败只影响日志，不影响退出码。
        }
    }
}

# winget 自身没有下载超时，统一走这个封装；超时返回 -1。
function Invoke-Winget {
    param(
        [string[]]$WingetArgs,
        [string]$What,
        [int]$TimeoutSeconds = 900
    )
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { return -2 }
    # 只用 winget 源，避免 msstore 源更新或协议交互把安装卡住。
    $allArgs = @($WingetArgs) + @(
        '--source', 'winget',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity'
    )
    return (Invoke-ProcessWithTimeout -FilePath $winget.Source -ArgumentList $allArgs -TimeoutSeconds $TimeoutSeconds -What $What)
}

function Test-InstallerSignature {
    param([string]$Path, [string]$SignerPattern)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $signature = Get-AuthenticodeSignature -LiteralPath $Path
        if ($signature.Status -ne 'Valid') { return $false }
        return ($signature.SignerCertificate.Subject -match $SignerPattern)
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-GithubReachable {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $true }
    & curl.exe -fsI --connect-timeout 5 --max-time 8 -o NUL "https://github.com" | Out-Null
    return $LASTEXITCODE -eq 0
}

function Test-PyPiReachable {
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) { return $true }
    & curl.exe -fsI --connect-timeout 5 --max-time 8 -o NUL "https://pypi.org/simple/" | Out-Null
    return $LASTEXITCODE -eq 0
}

function Get-SourceOrder([string]$GithubUrl) {
    $mirrored = foreach ($prefix in $GhMirrors) { $prefix + $GithubUrl }
    if ($script:Setup.PreferCn) {
        return @($mirrored) + $GithubUrl
    }
    return @($GithubUrl) + @($mirrored)
}

function Get-PipIndexOrder {
    if ($script:Setup.PreferOfficialPip) {
        return @($OfficialPipIndexes) + $CnPipIndexes
    }
    return @($CnPipIndexes) + @($OfficialPipIndexes)
}

function Get-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    $candidate = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}

function Get-NodeVersion {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & node -v 2>$null
        if ($LASTEXITCODE -eq 0 -and $raw) {
            return [version]($raw.Trim().TrimStart('v'))
        }
        $nodeExe = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if (Test-Path -LiteralPath $nodeExe) {
            $raw = & $nodeExe -v 2>$null
            if ($LASTEXITCODE -eq 0 -and $raw) {
                return [version]($raw.Trim().TrimStart('v'))
            }
        }
        return $null
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-PythonVersion([string[]]$Cmd) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $rest = @($Cmd | Select-Object -Skip 1)
        $out = & $Cmd[0] @rest --version 2>$null | Out-String
        if ($LASTEXITCODE -ne 0) { return $null }
        $m = [regex]::Match($out, '(\d+)\.(\d+)\.(\d+)')
        if (-not $m.Success) { return $null }
        return [version]$m.Value
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Find-Python {
    $candidates = New-Object System.Collections.Generic.List[object]
    $dirs = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313-arm64')
    )
    if ($env:ProgramFiles) {
        $dirs += @(
            (Join-Path $env:ProgramFiles 'Python313'),
            (Join-Path $env:ProgramFiles 'Python313-arm64')
        )
    }
    if (${env:ProgramFiles(x86)}) {
        $dirs += (Join-Path ${env:ProgramFiles(x86)} 'Python313')
    }
    foreach ($dir in $dirs) {
        $exe = Join-Path $dir 'python.exe'
        if (Test-Path -LiteralPath $exe) { [void]$candidates.Add(@($exe)) }
    }
    [void]$candidates.Add(@('py', '-3.13'))
    [void]$candidates.Add(@('py', '-3'))
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    # WindowsApps 下的 python.exe 是应用商店别名，执行时可能拉起商店，跳过。
    if ($pythonCmd -and $pythonCmd.Source -and $pythonCmd.Source -notmatch '\\WindowsApps\\') {
        [void]$candidates.Add(@($pythonCmd.Source))
    }

    foreach ($candidate in $candidates) {
        $v = Get-PythonVersion $candidate
        if ($v -and $v.Major -eq 3 -and $v.Minor -eq 13) {
            return @{ Cmd = $candidate; Version = $v }
        }
    }
    return $null
}

function Get-GitBash {
    $portable = Join-Path $script:Setup.RuntimeDir 'git\bin\bash.exe'
    if (Test-Path -LiteralPath $portable) { return $portable }
    foreach ($candidate in @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
    )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($bash -and $bash.Source) { return $bash.Source }
    return $null
}

function Get-AgentDir {
    if ($env:PI_CODING_AGENT_DIR) { return $env:PI_CODING_AGENT_DIR }
    return Join-Path $env:USERPROFILE '.pi\agent'
}

function Get-AgentBinDir {
    return Join-Path (Get-AgentDir) 'bin'
}

function Get-PiCommand {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $cmd = Get-Command pi -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) {
            $out = & $cmd.Source --version 2>$null
            if ($LASTEXITCODE -eq 0) {
                $version = (($out | Select-Object -Last 1) -as [string]).Trim()
                return [pscustomobject]@{ Path = $cmd.Source; Version = $version }
            }
        }

        $npm = Get-Command npm -ErrorAction SilentlyContinue
        if ($npm -and $npm.Source) {
            $prefix = (& $npm.Source prefix -g 2>$null | Select-Object -Last 1)
            if ($prefix) {
                foreach ($name in @('pi.cmd', 'pi.ps1', 'pi')) {
                    $candidate = Join-Path $prefix.Trim() $name
                    if (Test-Path -LiteralPath $candidate) {
                        $out = & $candidate --version 2>$null
                        if ($LASTEXITCODE -eq 0) {
                            $version = (($out | Select-Object -Last 1) -as [string]).Trim()
                            return [pscustomobject]@{ Path = $candidate; Version = $version }
                        }
                    }
                }
            }
        }
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Get-PiCliPath {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm -or -not $npm.Source) { return $null }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $root = (& $npm.Source root -g 2>$null | Select-Object -Last 1)
        if (-not $root) { return $null }
        foreach ($rel in @(
            '@earendil-works/pi-coding-agent/dist/bundle/cli.js',
            '@earendil-works/pi-coding-agent/dist/cli.js'
        )) {
            $candidate = Join-Path $root.Trim() $rel
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
        return $null
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Find-InReleasePages([string]$Repo, [string]$FileRegex) {
    $tmp = Join-Path $script:Setup.WorkDir 'releases.html'
    foreach ($source in (Get-SourceOrder "https://github.com/$Repo/releases")) {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
        & curl.exe -fsSL --connect-timeout 12 --max-time 45 -A "pi-flow-setup" -o $tmp $source
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tmp)) { continue }
        $html = Get-Content -LiteralPath $tmp -Raw
        $match = [regex]::Match($html, "releases/download/([^""'\s>]+)/($FileRegex)")
        if ($match.Success) {
            $tag = $match.Groups[1].Value
            $file = $match.Groups[2].Value
            return "https://github.com/$Repo/releases/download/$tag/$file"
        }
    }
    return $null
}

function Get-LatestVersion([string]$Repo) {
    $headerFile = Join-Path $script:Setup.WorkDir 'latest-headers.txt'
    foreach ($source in (Get-SourceOrder "https://github.com/$Repo/releases/latest")) {
        if (Test-Path -LiteralPath $headerFile) { Remove-Item -LiteralPath $headerFile -Force }
        & curl.exe -sI -L --max-redirs 5 --connect-timeout 12 --max-time 30 -A "pi-flow-setup" -o $headerFile $source
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $headerFile)) { continue }
        $headers = Get-Content -LiteralPath $headerFile -Raw
        $tagMatch = [regex]::Match($headers, '/releases/tag/v?([0-9]+\.[0-9]+\.[0-9]+)')
        if ($tagMatch.Success) { return $tagMatch.Groups[1].Value }
    }
    return $null
}

function Resolve-ToolUrl([string]$Repo, [string]$TagPrefix, [string[]]$FileTemplates) {
    foreach ($template in $FileTemplates) {
        $regex = [regex]::Escape($template).Replace('\{version\}', '[0-9]+\.[0-9]+\.[0-9]+')
        $found = Find-InReleasePages $Repo $regex
        if ($found) { return $found }
    }

    $template = $FileTemplates[0]
    if ($template -notmatch '\{version\}') {
        $versionMatch = [regex]::Match($template, '([0-9]+\.[0-9]+\.[0-9]+)')
        if (-not $versionMatch.Success) { return $null }
        $tag = "$TagPrefix$($versionMatch.Groups[1].Value)"
        return "https://github.com/$Repo/releases/download/$tag/$template"
    }

    $version = Get-LatestVersion $Repo
    if (-not $version) { return $null }
    $file = $template.Replace('{version}', $version)
    return "https://github.com/$Repo/releases/download/$TagPrefix$version/$file"
}

function Invoke-Download([string]$Name, [string[]]$Urls, [string]$Dest, [long]$MinBytes = 1000) {
    $hasCurl = [bool](Get-Command curl.exe -ErrorAction SilentlyContinue)
    Ensure-Directory (Split-Path -Parent $Dest)
    foreach ($url in $Urls) {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            $size = 0
            if (Test-Path -LiteralPath $Dest) { $size = (Get-Item -LiteralPath $Dest).Length }
            # 小于阈值说明上次没下完，保留并用 -C - 续传，避免重复下载几百 MB。
            $resume = ($size -gt 0) -and ($size -lt $MinBytes)
            Write-Host "    下载 $Name（$attempt/3）：$url"
            $ok = $false
            if ($hasCurl) {
                # 45 秒内平均速度低于 1KB/s 视为卡死，主动中断后重试，避免干等半小时。
                if ($resume) {
                    & curl.exe -fLsS -C - --connect-timeout 10 --speed-limit 1024 --speed-time 45 --max-time 1800 -o $Dest $url
                }
                else {
                    & curl.exe -fLsS --connect-timeout 10 --speed-limit 1024 --speed-time 45 --max-time 1800 -o $Dest $url
                }
                $ok = ($LASTEXITCODE -eq 0)
                # 33 = 服务器不支持断点续传，丢掉残包，下次从头下。
                if ($LASTEXITCODE -eq 33 -and (Test-Path -LiteralPath $Dest)) {
                    Remove-Item -LiteralPath $Dest -Force
                }
            }
            else {
                Invoke-WebRequest -Uri $url -OutFile $Dest -UseBasicParsing -TimeoutSec 1800
                $ok = $true
            }
            if ($ok -and (Test-Path -LiteralPath $Dest) -and ((Get-Item -LiteralPath $Dest).Length -ge $MinBytes)) {
                Write-Ok "$Name 下载完成"
                return
            }
            Start-Sleep -Seconds 1
        }
    }
    throw "下载 $Name 失败（已尝试所有源）"
}

function Get-TarExe {
    # PATH 里可能先命中 Git 自带的 GNU tar，它会把 C:\ 当成远程主机，必须用 Windows 自带的。
    foreach ($name in @('tar.exe', 'bsdtar.exe')) {
        $candidate = Join-Path $env:SystemRoot "System32\$name"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Test-BlenderArchive([string]$Archive) {
    if (-not (Test-Path -LiteralPath $Archive)) { return $false }
    if ((Get-Item -LiteralPath $Archive).Length -lt 100000000) { return $false }
    $tar = Get-TarExe
    if (-not $tar) { return $true }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $listing = & $tar -tf $Archive 2>$null
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return ($code -eq 0) -and ([bool]($listing | Where-Object { $_ -like '*blender.exe' }))
}

function Get-BlenderExe {
    $srcBlender = $script:Setup.BlenderSrcBlender
    $srcExe = $script:Setup.BlenderSrcBlenderExe
    if (Test-Path -LiteralPath $srcExe) { return $srcExe }
    $nested = Join-Path $srcBlender 'bin\blender.exe'
    if (Test-Path -LiteralPath $nested) { return $nested }

    # 兼容旧版部署位置：<runtime>\blender\...
    $legacyRoot = Join-Path $script:Setup.RuntimeDir 'blender'
    if (-not (Test-Path -LiteralPath $legacyRoot)) { return $null }
    $direct = Join-Path $legacyRoot 'blender.exe'
    if (Test-Path -LiteralPath $direct) { return $direct }
    $found = Get-ChildItem -LiteralPath $legacyRoot -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'blender.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
    return $found
}

function Test-ToolReady([string]$Name) {
    $fileName = if ($Name -eq 'rg') { 'rg.exe' } else { 'fd.exe' }
    $local = Join-Path $script:Setup.BinDir $fileName
    $candidates = @()
    if (Test-Path -LiteralPath $local) { $candidates += $local }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $candidates += $cmd.Source }
    foreach ($candidate in $candidates) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $candidate --version 1>$null 2>$null
            $ok = ($LASTEXITCODE -eq 0)
        }
        finally {
            $ErrorActionPreference = $previous
        }
        if ($ok) { return $candidate }
    }
    return $null
}

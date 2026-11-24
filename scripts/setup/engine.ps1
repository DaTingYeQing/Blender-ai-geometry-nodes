# 安装引擎：初始化上下文、加载卡片、决定静态/动态安装、维护步骤协议和最终结果。
# 卡片契约（cards/*.ps1 返回一个哈希表）：
#   Id / Title
#   TestStatic   可选，返回内置资源是否可用
#   InvokeStatic 可选，返回 $true/$false；失败或返回 false 时引擎改用动态安装
#   InvokeDynamic 可选，返回 $true/$false 或抛异常
#   Invoke       可选，总是执行，用于没有静态/动态之分的卡片（如网络探测、写配置）

function Write-StepStart([string]$Title) {
    $script:Setup.StepIndex++
    $script:Setup.StepTitle = $Title
    Write-Output ("PIFLOW_STEP=" + $script:Setup.StepIndex + "/" + $script:Setup.StepTotal + "|running|" + $Title)
}

function Write-StepDone {
    $setup = $script:Setup
    if ($setup.StepIndex -le 0) { return }
    Write-Output ("PIFLOW_STEP=" + $setup.StepIndex + "/" + $setup.StepTotal + "|done|" + $setup.StepTitle)
}

function Initialize-SetupContext {
    param([hashtable]$Options)

    $installRoot = if ($Options.InstallRoot) { $Options.InstallRoot } else { Join-Path $env:LOCALAPPDATA 'PiFlow' }
    $installRoot = Resolve-FullPath $installRoot
    $runtimeDir = if ($Options.RuntimeDir) { Resolve-FullPath $Options.RuntimeDir } else { Join-Path $installRoot 'runtime' }
    $workspaceDir = if ($Options.WorkspaceDir) { Resolve-FullPath $Options.WorkspaceDir } else { Join-Path $installRoot 'workspace' }
    $configPath = if ($Options.ConfigPath) { Resolve-FullPath $Options.ConfigPath } else { Join-Path $installRoot 'config\py_environment.json' }
    $envTemplate = if ($Options.EnvTemplate) { Resolve-FullPath $Options.EnvTemplate } else { Join-Path $script:ScriptRoot '..\shard\py_environment.json' }
    $bundleDir = if ($Options.BundleDir) { Resolve-FullPath $Options.BundleDir } else { Join-Path $script:ScriptRoot '..\resources\bundles' }
    $blenderArchive = if ($Options.BlenderArchive) { Resolve-FullPath $Options.BlenderArchive } else { Join-Path $script:ScriptRoot '..\resources\blender\blender-4.5.0-trace-win64.zip' }
    # CovTrace 工具链和 Blender 压缩包一起分发，固定放在同一目录。
    $covtraceArchive = Join-Path (Split-Path -Parent $blenderArchive) 'covtrace-toolchain.zip'
    $resultPath = if ($Options.ResultPath) { Resolve-FullPath $Options.ResultPath } else { '' }

    # 分层版本：runtime / config / data 各自一个版本号，升级时逐层对账。
    # 版本号在 shard\versions.json，换层语义时手动 +1；appVersion 由 Electron 传入。
    $versionsPath = Join-Path (Split-Path -Parent $envTemplate) 'versions.json'
    $versions = $null
    if (Test-Path -LiteralPath $versionsPath) {
        try {
            $versionsRaw = [System.IO.File]::ReadAllText($versionsPath, [System.Text.Encoding]::UTF8)
            $versions = $versionsRaw.TrimStart([char]0xFEFF) | ConvertFrom-Json
        }
        catch {
            $versions = $null
        }
    }
    $runtimeLayout = if ($versions -and $versions.runtimeLayout) { [string]$versions.runtimeLayout } else { '' }
    # 同版本重新编译不会改变 blender.exe 的 ProductVersion，用显式构建标记识别换包。
    $blenderBuild = if ($versions -and $versions.blenderBuild) { [string]$versions.blenderBuild } else { '' }
    $covtraceVersion = if ($versions -and $versions.covtraceVersion) { [string]$versions.covtraceVersion } else { '' }
    $configVersion = if ($versions -and $versions.configVersion) { [string]$versions.configVersion } else { '' }
    $dataSchemaVersion = if ($versions -and $versions.dataSchemaVersion) { [string]$versions.dataSchemaVersion } else { '' }
    # 组件版本不属于分层版本：Blender 版本从内置压缩包文件名取，换包自动跟着变。
    $blenderVersion = if ((Split-Path -Leaf $blenderArchive) -match 'blender-([\d.]+)') {
        Normalize-BlenderVersion $Matches[1]
    }
    else { '' }
    $appVersion = if ($Options.AppVersion) { [string]$Options.AppVersion } else { '' }

    # 插桩 Blender + CovTrace 工具链。目录布局复刻编译机的 blender-src，
    # CovTrace 的 directories.py 会据此相对定位 llvm / 源码 / blender.exe。
    $blenderSrcRoot = Join-Path $runtimeDir 'blender-src'
    $blenderSrcDir = Join-Path $blenderSrcRoot 'blender-4.5.0-mini-source'

    $setup = @{
        InstallRoot          = $installRoot
        RuntimeDir           = $runtimeDir
        WorkspaceDir         = $workspaceDir
        ConfigPath           = $configPath
        EnvTemplate          = $envTemplate
        BundleDir            = $bundleDir
        BlenderArchive       = $blenderArchive
        CovtraceArchive      = $covtraceArchive
        ResultPath           = $resultPath
        AppVersion           = $appVersion
        BlenderVersion       = $blenderVersion
        BlenderBuild         = $blenderBuild
        RuntimeLayout        = $runtimeLayout
        CovtraceVersion      = $covtraceVersion
        ConfigVersion        = $configVersion
        DataSchemaVersion    = $dataSchemaVersion

        BlenderSrcRoot       = $blenderSrcRoot
        BlenderSrcDir        = $blenderSrcDir
        CovtraceEngine       = Join-Path $blenderSrcDir 'covtrace-kit\CovTrace\engine.py'
        BlenderSrcBlender    = Join-Path $blenderSrcRoot 'blender'
        BlenderSrcBlenderExe = Join-Path $blenderSrcRoot 'blender\blender.exe'
        BlenderBuildFile     = Join-Path $blenderSrcRoot 'blender\.pi-flow-build'
        CovtraceLlvmCov      = Join-Path $blenderSrcRoot 'llvm-mini\bin\llvm-cov.exe'
        CovtraceVersionFile  = Join-Path $blenderSrcRoot '.covtrace-version'

        WorkDir              = Join-Path $env:TEMP ("piflow-setup-" + $PID)
        DownloadDir          = Join-Path $runtimeDir 'downloads'
        BinDir               = Get-AgentBinDir

        SkipBlender          = [bool]$Options.SkipBlender
        ForceBlender         = [bool]$Options.ForceBlender
        SkipNode             = [bool]$Options.SkipNode
        SkipPi               = [bool]$Options.SkipPi
        SkipGit              = [bool]$Options.SkipGit
        SkipTools            = [bool]$Options.SkipTools
        AutoUpgradeNode      = [bool]$Options.AutoUpgradeNode
        UpdatePi             = [bool]$Options.UpdatePi
        CheckOnly            = [bool]$Options.CheckOnly

        PreferCn             = $false
        PythonSourceUrls     = $null

        StepTitles           = @()
        StepTotal            = 0
        StepIndex            = 0
        StepTitle            = ''

        Pi                   = $null
        GitBash              = $null
        BlenderExe           = $null

        # 卸载清理依据：只回收本次安装真正创建的东西。
        # Python 三项是旧版（v2.0.0）留下的归属记录，本版不再安装系统 Python，
        # 但重跑安装时要原样带过去，卸载新版时才能把旧版装的 Python 一起回收。
        Managed              = @{
            PiInstalled      = $false
            NodeInstalled    = $false
            GitMethod        = ''
            PythonInstalled  = $false
            PythonMethod     = ''
            PythonInstaller  = ''
            Tools            = @{}
        }
    }

    $script:Setup = $setup

    # 重跑安装（修复/升级）时，Node/pi 已经存在，卡片不会再标记“本次安装”。
    # 先继承上一次成功安装的归属清单，避免把“是我装的”抹掉，导致卸载时删不掉。
    if ($resultPath -and (Test-Path -LiteralPath $resultPath)) {
        $previous = $null
        try {
            $previousRaw = [System.IO.File]::ReadAllText($resultPath, [System.Text.Encoding]::UTF8)
            $previous = ($previousRaw.TrimStart([char]0xFEFF) | ConvertFrom-Json).managed
        }
        catch {
            $previous = $null
        }
        if ($previous) {
            if ($previous.piInstalled) { $setup.Managed.PiInstalled = $true }
            if ($previous.nodeInstalled) { $setup.Managed.NodeInstalled = $true }
            if ($previous.gitMethod) { $setup.Managed.GitMethod = [string]$previous.gitMethod }
            if ($previous.pythonInstalled) { $setup.Managed.PythonInstalled = $true }
            if ($previous.pythonMethod) { $setup.Managed.PythonMethod = [string]$previous.pythonMethod }
            if ($previous.pythonInstaller) { $setup.Managed.PythonInstaller = [string]$previous.pythonInstaller }
            if ($previous.tools) {
                foreach ($tool in $previous.tools.PSObject.Properties) {
                    $setup.Managed.Tools[$tool.Name] = [string]$tool.Value
                }
            }
        }
    }

    Ensure-Directory $setup.WorkDir
    Ensure-Directory $setup.BlenderSrcBlender
    return $setup
}

function Invoke-SetupCard($Card) {
    if ($Card.Invoke) {
        $result = & $Card.Invoke
        if ($result -eq $false) { throw "$($Card.Title) 执行失败" }
        return
    }

    $staticOk = $false
    if ($Card.TestStatic) {
        try {
            $staticOk = [bool](& $Card.TestStatic)
        }
        catch {
            Write-WarnLine "内置资源检查失败：$($_.Exception.Message)"
            $staticOk = $false
        }
    }

    if ($staticOk -and $Card.InvokeStatic) {
        $installed = $false
        try {
            $installed = (& $Card.InvokeStatic) -ne $false
        }
        catch {
            Write-WarnLine "静态安装失败：$($_.Exception.Message)"
            $installed = $false
        }
        if ($installed) { return }
        Write-WarnLine "改用动态安装：$($Card.Title)"
    }

    if (-not $Card.InvokeDynamic) {
        throw "$($Card.Title) 的内置资源不可用，且没有动态安装方式"
    }
    $result = & $Card.InvokeDynamic
    if ($result -eq $false) { throw "$($Card.Title) 安装失败" }
}

function Write-SetupData($Data) {
    $json = $Data | ConvertTo-Json -Depth 8 -Compress
    $setup = $script:Setup
    if ($setup.ResultPath) {
        Ensure-Directory (Split-Path -Parent $setup.ResultPath)
        [System.IO.File]::WriteAllText($setup.ResultPath, $json, [System.Text.UTF8Encoding]::new($false))
    }
    Write-Output ("PIFLOW_SETUP_RESULT=" + $json)
}

function Get-ManagedSnapshot {
    $setup = $script:Setup
    return [ordered]@{
        installRoot     = $setup.InstallRoot
        agentBinDir     = $setup.BinDir
        piInstalled     = [bool]$setup.Managed.PiInstalled
        nodeInstalled   = [bool]$setup.Managed.NodeInstalled
        gitMethod       = [string]$setup.Managed.GitMethod
        pythonInstalled = [bool]$setup.Managed.PythonInstalled
        pythonMethod    = [string]$setup.Managed.PythonMethod
        pythonInstaller = [string]$setup.Managed.PythonInstaller
        tools           = $setup.Managed.Tools
    }
}

function Write-SetupResult {
    param([string]$Error = '')
    $setup = $script:Setup
    # 清单记录实际装上的 Blender 版本；升级对账才不会把旧机器误判成新版本。
    $setup.BlenderVersion = if (Test-Path -LiteralPath $setup.BlenderSrcBlenderExe) {
        Get-BlenderFileVersion $setup.BlenderSrcBlenderExe
    }
    else {
        ''
    }
    # 清单记录实际铺好的构建标记；没铺过（老安装）就是空，下次启动会强制替换。
    $blenderBuild = Get-BlenderInstalledBuild
    # 清单记录实际铺好的工具链版本；没铺过就是空，下次启动会重新部署。
    $setup.CovtraceVersion = Get-CovtraceVersion
    if ($Error) {
        # 失败也要保留归属清单：已经装上的 Node/pi 卸载时还得能回收。
        Write-SetupData ([ordered]@{
            ok             = $false
            error          = $Error
            appVersion        = $setup.AppVersion
            blenderVersion    = $setup.BlenderVersion
            blenderBuild      = $blenderBuild
            runtimeLayout     = $setup.RuntimeLayout
            covtraceVersion   = $setup.CovtraceVersion
            configVersion     = $setup.ConfigVersion
            dataSchemaVersion = $setup.DataSchemaVersion
            managed           = Get-ManagedSnapshot
        })
        return
    }

    $nodeVersion = Get-NodeVersion
    $pi = if ($setup.Pi) { $setup.Pi } else { Get-PiCommand }
    Write-SetupData ([ordered]@{
        ok             = $true
        checkOnly      = $false
        appVersion        = $setup.AppVersion
        blenderVersion    = $setup.BlenderVersion
        blenderBuild      = $blenderBuild
        runtimeLayout     = $setup.RuntimeLayout
        covtraceVersion   = $setup.CovtraceVersion
        configVersion     = $setup.ConfigVersion
        dataSchemaVersion = $setup.DataSchemaVersion
        node           = if ($nodeVersion) { $nodeVersion.ToString() } else { $null }
        nodeExe        = Get-NodeExe
        pi             = if ($pi) { $pi.Path } else { $null }
        piVersion      = if ($pi) { $pi.Version } else { $null }
        piCli          = Get-PiCliPath
        gitBash        = $setup.GitBash
        python         = Get-BlenderPythonExe $setup.BlenderExe
        blenderExe     = $setup.BlenderExe
        blenderReady   = [bool]$setup.BlenderExe
        workspace      = $setup.WorkspaceDir
        config         = $setup.ConfigPath
        configExists   = (Test-Path -LiteralPath $setup.ConfigPath)
        managed        = Get-ManagedSnapshot
    })
}

# 卸载脚本必须放在 AppData：NSIS 的 customUnInstall 在删除 $INSTDIR 之后才执行。
function Install-CleanupScript {
    $setup = $script:Setup
    $source = Join-Path $script:ScriptRoot 'uninstall-runtime.ps1'
    if (-not (Test-Path -LiteralPath $source)) {
        Write-WarnLine "找不到卸载清理脚本：$source"
        return
    }
    Ensure-Directory $setup.InstallRoot
    Copy-Item -LiteralPath $source -Destination (Join-Path $setup.InstallRoot 'uninstall-runtime.ps1') -Force
}

function Invoke-CheckOnly {
    $setup = $script:Setup
    $node = Get-NodeVersion
    $pi = Get-PiCommand
    $gitBash = Get-GitBash
    $tools = [ordered]@{
        fd = if (-not $setup.SkipTools) { Test-ToolReady 'fd' } else { $null }
        rg = if (-not $setup.SkipTools) { Test-ToolReady 'rg' } else { $null }
    }
    $blenderExe = Get-BlenderExe
    $blenderVersion = Get-BlenderFileVersion $blenderExe

    Write-SetupData ([ordered]@{
        ok                = $true
        checkOnly         = $true
        appVersion        = $setup.AppVersion
        blenderVersion    = if ($blenderVersion) { $blenderVersion } else { $null }
        blenderBuild      = Get-BlenderInstalledBuild
        runtimeLayout     = $setup.RuntimeLayout
        covtraceVersion   = Get-CovtraceVersion
        configVersion     = $setup.ConfigVersion
        dataSchemaVersion = $setup.DataSchemaVersion
        node           = if ($node) { $node.ToString() } else { $null }
        nodeExe        = Get-NodeExe
        pi             = if ($pi) { $pi.Path } else { $null }
        piVersion      = if ($pi) { $pi.Version } else { $null }
        piCli          = Get-PiCliPath
        gitBash        = $gitBash
        blenderExe     = $blenderExe
        blenderReady   = [bool]$blenderExe
        workspace      = $setup.WorkspaceDir
        config        = $setup.ConfigPath
        configExists  = (Test-Path -LiteralPath $setup.ConfigPath)
        tools         = $tools
    })
}

function Start-SetupEngine {
    param([hashtable]$Options)

    $setup = Initialize-SetupContext $Options
    if ($setup.CheckOnly) {
        Invoke-CheckOnly
        exit 0
    }

    # 先把清理脚本放到 AppData：后面无论哪一步失败，卸载时都还有东西可回收。
    Install-CleanupScript

    $cards = $script:SetupCards
    $setup.StepTitles = @($cards | ForEach-Object { $_.Title })
    $setup.StepTotal = $setup.StepTitles.Count

    try {
        Write-Output ("PIFLOW_STEPS=" + ($setup.StepTitles -join '|'))
        foreach ($card in $cards) {
            Write-StepStart $card.Title
            Invoke-SetupCard $card
            Write-StepDone
        }
        Write-SetupResult
        exit 0
    }
    catch {
        $message = $_.Exception.Message
        if ($setup.StepIndex -gt 0) {
            Write-Output ("PIFLOW_STEP=" + $setup.StepIndex + "/" + $setup.StepTotal + "|failed|" + $setup.StepTitle)
        }
        # 给安装窗口一条人能读懂的原因；完整输出仍然写进 setup.log。
        Write-Output ("PIFLOW_ERROR=" + (($message -replace '\r?\n', ' ').Trim()))
        Write-Host "ERROR: $message" -ForegroundColor Red
        Write-SetupResult -Error $message
        exit 1
    }
    finally {
        if (Test-Path -LiteralPath $setup.WorkDir) {
            Remove-Item -LiteralPath $setup.WorkDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# 加载卡片：在脚本作用域 dot-source，卡片里定义的函数才能在引擎执行时调用。
# 卡片文件按文件名排序，最后一个表达式输出卡片哈希表。
$script:SetupCards = @()
$script:CardDir = Join-Path $script:ScriptRoot 'setup\cards'
if (-not (Test-Path -LiteralPath $script:CardDir)) { throw "找不到安装卡片目录：$($script:CardDir)" }
foreach ($script:CardFile in (Get-ChildItem -LiteralPath $script:CardDir -Filter '*.ps1' -File | Sort-Object Name)) {
    $card = . $script:CardFile.FullName
    if (-not $card -or -not $card.Id -or -not $card.Title) {
        throw "安装卡片缺少 Id 或 Title：$($script:CardFile.Name)"
    }
    if (-not $card.Invoke -and -not $card.InvokeStatic -and -not $card.InvokeDynamic) {
        throw "安装卡片没有实现：$($script:CardFile.Name)"
    }
    $script:SetupCards += $card
}

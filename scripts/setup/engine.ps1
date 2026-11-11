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
    $packagesFile = if ($Options.PackagesFile) { Resolve-FullPath $Options.PackagesFile } else { Join-Path $script:ScriptRoot '..\shard\py_packages.json' }
    $bundleDir = if ($Options.BundleDir) { Resolve-FullPath $Options.BundleDir } else { Join-Path $script:ScriptRoot '..\resources\bundles' }
    $blenderArchive = if ($Options.BlenderArchive) { Resolve-FullPath $Options.BlenderArchive } else { Join-Path $script:ScriptRoot '..\resources\blender\blender-4.5.0-trace-win64.zip' }
    $resultPath = if ($Options.ResultPath) { Resolve-FullPath $Options.ResultPath } else { '' }

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
        PackagesFile         = $packagesFile
        BundleDir            = $bundleDir
        BlenderArchive       = $blenderArchive
        ResultPath           = $resultPath

        VenvDir              = Join-Path $runtimeDir 'venv'
        BlenderSrcRoot       = $blenderSrcRoot
        BlenderSrcDir        = $blenderSrcDir
        CovtraceRoot         = Join-Path $blenderSrcDir 'covtrace-kit\CovTrace'
        BlenderSrcBlender    = Join-Path $blenderSrcRoot 'blender'
        BlenderSrcBlenderExe = Join-Path $blenderSrcRoot 'blender\blender.exe'
        CovtraceLlvmBin       = Join-Path $blenderSrcRoot 'llvm-mini\bin'

        WorkDir              = Join-Path $env:TEMP ("piflow-setup-" + $PID)
        DownloadDir          = Join-Path $runtimeDir 'downloads'
        BinDir               = Get-AgentBinDir

        Packages             = $DefaultPackages
        SkipBlender          = [bool]$Options.SkipBlender
        SkipPython           = [bool]$Options.SkipPython
        SkipNode             = [bool]$Options.SkipNode
        SkipPi               = [bool]$Options.SkipPi
        SkipGit              = [bool]$Options.SkipGit
        SkipTools            = [bool]$Options.SkipTools
        AutoUpgradeNode      = [bool]$Options.AutoUpgradeNode
        UpdatePi             = [bool]$Options.UpdatePi
        CheckOnly            = [bool]$Options.CheckOnly

        PreferCn             = $false
        PreferOfficialPip    = $false
        PythonSourceUrls     = $null

        StepTitles           = @()
        StepTotal            = 0
        StepIndex            = 0
        StepTitle            = ''

        Pi                   = $null
        GitBash              = $null
        VenvPython           = $null
        BlenderExe           = $null

        # 卸载清理依据：只回收本次安装真正创建的东西。
        Managed              = @{
            PythonInstalled = $false
            PythonMethod    = ''
            PythonInstaller = ''
            PiInstalled     = $false
            NodeInstalled   = $false
            GitMethod       = ''
            Tools           = @{}
        }
    }
    $setup.VenvPy = Join-Path $setup.VenvDir 'Scripts\python.exe'

    $script:Setup = $setup

    # 包版本与 scripts/fetch-bundles.mjs 共用同一份清单，避免两处漂移。
    if (Test-Path -LiteralPath $packagesFile) {
        try {
            $rawPackages = [System.IO.File]::ReadAllText($packagesFile, [System.Text.Encoding]::UTF8)
            $packageConfig = $rawPackages.TrimStart([char]0xFEFF) | ConvertFrom-Json
            if ($packageConfig.packages) { $setup.Packages = @($packageConfig.packages) }
        }
        catch {
            Write-WarnLine "读取包版本清单失败，使用内置默认值：$($_.Exception.Message)"
        }
    }

    Ensure-Directory $setup.WorkDir
    foreach ($dir in @($setup.BlenderSrcBlender, $setup.CovtraceLlvmBin, $setup.CovtraceRoot)) {
        Ensure-Directory $dir
    }
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

function Write-SetupResult {
    param([string]$Error = '')
    $setup = $script:Setup
    if ($Error) {
        Write-SetupData ([ordered]@{ ok = $false; error = $Error })
        return
    }

    $nodeVersion = Get-NodeVersion
    $pi = if ($setup.Pi) { $setup.Pi } else { Get-PiCommand }
    Write-SetupData ([ordered]@{
        ok           = $true
        checkOnly    = $false
        node         = if ($nodeVersion) { $nodeVersion.ToString() } else { $null }
        nodeExe      = Get-NodeExe
        pi           = if ($pi) { $pi.Path } else { $null }
        piVersion    = if ($pi) { $pi.Version } else { $null }
        piCli        = Get-PiCliPath
        gitBash      = $setup.GitBash
        venvPython   = $setup.VenvPython
        venvReady    = [bool]$setup.VenvPython
        blenderExe   = $setup.BlenderExe
        blenderReady = [bool]$setup.BlenderExe
        workspace    = $setup.WorkspaceDir
        config       = $setup.ConfigPath
        configExists = (Test-Path -LiteralPath $setup.ConfigPath)
        managed      = [ordered]@{
            installRoot     = $setup.InstallRoot
            agentBinDir     = $setup.BinDir
            pythonInstalled = [bool]$setup.Managed.PythonInstalled
            pythonMethod    = $setup.Managed.PythonMethod
            pythonInstaller = $setup.Managed.PythonInstaller
            piInstalled     = [bool]$setup.Managed.PiInstalled
            nodeInstalled   = [bool]$setup.Managed.NodeInstalled
            gitMethod       = $setup.Managed.GitMethod
            tools           = $setup.Managed.Tools
        }
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
    $py = if (-not $setup.SkipPython) { Find-Python } else { $null }
    $tools = [ordered]@{
        fd = if (-not $setup.SkipTools) { Test-ToolReady 'fd' } else { $null }
        rg = if (-not $setup.SkipTools) { Test-ToolReady 'rg' } else { $null }
    }
    $blenderExe = Get-BlenderExe

    Write-SetupData ([ordered]@{
        ok            = $true
        checkOnly     = $true
        node          = if ($node) { $node.ToString() } else { $null }
        nodeExe       = Get-NodeExe
        pi            = if ($pi) { $pi.Path } else { $null }
        piVersion     = if ($pi) { $pi.Version } else { $null }
        piCli         = Get-PiCliPath
        gitBash       = $gitBash
        python        = if ($py) { (($py.Cmd) -join ' ') } else { $null }
        pythonVersion = if ($py) { $py.Version.ToString() } else { $null }
        venvPython    = $setup.VenvPy
        venvReady     = (Test-Path -LiteralPath $setup.VenvPy)
        blenderExe    = $blenderExe
        blenderReady  = [bool]$blenderExe
        workspace     = $setup.WorkspaceDir
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
        Install-CleanupScript
        Write-SetupResult
        exit 0
    }
    catch {
        $message = $_.Exception.Message
        if ($setup.StepIndex -gt 0) {
            Write-Output ("PIFLOW_STEP=" + $setup.StepIndex + "/" + $setup.StepTotal + "|failed|" + $setup.StepTitle)
        }
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

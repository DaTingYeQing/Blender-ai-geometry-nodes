# Pi Flow runtime setup (Windows)
#
# 入口只负责参数和加载引擎；安装逻辑按类别拆在 scripts/setup/cards/。
#   scripts/setup/common.ps1       公共能力（超时进程、下载、探测、内置资源定位）
#   scripts/setup/engine.ps1       校验资源、选择静态/动态卡片、步骤协议、结果输出
#   scripts/setup/cards/*.ps1      每张卡负责一类安装
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-runtime.ps1 -CheckOnly
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-runtime.ps1 -InstallRoot C:\path
#
#Requires -Version 5.1

param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'PiFlow'),
    [string]$RuntimeDir = '',
    [string]$WorkspaceDir = '',
    [string]$ConfigPath = '',
    [string]$EnvTemplate = '',
    [string]$PackagesFile = '',
    [string]$ResultPath = '',
    [string]$BundleDir = '',
    [string]$BlenderArchive = '',
    [switch]$SkipBlender,
    [switch]$SkipPython,
    [switch]$SkipNode,
    [switch]$SkipPi,
    [switch]$SkipGit,
    [switch]$SkipTools,
    [switch]$AutoUpgradeNode,
    [switch]$UpdatePi,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Electron 通过管道读取日志，统一成 UTF-8，避免中文在安装窗口里乱码。
try {
    chcp 65001 > $null
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
}
catch {
    # 个别宿主不允许改编码，不影响安装。
}

$script:ScriptRoot = $PSScriptRoot
. (Join-Path $PSScriptRoot 'setup\common.ps1')
. (Join-Path $PSScriptRoot 'setup\engine.ps1')

Start-SetupEngine -Options @{
    InstallRoot     = $InstallRoot
    RuntimeDir      = $RuntimeDir
    WorkspaceDir    = $WorkspaceDir
    ConfigPath      = $ConfigPath
    EnvTemplate     = $EnvTemplate
    PackagesFile    = $PackagesFile
    ResultPath      = $ResultPath
    BundleDir       = $BundleDir
    BlenderArchive  = $BlenderArchive
    SkipBlender     = [bool]$SkipBlender
    SkipPython      = [bool]$SkipPython
    SkipNode        = [bool]$SkipNode
    SkipPi          = [bool]$SkipPi
    SkipGit         = [bool]$SkipGit
    SkipTools       = [bool]$SkipTools
    AutoUpgradeNode = [bool]$AutoUpgradeNode
    UpdatePi        = [bool]$UpdatePi
    CheckOnly       = [bool]$CheckOnly
}

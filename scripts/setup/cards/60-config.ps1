# 写入地址簿：把 venv、Blender 和工作区路径落到 py_environment.json。

function Set-JsonProp($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Write-EnvConfig([string]$VenvPythonPath, [string]$BlenderPath) {
    $setup = $script:Setup
    Ensure-Directory (Split-Path -Parent $setup.ConfigPath)
    if (Test-Path -LiteralPath $setup.EnvTemplate) {
        # Windows PowerShell 5.1 的默认编码是 ANSI，直接 Get-Content 会把 UTF-8 中文注释读成乱码并导致 JSON 解析失败。
        $raw = [System.IO.File]::ReadAllText($setup.EnvTemplate, [System.Text.Encoding]::UTF8)
        $cfg = $raw.TrimStart([char]0xFEFF) | ConvertFrom-Json
    }
    else {
        Write-WarnLine "没有找到地址簿模板：$($setup.EnvTemplate)，生成最小配置"
        $cfg = [pscustomobject]@{}
    }

    foreach ($name in @('python', 'blender', 'workspace')) {
        if (-not $cfg.PSObject.Properties[$name]) {
            $cfg | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{})
        }
    }
    if ($VenvPythonPath) {
        if (-not (Test-Path -LiteralPath $VenvPythonPath)) {
            throw "venv python 路径无效：$VenvPythonPath"
        }
        Set-JsonProp $cfg.python 'exe' $VenvPythonPath
    }
    if ($BlenderPath) {
        if (-not (Test-Path -LiteralPath $BlenderPath)) {
            throw "Blender 路径无效：$BlenderPath"
        }
        Set-JsonProp $cfg.blender 'exe' $BlenderPath
    }
    Set-JsonProp $cfg.workspace 'root' $setup.WorkspaceDir

    $json = ($cfg | ConvertTo-Json -Depth 10) + "`r`n"
    [System.IO.File]::WriteAllText($setup.ConfigPath, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Ok "地址簿已写入 $($setup.ConfigPath)"
}

function Invoke-ConfigCard {
    $setup = $script:Setup
    Ensure-Directory $setup.WorkspaceDir
    if ($setup.VenvPython) {
        Write-EnvConfig $setup.VenvPython $setup.BlenderExe
    }
    else {
        Write-WarnLine "没有 venv，跳过地址簿写入"
    }
    return $true
}

@{
    Id     = 'config'
    Title  = '写入配置'
    Invoke = 'Invoke-ConfigCard'
}

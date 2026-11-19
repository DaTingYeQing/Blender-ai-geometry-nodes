# 写入地址簿：把 Blender 内置 python、Blender 和工作区路径落到 py_environment.json。
# 更新策略是字段级三方合并：上次生成的值记在 config\.pi-flow-generated.json；
# 当前值 == 上次生成值 → 没人改过，用新值覆盖；否则保留用户改过的值。

function Set-JsonProp($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties[$Name]) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Read-JsonFile([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        return ($raw.TrimStart([char]0xFEFF) | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function Get-FieldValue($Object, [string]$Path) {
    $node = $Object
    foreach ($part in $Path.Split('.')) {
        if ($null -eq $node) { return $null }
        $prop = $node.PSObject.Properties[$part]
        if (-not $prop) { return $null }
        $node = $prop.Value
    }
    return $node
}

function Set-FieldValue($Object, [string]$Path, $Value) {
    $parts = $Path.Split('.')
    $node = $Object
    for ($i = 0; $i -lt $parts.Length - 1; $i++) {
        $part = $parts[$i]
        if (-not $node.PSObject.Properties[$part]) {
            $node | Add-Member -NotePropertyName $part -NotePropertyValue ([pscustomobject]@{})
        }
        $node = $node.$part
    }
    Set-JsonProp $node $parts[-1] $Value
}

# 模板里新增的键补进现有配置；已有的键（包括用户加的）原样保留。
function Copy-MissingTemplateKeys($Target, $Template) {
    foreach ($prop in $Template.PSObject.Properties) {
        $existing = $Target.PSObject.Properties[$prop.Name]
        if (-not $existing) {
            $Target | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
            continue
        }
        if ($prop.Value -is [pscustomobject] -and $existing.Value -is [pscustomobject]) {
            Copy-MissingTemplateKeys $existing.Value $prop.Value
        }
    }
}

function Write-EnvConfig([string]$PythonPath, [string]$BlenderPath) {
    $setup = $script:Setup
    Ensure-Directory (Split-Path -Parent $setup.ConfigPath)

    if ($PythonPath -and -not (Test-Path -LiteralPath $PythonPath)) {
        throw "python 路径无效：$PythonPath"
    }
    if ($BlenderPath -and -not (Test-Path -LiteralPath $BlenderPath)) {
        throw "Blender 路径无效：$BlenderPath"
    }

    $template = Read-JsonFile $setup.EnvTemplate
    if (-not $template) {
        Write-WarnLine "没有找到地址簿模板：$($setup.EnvTemplate)，生成最小配置"
        $template = [pscustomobject]@{}
    }

    # 从现有配置起步：用户加的字段、不认识的段都保留，只补模板新增的键。
    $cfg = Read-JsonFile $setup.ConfigPath
    $hadConfig = $null -ne $cfg
    if (-not $hadConfig) {
        $cfg = ($template | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
    }
    else {
        Copy-MissingTemplateKeys $cfg $template
    }
    foreach ($name in @('python', 'blender', 'workspace')) {
        if (-not $cfg.PSObject.Properties[$name]) {
            $cfg | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{})
        }
    }

    $baselinePath = Join-Path (Split-Path -Parent $setup.ConfigPath) '.pi-flow-generated.json'
    $baseline = Read-JsonFile $baselinePath
    $baseFields = @{}
    if ($baseline -and $baseline.PSObject.Properties['fields'] -and $baseline.fields) {
        foreach ($prop in $baseline.fields.PSObject.Properties) {
            $baseFields[$prop.Name] = [string]$prop.Value
        }
    }
    $nextFields = @{}

    # python.exe / blender.exe 是系统生成字段：没有历史基线时按新值重写；
    # workspace.root 可能被用户改过，没有基线时保留现状。
    $fields = @(
        @{ Path = 'python.exe'; Value = [string]$PythonPath; TrustNew = $true },
        @{ Path = 'blender.exe'; Value = [string]$BlenderPath; TrustNew = $true },
        @{ Path = 'workspace.root'; Value = [string]$setup.WorkspaceDir; TrustNew = $false }
    )
    foreach ($field in $fields) {
        $path = [string]$field.Path
        $value = [string]$field.Value
        if (-not $value) { continue }
        $current = Get-FieldValue $cfg $path
        $currentText = if ($null -eq $current) { '' } else { [string]$current }
        $base = $baseFields[$path]

        if (-not $currentText) {
            Set-FieldValue $cfg $path $value
            $nextFields[$path] = $value
        }
        elseif ($base -and $currentText -eq $base) {
            Set-FieldValue $cfg $path $value
            $nextFields[$path] = $value
        }
        elseif ($currentText -eq $value) {
            $nextFields[$path] = $value
        }
        elseif (-not $base -and ($field.TrustNew -or -not $hadConfig)) {
            # 首次生成时模板里的默认值不算用户改动；只有已有配置且无基线才保留。
            Set-FieldValue $cfg $path $value
            $nextFields[$path] = $value
        }
        elseif ($base) {
            # 用户改过：保留当前值，基线继续记旧值，下次仍能识别"改过"。
            $nextFields[$path] = $base
        }
    }

    # 版本号不是用户可改项，总是跟随本版。
    if ($setup.ConfigVersion) {
        Set-FieldValue $cfg 'configVersion' $setup.ConfigVersion
        $nextFields['configVersion'] = $setup.ConfigVersion
    }
    # 环境版本是模板常量，跟随模板，避免升级后还标着旧 Python/Blender 版本。
    foreach ($path in @('python.version', 'blender.version')) {
        $value = Get-FieldValue $template $path
        if ($value) { Set-FieldValue $cfg $path ([string]$value) }
    }

    $json = ($cfg | ConvertTo-Json -Depth 10) + "`r`n"
    [System.IO.File]::WriteAllText($setup.ConfigPath, $json, [System.Text.UTF8Encoding]::new($false))

    try {
        $baseJson = ([ordered]@{ fields = $nextFields } | ConvertTo-Json -Depth 5) + "`r`n"
        $tmp = "$baselinePath.tmp"
        [System.IO.File]::WriteAllText($tmp, $baseJson, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $tmp -Destination $baselinePath -Force
    }
    catch {
        Write-WarnLine "配置基线写不进去：$($_.Exception.Message)"
    }
    Write-Ok "地址簿已写入 $($setup.ConfigPath)"
}

function Invoke-ConfigCard {
    $setup = $script:Setup
    Ensure-Directory $setup.WorkspaceDir
    # 单环境方案：不再单独装 Python，外层胶水脚本直接用 Blender 内置的 python。
    $pythonExe = Get-BlenderPythonExe $setup.BlenderExe
    if (-not $pythonExe) {
        Write-WarnLine "Blender 目录里没找到 4.5\python\bin\python.exe，地址簿只写 blender 路径"
    }
    Write-EnvConfig $pythonExe $setup.BlenderExe
    return $true
}

@{
    Id     = 'config'
    Title  = '写入配置'
    Invoke = 'Invoke-ConfigCard'
}

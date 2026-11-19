# 网络探测：决定后续卡片优先使用官方源还是国内镜像。

function Invoke-NetworkCard {
    if (Test-GithubReachable) {
        $script:Setup.PreferCn = $false
        Write-Ok "可以访问 GitHub，使用官方源"
    }
    else {
        $script:Setup.PreferCn = $true
        Write-Ok "访问 GitHub 失败，改用国内镜像"
    }
    return $true
}

@{
    Id     = 'network'
    Title  = '检查网络'
    Invoke = 'Invoke-NetworkCard'
}

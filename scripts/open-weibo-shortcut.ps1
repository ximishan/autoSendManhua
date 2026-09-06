param(
    [Parameter(Mandatory = $true)]
    [string]$ShortcutPath
)

$ErrorActionPreference = "Stop"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
if (-not $shortcut.TargetPath -or -not (Test-Path -LiteralPath $shortcut.TargetPath)) {
    throw "The shortcut target does not exist."
}

$arguments = $shortcut.Arguments
if ($arguments) {
    $arguments = "$arguments --new-window https://weibo.com"
} else {
    $arguments = "--new-window https://weibo.com"
}

$workingDirectory = $shortcut.WorkingDirectory
if (-not $workingDirectory -or -not (Test-Path -LiteralPath $workingDirectory)) {
    $workingDirectory = Split-Path -Parent $shortcut.TargetPath
}

Start-Process -FilePath $shortcut.TargetPath -ArgumentList $arguments -WorkingDirectory $workingDirectory

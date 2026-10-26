param([string]$Python='python')
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$venv=Join-Path $root '.audit-venvs/phase5'
if (-not (Test-Path (Join-Path $venv 'Scripts/python.exe'))) {
    & $Python -m venv $venv
    if ($LASTEXITCODE -ne 0) {throw 'venv failed'}
}
$py=Join-Path $venv 'Scripts/python.exe'
& $py -m pip install -r (Join-Path $root 'requirements-lock.txt')
if ($LASTEXITCODE -ne 0) {throw 'Dependency installation failed'}
& $py -m pip install --no-deps --no-build-isolation -e (Join-Path $root 'packages/autoresearch') -e $root
if ($LASTEXITCODE -ne 0) {throw 'Project installation failed'}
Write-Output "Ready: $py"

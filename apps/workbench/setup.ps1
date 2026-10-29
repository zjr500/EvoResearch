param([string]$Python='python',[string]$Node='node',[string]$Pnpm='pnpm')
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $root
try {
    & './scripts/setup.ps1' -Python $Python
    if ($LASTEXITCODE -ne 0) { throw 'Backend installation failed' }
    $py=Join-Path $root '.audit-venvs/phase5/Scripts/python.exe'
    & $py -m pip install psutil==7.2.2 pypdf==6.12.0
    if ($LASTEXITCODE -ne 0) { throw 'Process dependency installation failed' }
    New-Item -ItemType Directory -Force '.audit-runtime/dsh-workbench' | Out-Null
    & $Pnpm --dir '.audit-runtime/dsh-workbench' add '@deepseek-ai/dsh@0.2.1-rc.3' --ignore-scripts --store-dir '../../.audit-cache/pnpm'
    if ($LASTEXITCODE -ne 0) { throw 'DSH installation failed' }
    # pnpm may report ignored optional native builds; the subsequent profile check is authoritative.
    $env:DSH_HOME=Join-Path $root '.audit-data/dsh-workbench'
    $cli=Join-Path $root '.audit-runtime/dsh-workbench/node_modules/@deepseek-ai/dsh/lib/bin.js'
    & $Node $cli web --dump-config | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'DSH profile preparation failed' }
    & $Pnpm --dir '.audit-data/dsh-workbench/profiles/web' add 'file:../../../../plugins/dsh' --ignore-scripts --store-dir '../../../../.audit-cache/pnpm'
    if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed' }
    Copy-Item -LiteralPath (Join-Path $root 'plugins/dsh/cordis.patch.yml') -Destination (Join-Path $env:DSH_HOME 'profiles/web/cordis.patch.yml')
    & $py (Join-Path $PSScriptRoot 'manage.py') init
    Write-Output 'Edit .audit-data/workbench-local/config.json before starting. Node must be >=24.9.'
} finally { Pop-Location }

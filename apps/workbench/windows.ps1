param([ValidateSet('Install','Start','Stop','Check','Configure')][string]$Action='Start',[switch]$NoOpen)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $root
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
function Run([string]$Exe,[string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Exe" }
}
function FindPython {
    $ErrorActionPreference='Continue'
    $candidates=@((Join-Path $root '.audit-venvs/phase5/Scripts/python.exe'),(Join-Path $env:LOCALAPPDATA 'Programs/Python/Python312/python.exe'),'python')
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $found=& py -3.12 -c 'import sys; print(sys.executable)' 2>$null
        if ($LASTEXITCODE -eq 0) {$candidates=@($found)+$candidates}
    }
    foreach ($candidate in $candidates) {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) {
            $version=& $candidate -c 'import sys; print(sys.version_info[:2] == (3, 12))' 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -eq 'True') {return $candidate}
        }
    }
    return $null
}
try {
    $py=Join-Path $root '.audit-venvs/phase5/Scripts/python.exe'
    if ($Action -eq 'Install') {
        $python=FindPython
        if (-not $python) {
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {throw 'Install Python 3.12 and Windows App Installer, then run Install.cmd again.'}
            Run 'winget' @('install','--id','Python.Python.3.12','--exact','--source','winget','--accept-source-agreements','--accept-package-agreements')
            $python=FindPython
            if (-not $python) {throw 'Python installation needs a new session. Close this window and run Install.cmd again.'}
        }
        # Portable official Node runtime: no global PATH changes or administrator needed.
        if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {throw 'This installer currently supports Windows x64 only.'}
        $nodeDir=Join-Path $root '.audit-runtime/node-v24.22.1-win-x64'
        $node=Join-Path $nodeDir 'node.exe'
        if (-not (Test-Path -LiteralPath $node)) {
            $cache=Join-Path $root '.audit-cache/install';New-Item -ItemType Directory -Force $cache | Out-Null
            $name='node-v24.22.1-win-x64.zip';$archive=Join-Path $cache $name
            Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v24.22.1/$name" -OutFile $archive
            $sums=(Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/v24.22.1/SHASUMS256.txt').Content
            $line=($sums -split "`n" | Where-Object {$_ -match ('\s'+[regex]::Escape($name)+'\s*$')})
            if (-not $line) {throw 'Official Node SHA256 entry missing'}
            $expected=($line.Trim() -split '\s+')[0]
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {throw 'Node checksum mismatch'}
            Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $root '.audit-runtime') -Force
        }
        $env:PATH=$nodeDir+';'+$env:PATH
        $pnpmDir=Join-Path $root '.audit-runtime/package-manager'
        Run (Join-Path $nodeDir 'npm.cmd') @('install','--prefix',$pnpmDir,'pnpm@11.0.0','--ignore-scripts','--no-audit','--no-fund')
        $pnpm=Join-Path $pnpmDir 'node_modules/.bin/pnpm.cmd'
        & (Join-Path $PSScriptRoot 'setup.ps1') -Python $python -Node $node -Pnpm $pnpm
        Run $py @((Join-Path $PSScriptRoot 'desktop.py'),'configure','--node',$node)
        # Windows-native services; Neo4j is an independently configured dependency.
        $startArgs=@((Join-Path $PSScriptRoot 'desktop.py'),'start')
        if ($NoOpen) {$startArgs+='--no-open'}
        Run $py $startArgs
    } else {
        if (-not (Test-Path -LiteralPath $py)) {throw 'Run Install.cmd first.'}
        $arguments=@((Join-Path $PSScriptRoot 'desktop.py'),$Action.ToLower())
        if ($NoOpen -and $Action -eq 'Start') {$arguments+='--no-open'}
        Run $py $arguments
    }
} catch {
    Write-Host ('FAILED: '+$_.Exception.Message) -ForegroundColor Red
    Write-Host 'See docs/windows-deployment.md and .audit-data/workbench-local/*.log'
    exit 1
}

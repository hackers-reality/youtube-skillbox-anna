param(
  [int]$Port = 5181,
  [string]$NexusRoot = 'E:\anna-nexus-local'
)
$ErrorActionPreference = 'Stop'
$plugin = Join-Path $PSScriptRoot 'executas\youtube-skillbox'
if ($plugin -match '\s') { throw 'This CLI splits command arguments on whitespace; use a repository path without spaces.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port already has a listener. Stop only the verified stale Anna harness before restarting."
}
& uv sync --project $NexusRoot --locked
if ($LASTEXITCODE -ne 0) { throw 'Anna bridge dependency sync failed.' }
# The bridge has its own environment; never run the plugin in the bridge's
# Python environment, which does not include yt-dlp. uv selects the plugin env.
if (-not (Test-Path (Join-Path $plugin 'uv.lock'))) {
  & uv lock --project $plugin
  if ($LASTEXITCODE -ne 0) { throw 'Plugin lockfile generation failed.' }
}
& uv sync --project $plugin --locked
if ($LASTEXITCODE -ne 0) { throw 'Plugin dependency sync failed.' }
& uv run --project $plugin --locked python -c 'import sys, yt_dlp; print(sys.executable); print(yt_dlp.version.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'Plugin dependency preflight failed.' }
$command = "uv run --project $plugin --locked python -u youtube_skillbox_plugin.py"
$spec = "dir=$plugin,tool_id=tool-dev-youtube-skillbox,type=python,command=$command"
& anna-app dev --cwd $PSScriptRoot --matrix-nexus-root $NexusRoot --port $Port --storage aps --llm-app-slug fresh-youtube-skillbox-anna --no-watch --executa $spec
exit $LASTEXITCODE

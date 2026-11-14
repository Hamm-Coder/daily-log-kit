<#
daily-log-kit v1.3.3 — 一括導入（install-all.ps1）と反映（publish-kit.ps1）の通しテスト

・GitHub の代わりに一時フォルダの bare リポジトリを使う。本物の GitHub やあなたのリポジトリには触れない
・CI（.github/workflows/kit-ci.yml）が Windows の Windows PowerShell 5.1 と PowerShell 7 で実行する
・PCで試すとき（キットのフォルダで）: powershell -NoProfile -ExecutionPolicy Bypass -File tests\e2e.ps1
#>
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$KitSrc = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Ps = (Get-Process -Id $PID).Path   # 今動いている PowerShell（5.1 なら 5.1）で子のスクリプトも動かす
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ('dlk-e2e-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$env:GIT_AUTHOR_NAME = 'e2e'; $env:GIT_AUTHOR_EMAIL = 'e2e@example.com'
$env:GIT_COMMITTER_NAME = 'e2e'; $env:GIT_COMMITTER_EMAIL = 'e2e@example.com'
$script:Failed = 0

function Check([bool]$Cond, [string]$Name) {
  if ($Cond) { Write-Host "  OK  $Name" -ForegroundColor Green } else { Write-Host "  NG  $Name" -ForegroundColor Red; $script:Failed++ }
}
function G([string]$Dir) { $a = $args; $o = & git -C $Dir @a 2>&1; return (($o | Out-String).Trim()) }
function Run-Ps([string]$File, [string[]]$ArgList) {
  $o = & $Ps -NoProfile -ExecutionPolicy Bypass -File $File @ArgList 2>&1 | Out-String
  return @{ Out = $o; Code = $LASTEXITCODE }
}
function Copy-Tree([string]$From, [string]$To) {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Get-ChildItem -LiteralPath $From -Force | Where-Object { $_.Name -ne '.git' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $To -Recurse -Force }
}

Write-Host "PowerShell $($PSVersionTable.PSVersion) / $Ps"
Write-Host "作業フォルダ: $Root"
New-Item -ItemType Directory -Path (Join-Path $Root 'remote') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Root 'repos') -Force | Out-Null

# --- 準備: ゲーム役のリポジトリ（未コミットの変更あり）と、キットのリポジトリ
$gameRemote = Join-Path $Root 'remote\game.git'
$game = Join-Path $Root 'repos\game'
& git init -q --bare -b main $gameRemote
& git clone -q $gameRemote $game 2>&1 | Out-Null
G $game switch -q -c main | Out-Null
Set-Content -Path (Join-Path $game 'a.txt') -Value 'a' -Encoding ASCII
G $game add . | Out-Null
G $game commit -q -m 'init' | Out-Null
G $game push -q -u origin main | Out-Null
& git --git-dir=$gameRemote symbolic-ref HEAD refs/heads/main
G $game remote set-head origin --auto | Out-Null
Add-Content -Path (Join-Path $game 'a.txt') -Value 'dirty'   # 作業中の変更（触られないこと）

$kitRemote = Join-Path $Root 'remote\daily-log-kit.git'
$kit = Join-Path $Root 'repos\daily-log-kit'
& git init -q --bare -b main $kitRemote
Copy-Tree $KitSrc $kit
G $kit init -q | Out-Null
G $kit switch -q -c main | Out-Null
G $kit add -A | Out-Null
G $kit commit -q -m 'kit' | Out-Null
G $kit remote add origin $kitRemote | Out-Null
G $kit push -q -u origin main | Out-Null
& git --git-dir=$kitRemote symbolic-ref HEAD refs/heads/main
$ver = ([regex]::Match((Get-Content (Join-Path $kit 'install.mjs') -Raw -Encoding UTF8), "KIT_VERSION = '([\d.]+)'")).Groups[1].Value
$branch = "chore/daily-log-v$ver"

Write-Host ''
Write-Host '== 1. install-all.ps1（確認のみ）'
$r = Run-Ps (Join-Path $kit 'install-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Backfill')
Check ($r.Code -eq 0) '終了コード 0'
Check ($r.Out -match '確認のみ') '結果に「確認のみ」'
Check ($r.Out -notmatch '=== daily-log-kit') 'キット自身は対象外'
Check (-not (G $game branch --list $branch)) '確認のみでブランチを残さない'

Write-Host ''
Write-Host '== 2. install-all.ps1（本番、PRなし）'
$r = Run-Ps (Join-Path $kit 'install-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'game', '-Backfill', '-Apply')
Check ($r.Code -eq 0) '終了コード 0'
Check ([bool](G $game branch --list $branch)) "ブランチ $branch にコミット"
Check ((G $game ls-tree -r --name-only $branch) -match 'tools/daily-log\.mjs') 'ツールが入っている'
Check ((G $game ls-tree -r --name-only $branch) -match 'docs/log/README\.md') '過去の日報が入っている'
Check ((G $game rev-parse --abbrev-ref HEAD) -eq 'main') '作業フォルダは main のまま'
Check ((G $game status --short) -match 'a\.txt') '未コミットの変更が残っている'
Check (-not (Test-Path (Join-Path $game 'tools'))) '作業フォルダにはファイルを置かない'
$r2 = Run-Ps (Join-Path $kit 'install-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'game', '-Apply')
Check ($r2.Out -match '既にあります') '同じ版のブランチがあれば飛ばす'

Write-Host ''
Write-Host '== 3. 分析ツール（Windows のパスで）'
$an = & node (Join-Path $kit 'files\tools\daily-log-analyze.mjs') $game 2>&1 | Out-String
Check ($LASTEXITCODE -eq 0) '終了コード 0'
Check ($an -match '## 概要') 'レポートが出る'

Write-Host ''
Write-Host '== 4. publish-kit.ps1（キットのフォルダに置いた zip をダブルクリック相当で反映）'
$parts = $ver.Split('.')
$next = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"
$stage = Join-Path $Root 'stage\daily-log-kit'
Copy-Tree $kit $stage
& node (Join-Path $stage 'bump-version.mjs') $next | Out-Null
# 変更履歴に次の版の行を足す（tests/kit.test.mjs が確認する）
$readmePath = Join-Path $stage 'README.md'
$readme = [System.IO.File]::ReadAllText($readmePath)
$readme = $readme -replace '(\| --- \| --- \| --- \|\r?\n)', ('$1' + "| $next | 2026-01-01 | 通しテスト用の版 |`n")
[System.IO.File]::WriteAllText($readmePath, $readme)
$zip = Join-Path $kit "daily-log-kit-v$next.zip"
# Compress-Archive は隠しファイル（Linux では .github などの「.」で始まるもの）を外すので、.NET で zip を作る
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { Remove-Item -Force $zip }
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$r = Run-Ps (Join-Path $kit 'publish-kit.ps1') @('-Yes')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0) '終了コード 0'
Check ([bool](& git --git-dir=$kitRemote tag --list "v$next")) "GitHub 役にタグ v$next"
Check (-not ((G $kit ls-files) -match '\.zip')) 'zip はコミットされない'
Check ((G $kit status --porcelain --untracked-files=no) -eq '') 'キットのフォルダに未コミットの変更がない'
$r = Run-Ps (Join-Path $kit 'publish-kit.ps1') @('-Yes')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -ne 0 -and $r.Out -match '新しくありません') '同じ版は反映しない'

Write-Host ''
if (-not $env:E2E_KEEP) { Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue }
if ($script:Failed -gt 0) { Write-Host "失敗 $($script:Failed) 件" -ForegroundColor Red; exit 1 }
Write-Host 'すべて成功' -ForegroundColor Green
exit 0

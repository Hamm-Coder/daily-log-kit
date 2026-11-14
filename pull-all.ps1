<#
daily-log-kit v1.5.0 — 日報の仕組みを入れたリポジトリを、まとめて git pull する

対象
- -Root（既定 C:\AllGitRepository）直下の Git リポジトリのうち、日報の仕組みが入っているもの（tools/daily-log.mjs がある）と、キット自身
- 日報の仕組みが入っていないリポジトリは対象外（一覧に「対象外」と出るだけで、何もしない）
- -Repos で名前を指定すると、そのリポジトリだけ（日報の仕組みの有無は見ない）
- -Exclude で名前を指定すると、そのリポジトリを外す

安全のための仕組み
- git pull --ff-only を使う。手元と GitHub の履歴が分かれているリポジトリは、統合せずに「失敗」と表示して次へ進む
- 取り込むのは「今チェックアウトしているブランチ」だけ。ブランチを切り替えない。未コミットの変更には触れない
  （取り込むファイルと未コミットの変更が重なるときは、git が止めるので「失敗」になる）

例
  .\pull-all.ps1                              # 日報の仕組みを入れたリポジトリとキット
  .\pull-all.ps1 -Exclude Unity_CharacterTest # 1つ外す
  .\pull-all.ps1 -Repos RPGMZ_prototype,automaticPromptsMaker
  .\pull-all.ps1 -All                         # 直下の Git リポジトリを全部
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\AllGitRepository',
  [string[]]$Repos,
  [string[]]$Exclude,
  [switch]$All,
  [switch]$NoKit
)

# Windows PowerShell 5.1 では git の進捗表示（stderr）がエラー扱いになるため Continue にし、終了コードで判定する
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error 'git が見つかりません'; exit 1 }
if (-not (Test-Path $Root)) { Write-Error "フォルダがありません: $Root"; exit 1 }
$kitFull = (Resolve-Path $Kit).Path.TrimEnd('\', '/')

# 日報の仕組みが入っているか（作業フォルダにツールがある、または GitHub 側の既定のブランチにある）
function Test-Managed([string]$Dir) {
  if (Test-Path (Join-Path $Dir 'tools\daily-log.mjs')) { return $true }
  & git -C $Dir cat-file -e 'origin/HEAD:tools/daily-log.mjs' 2>$null
  return ($LASTEXITCODE -eq 0)
}

$targets = @()
$skipped = @()
if ($Repos) {
  foreach ($n in $Repos) { $targets += (Join-Path $Root $n) }
} else {
  $dirs = @(Get-ChildItem $Root -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.git') })
  foreach ($d in $dirs) {
    $isKit = ($d.FullName.TrimEnd('\', '/') -eq $kitFull)
    if ($isKit) {
      if ($NoKit) { $skipped += $d.Name } else { $targets += $d.FullName }
    } elseif ($All -or (Test-Managed $d.FullName)) {
      $targets += $d.FullName
    } else {
      $skipped += $d.Name
    }
  }
}
if ($Exclude) {
  $kept = @()
  foreach ($t in $targets) {
    $n = Split-Path $t -Leaf
    if ($Exclude -contains $n) { $skipped += $n } else { $kept += $t }
  }
  $targets = $kept
}

Write-Host "git pull をまとめて実行します（$Root、対象 $($targets.Count) 件）"
$failed = 0
foreach ($repo in $targets) {
  $name = Split-Path $repo -Leaf
  if (-not (Test-Path (Join-Path $repo '.git'))) { Write-Host "  ${name}: 失敗（Git リポジトリではありません）"; $failed++; continue }
  $branch = (& git -C $repo rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
  if (-not $branch -or $branch -eq 'HEAD') { Write-Host "  ${name}: 飛ばしました（ブランチをチェックアウトしていません）"; continue }
  & git -C $repo rev-parse --abbrev-ref '@{u}' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "  ${name}: 飛ばしました（ブランチ $branch に GitHub 側の追跡先がありません）"; continue }
  $before = (& git -C $repo rev-parse HEAD 2>$null | Out-String).Trim()
  $out = (& git -C $repo pull --ff-only 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    $failed++
    Write-Host "  ${name}: 失敗（ブランチ $branch）" -ForegroundColor Red
    foreach ($line in ($out -split "`r?`n")) { if ($line.Trim()) { Write-Host "      $line" } }
    continue
  }
  $after = (& git -C $repo rev-parse HEAD 2>$null | Out-String).Trim()
  if ($before -eq $after) {
    Write-Host "  ${name}: 最新（ブランチ $branch）"
  } else {
    $count = (& git -C $repo rev-list --count "$before..$after" 2>$null | Out-String).Trim()
    Write-Host "  ${name}: 更新（ブランチ $branch、$count コミット）" -ForegroundColor Green
  }
}
if ($skipped.Count -gt 0) { Write-Host "対象外: $($skipped -join '、')" }
if ($failed -gt 0) {
  Write-Host "失敗 $failed 件。表示された内容を確認してください（未コミットの変更との重なり、履歴の分かれ、ネットワーク）" -ForegroundColor Red
  exit 1
}
exit 0

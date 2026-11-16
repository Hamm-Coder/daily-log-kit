<#
daily-log-kit v1.9.1 — 日報の仕組みを入れたリポジトリとキット本体を1画面で見るダッシュボード（HTML）を作って開く

対象（pull-all.ps1 と同じ選び方）
- -Root（既定 C:\AllGitRepository）直下の Git リポジトリのうち、日報の仕組みが入っているもの（tools/daily-log.mjs がある）と、キット本体
- -Repos で名前を指定すると、そのリポジトリだけ / -Exclude で外す / -All で直下の Git リポジトリを全部 / -NoKit でキット本体を外す

出力
- 既定はキットのフォルダの dashboard.html（.gitignore で除外。非公開のリポジトリの内容が入るのでコミットしない）
- 作ったらブラウザで開く。-NoOpen で開かない。-Out で保存先を変える
- 手元の状態から作る（GitHub には問い合わせない）。最新にするなら先に .\pull-all.ps1

例
  .\pull-all.ps1 -Yes; .\dashboard.ps1     # 取り込んでから作る
  .\dashboard.ps1 -Exclude Unity_CharacterTest
  .\dashboard.ps1 -Out C:\Temp\dashboard.html -NoOpen
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\AllGitRepository',
  [string[]]$Repos,
  [string[]]$Exclude,
  [switch]$All,
  [switch]$NoKit,
  [string]$Out,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $Kit 'dashboard.html' }

foreach ($cmd in @('git', 'node')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Error "$cmd が見つかりません"; exit 1 }
}
if (-not (Test-Path $Root)) { Write-Error "フォルダがありません: $Root"; exit 1 }
$kitFull = (Resolve-Path $Kit).Path.TrimEnd('\', '/')

# 日報の仕組みが入っているか（作業フォルダにツールがある、または GitHub 側の既定のブランチにある）
# 手元の origin/HEAD は clone したときのままなので、GitHub で既定のブランチを変えて古いブランチを消すと使えなくなる。そのときは main・master も見る
function Test-Managed([string]$Dir) {
  if (Test-Path (Join-Path $Dir 'tools\daily-log.mjs')) { return $true }
  foreach ($ref in @('origin/HEAD', 'origin/main', 'origin/master')) {
    & git -C $Dir cat-file -e "${ref}:tools/daily-log.mjs" 2>$null
    if ($LASTEXITCODE -eq 0) { return $true }
  }
  return $false
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
  # キットのフォルダが -Root の外にあっても入れる
  if (-not $NoKit -and -not ($targets | Where-Object { $_.TrimEnd('\', '/') -eq $kitFull })) { $targets += $kitFull }
}
if ($Exclude) {
  $kept = @()
  foreach ($t in $targets) {
    $n = Split-Path $t -Leaf
    if ($Exclude -contains $n) { $skipped += $n } else { $kept += $t }
  }
  $targets = $kept
}
$targets = @($targets | Where-Object { Test-Path (Join-Path $_ '.git') })
if ($targets.Count -eq 0) { Write-Host "対象のリポジトリがありません（$Root）"; exit 1 }

Write-Host "ダッシュボードを作ります（対象 $($targets.Count) 件）"
foreach ($t in $targets) { Write-Host "  $(Split-Path $t -Leaf)" }
if ($skipped.Count -gt 0) { Write-Host "対象外: $($skipped -join '、')" }

$nodeArgs = @((Join-Path $Kit 'dashboard.mjs'), '--out', $Out) + $targets
$o = & node @nodeArgs 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ } }
$code = $LASTEXITCODE
foreach ($line in $o) { if ($line -and $line.Trim()) { Write-Host "  $line" } }
if ($code -ne 0) { Write-Host 'ダッシュボードを作れませんでした。上の表示を確認してください' -ForegroundColor Red; exit 1 }
Write-Host "作成: $Out" -ForegroundColor Green
Write-Host '（非公開のリポジトリの内容が入っています。コミットや共有はしないでください）'
if (-not $NoOpen) { Start-Process $Out }
exit 0

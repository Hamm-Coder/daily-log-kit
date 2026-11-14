<#
daily-log-kit v1.3.3 — 複数のリポジトリへ日報の仕組みを一括で入れる

安全のための仕組み
- 既定は確認のみ（何も変えない）。-Apply を付けたときだけコミットする
- 各リポジトリの作業フォルダには触れない。一時的な worktree（別フォルダ）で作業し、終わったら消す
- LFS の素材（画像など）はダウンロードしない（GIT_LFS_SKIP_SMUDGE=1）
- main へ直接 push しない。ブランチ chore/daily-log-v<版> を作り、-CreatePR で PR にする
- 導入済みのリポジトリは、キットの版が新しいときだけ更新のPRになる（同じ版なら変更なし）

例
  # 1. 確認だけ（C:\AllGitRepository 直下の全リポジトリ）
  .\install-all.ps1
  # 2. 2つだけ、過去の日報も作ってPRまで
  .\install-all.ps1 -Repos RPGMZ_prototype -Backfill -Apply -CreatePR
  # 3. GitHub の自分のリポジトリで未クローンのものもクローンしてから全部
  .\install-all.ps1 -Owner Hamm-Coder -Backfill -Apply -CreatePR
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\AllGitRepository',
  [string[]]$Repos,
  [string]$Owner,
  [switch]$Backfill,
  [switch]$NoWorkflow,
  [switch]$NoAdr,
  [switch]$Apply,
  [switch]$CreatePR,
  [string]$Branch
)

# Windows PowerShell 5.1 では git の進捗表示（stderr）がエラー扱いになるため Continue にし、終了コードで判定する
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:GIT_LFS_SKIP_SMUDGE = '1'
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $Kit 'install.mjs'
$KitVersion = ([regex]::Match((Get-Content $Installer -Raw -Encoding UTF8), "KIT_VERSION = '([\d.]+)'")).Groups[1].Value
if (-not $Branch) { $Branch = "chore/daily-log-v$KitVersion" }
Write-Host "daily-log-kit v$KitVersion（ブランチ $Branch）"
# キットが GitHub のクローンなら、古いまま配らないよう確認する
if (Test-Path (Join-Path $Kit '.git')) {
  & git -C $Kit fetch --quiet origin 2>$null
  $behind = & git -C $Kit rev-list --count 'HEAD..@{u}' 2>$null
  if ($behind -and [int]$behind -gt 0) { Write-Warning "キットが GitHub より $behind コミット古いです。先に git -C `"$Kit`" pull してください"; exit 1 }
}

foreach ($cmd in @('git', 'node')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Error "$cmd が見つかりません"; exit 1 }
}
if ($CreatePR -and -not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Error 'PRを作るには GitHub CLI（gh）が必要です: winget install GitHub.cli → gh auth login'; exit 1 }

function Invoke-Git([string]$Dir, [string[]]$GitArgs) {
  $out = & git -C $Dir @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' '): $out" }
  return ($out | Out-String).Trim()
}

# 未クローンのリポジトリをクローン（-Owner 指定時）
if ($Owner) {
  $list = gh repo list $Owner --limit 300 --json name,isArchived --jq '.[] | select(.isArchived|not) | .name'
  foreach ($name in $list) {
    if ($Repos -and ($Repos -notcontains $name)) { continue }
    $dir = Join-Path $Root $name
    if (Test-Path $dir) { continue }
    if ($Apply) {
      Write-Host "クローン $Owner/$name"
      git clone "https://github.com/$Owner/$name.git" $dir
    } else { Write-Host "（確認のみ）クローン予定 $Owner/$name" }
  }
}

$targets = if ($Repos) { $Repos | ForEach-Object { Join-Path $Root $_ } } else {
  Get-ChildItem $Root -Directory | Where-Object { Test-Path (Join-Path $_.FullName '.git') } | ForEach-Object { $_.FullName }
}
# キット自身は対象にしない
$kitFull = (Resolve-Path $Kit).Path.TrimEnd('\', '/')
$targets = @($targets | Where-Object { (Resolve-Path $_ -ErrorAction SilentlyContinue).Path -ne $kitFull })

$results = @()
foreach ($repo in $targets) {
  $name = Split-Path $repo -Leaf
  $created = $false
  $pushed = $false
  $wt = Join-Path ([System.IO.Path]::GetTempPath()) ("daily-log-" + $name + "-" + [guid]::NewGuid().ToString('N').Substring(0, 6))
  try {
    if (-not (Test-Path (Join-Path $repo '.git'))) { throw 'Git リポジトリではありません' }
    Invoke-Git $repo @('fetch', 'origin', '--prune') | Out-Null
    if ((Invoke-Git $repo @('rev-parse', '--is-shallow-repository')) -eq 'true') { Invoke-Git $repo @('fetch', '--unshallow', 'origin') | Out-Null }
    $headRef = & git -C $repo symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null
    if (-not $headRef) { & git -C $repo remote set-head origin --auto 2>$null | Out-Null; $headRef = & git -C $repo symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null }
    if (-not $headRef) { $headRef = 'origin/main' }
    $baseName = $headRef -replace '^origin/', ''

    if (& git -C $repo ls-remote --heads origin $Branch) { throw "リモートに $Branch が既にあります（このバージョンのPRが未マージかもしれません）" }
    & git -C $repo branch --list $Branch | ForEach-Object { if ($_) { throw "ローカルに $Branch が既にあります。git branch -D $Branch で消してから再実行" } }

    Invoke-Git $repo @('worktree', 'add', '-b', $Branch, $wt, $headRef) | Out-Null
    $created = $true
    $nodeArgs = @($Installer, $wt)
    if ($Backfill) { $nodeArgs += '--backfill' }
    if ($NoWorkflow) { $nodeArgs += '--no-workflow' }
    if ($NoAdr) { $nodeArgs += '--no-adr' }
    if (-not $Apply) { $nodeArgs += '--dry-run' }
    $out = & node @nodeArgs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $out.Trim() }
    Write-Host "`n=== $name（基準 $headRef）"
    Write-Host $out.TrimEnd()

    if (-not $Apply) { $results += [pscustomobject]@{ Repo = $name; Result = '確認のみ' }; continue }
    Invoke-Git $wt @('add', '-A') | Out-Null
    & git -C $wt diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { $results += [pscustomobject]@{ Repo = $name; Result = '導入済み（変更なし）' }; continue }
    & git -C $repo cat-file -e "${headRef}:tools/daily-log.mjs" 2>$null
    $installed = ($LASTEXITCODE -eq 0)
    $verb = if ($installed) { '更新' } else { '導入' }
    $title = "chore: 日報の仕組みを${verb}（daily-log-kit v$KitVersion）"
    Invoke-Git $wt @('commit', '-m', $title) | Out-Null
    if ($CreatePR) {
      Invoke-Git $wt @('push', '-u', 'origin', $Branch) | Out-Null
      $pushed = $true
      $lead = if ($installed) { "daily-log-kit v$KitVersion に更新します。" } else { "daily-log-kit v$KitVersion を導入します。" }
      $body = "$lead`n`n- 仕様: docs/specs/daily-log.md`n- 過去の日報: $(if ($Backfill) { 'docs/log/ に生成済み' } else { '未生成（node tools/daily-log.mjs generate --all）' })`n- ADR: docs/decisions/ があるリポジトリでは「採用」で追加（このPRのマージで採用）`n- 確認: node --test tools/daily-log.test.mjs"
      Push-Location $wt
      try { $url = gh pr create --base $baseName --head $Branch --title $title --body $body }
      finally { Pop-Location }
      if ($LASTEXITCODE -ne 0) { throw "PRの作成に失敗（ブランチ $Branch は push 済み）" }
      $results += [pscustomobject]@{ Repo = $name; Result = "PR $url" }
    } else {
      $results += [pscustomobject]@{ Repo = $name; Result = "ローカルのブランチ $Branch にコミット（未push）" }
    }
  } catch {
    $results += [pscustomobject]@{ Repo = $name; Result = "スキップ: $($_.Exception.Message)" }
  } finally {
    if (Test-Path $wt) { & git -C $repo worktree remove --force $wt 2>$null | Out-Null }
    & git -C $repo worktree prune 2>$null | Out-Null
    # 確認のみのときと、GitHub に push 済みのときは、手元の作業用ブランチを消す（PRは GitHub 側に残る）
    if ($created -and (-not $Apply -or $pushed)) { & git -C $repo branch -D $Branch 2>$null | Out-Null }
  }
}

Write-Host "`n=== 結果"
$results | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
if (-not $Apply) { Write-Host '確認のみでした。内容がよければ -Apply（PRまで作るなら -CreatePR も）を付けて再実行してください。' }

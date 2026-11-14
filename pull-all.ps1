<#
daily-log-kit v1.5.1 — 日報の仕組みを入れたリポジトリを、まとめて git pull する

対象
- -Root（既定 C:\AllGitRepository）直下の Git リポジトリのうち、日報の仕組みが入っているもの（tools/daily-log.mjs がある）と、キット自身
- 日報の仕組みが入っていないリポジトリは対象外（一覧に「対象外」と出るだけで、何もしない）
- -Repos で名前を指定すると、そのリポジトリだけ（日報の仕組みの有無は見ない）
- -Exclude で名前を指定すると、そのリポジトリを外す

安全のための仕組み
- 早送りだけで取り込む（git fetch → git merge --ff-only）。手元と GitHub の履歴が分かれているリポジトリは、統合せずに「失敗」と表示して次へ進む
- 取り込むのは「今チェックアウトしているブランチ」だけ。ブランチを切り替えない。未コミットの変更には触れない
  （取り込むファイルと未コミットの変更が重なるときは、git が止めるので「失敗」になる）
- 取り込むファイルと同じ名前の未追跡ファイル（Unity が作る ProjectSettings/ProjectVersion.txt など）があると git は止まる。
  その場合は、GitHub 側と同じ内容なら置き換え、違う内容なら「<ファイル名>.local」に退避してから取り込む（消さない）。
  取り込みに失敗したら元に戻す。-NoMoveUntracked を付けると退避せずに「失敗」と表示する

例
  .\pull-all.ps1                              # 日報の仕組みを入れたリポジトリとキット
  .\pull-all.ps1 -Exclude Unity_CharacterTest # 1つ外す
  .\pull-all.ps1 -Repos RPGMZ_prototype,automaticPromptsMaker
  .\pull-all.ps1 -All                         # 直下の Git リポジトリを全部
  .\pull-all.ps1 -NoMoveUntracked             # 未追跡ファイルを退避しない
#>
[CmdletBinding()]
param(
  [string]$Root = 'C:\AllGitRepository',
  [string[]]$Repos,
  [string[]]$Exclude,
  [switch]$All,
  [switch]$NoKit,
  [switch]$NoMoveUntracked
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

# git を実行して、出力を文字列で返す（終了コードは $script:GitCode）。
# Windows PowerShell 5.1 では stderr の行が「発生場所…」付きのエラーとして表示されるので、本文だけにする
function Invoke-GitText([string]$Dir, [string[]]$GitArgs) {
  $lines = & git -C $Dir -c core.quotepath=false @GitArgs 2>&1 | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ }
  }
  $script:GitCode = $LASTEXITCODE
  return (($lines | Out-String).Trim())
}
function Write-Indented([string]$Text) {
  foreach ($line in ($Text -split "`r?`n")) { if ($line.Trim()) { Write-Host "      $line" } }
}

Write-Host "git pull をまとめて実行します（$Root、対象 $($targets.Count) 件）"
$failed = 0
foreach ($repo in $targets) {
  $name = Split-Path $repo -Leaf
  if (-not (Test-Path (Join-Path $repo '.git'))) { Write-Host "  ${name}: 失敗（Git リポジトリではありません）"; $failed++; continue }
  $branch = Invoke-GitText $repo @('rev-parse', '--abbrev-ref', 'HEAD')
  if ($script:GitCode -ne 0 -or -not $branch -or $branch -eq 'HEAD') { Write-Host "  ${name}: 飛ばしました（ブランチをチェックアウトしていません）"; continue }
  Invoke-GitText $repo @('rev-parse', '--abbrev-ref', '@{u}') | Out-Null
  if ($script:GitCode -ne 0) { Write-Host "  ${name}: 飛ばしました（ブランチ $branch に GitHub 側の追跡先がありません）"; continue }
  $before = Invoke-GitText $repo @('rev-parse', 'HEAD')
  $out = Invoke-GitText $repo @('fetch', '--quiet')
  if ($script:GitCode -ne 0) {
    $failed++
    Write-Host "  ${name}: 失敗（GitHub から取得できません。ブランチ $branch）" -ForegroundColor Red
    Write-Indented $out
    continue
  }

  # 取り込むファイルと同じ名前の未追跡ファイル（git はこれがあると取り込みを止める）
  $incoming = @((Invoke-GitText $repo @('diff', '--name-only', '--diff-filter=A', 'HEAD', '@{u}')) -split "`r?`n" | Where-Object { $_ })
  $untracked = @((Invoke-GitText $repo @('ls-files', '--others', '--exclude-standard')) -split "`r?`n" | Where-Object { $_ })
  $clash = @($incoming | Where-Object { $untracked -contains $_ })
  if ($clash.Count -gt 0 -and $NoMoveUntracked) {
    $failed++
    Write-Host "  ${name}: 失敗（取り込むファイルと同じ名前の未追跡ファイルがあります。ブランチ $branch）" -ForegroundColor Red
    foreach ($f in $clash) { Write-Host "      $f" }
    Write-Host '      別名に退避するか消してから再実行してください（-NoMoveUntracked を外すと自動で退避します）'
    continue
  }
  $moved = @()
  foreach ($f in $clash) {
    $local = Join-Path $repo $f
    $same = ((Invoke-GitText $repo @('hash-object', '--', $f)) -eq (Invoke-GitText $repo @('rev-parse', "@{u}:$f")))
    $backup = "$local.local"
    if (Test-Path -LiteralPath $backup) { $backup = "$local.local-" + (Get-Date -Format 'yyyyMMdd-HHmmss') }
    Move-Item -LiteralPath $local -Destination $backup
    $moved += [pscustomobject]@{ File = $f; Path = $local; Backup = $backup; Same = $same }
  }

  $out = Invoke-GitText $repo @('merge', '--ff-only', '--quiet', '@{u}')
  if ($script:GitCode -ne 0) {
    # 退避したファイルを元に戻す
    foreach ($m in $moved) { if (-not (Test-Path -LiteralPath $m.Path)) { Move-Item -LiteralPath $m.Backup -Destination $m.Path } }
    $failed++
    Write-Host "  ${name}: 失敗（ブランチ $branch）" -ForegroundColor Red
    Write-Indented $out
    continue
  }
  $after = Invoke-GitText $repo @('rev-parse', 'HEAD')
  if ($before -eq $after) {
    Write-Host "  ${name}: 最新（ブランチ $branch）"
  } else {
    $count = Invoke-GitText $repo @('rev-list', '--count', "$before..$after")
    Write-Host "  ${name}: 更新（ブランチ $branch、$count コミット）" -ForegroundColor Green
  }
  foreach ($m in $moved) {
    if ($m.Same) {
      Remove-Item -LiteralPath $m.Backup -Force
      Write-Host "      置き換え: $($m.File)（GitHub 側と同じ内容だったため）"
    } else {
      Write-Host "      退避: $($m.File) → $(Split-Path $m.Backup -Leaf)（手元の内容が違うため残しました。不要なら消してください）" -ForegroundColor Yellow
    }
  }
}
if ($skipped.Count -gt 0) { Write-Host "対象外: $($skipped -join '、')" }
if ($failed -gt 0) {
  Write-Host "失敗 $failed 件。表示された内容を確認してください（未コミットの変更との重なり、履歴の分かれ、ネットワーク）" -ForegroundColor Red
  exit 1
}
exit 0

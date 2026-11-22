<#
daily-log-kit v1.10.4 — 日報の仕組みを入れたリポジトリを、まとめて git pull する

対象
- -Root（既定 C:\AllGitRepository）直下の Git リポジトリのうち、日報の仕組みが入っているもの（tools/daily-log.mjs がある）と、キット自身
- 日報の仕組みが入っていないリポジトリは対象外（一覧に「対象外」と出るだけで、何もしない）
- -Repos で名前を指定すると、そのリポジトリだけ（日報の仕組みの有無は見ない）
- -Exclude で名前を指定すると、そのリポジトリを外す

取り込む前の確認
- 対象のリポジトリを番号つきで一覧にし、どれを取り込むかを聞く
  A = 全部 / 番号 = 選んだものだけ（例 3、1,3,5、1-3。1つだけでもよい）/ Q か Enter = やめる（何もしない）
- -Yes を付けると確認せずに全部取り込む。-Repos で名前を指定したときも確認しない（指定したものを取り込む）

安全のための仕組み
- 早送りだけで取り込む（git fetch → git merge --ff-only）。手元と GitHub の履歴が分かれているリポジトリは、統合せずに「失敗」と表示して次へ進む
- 取り込むのは「今チェックアウトしているブランチ」だけ。ブランチを切り替えない。未コミットの変更には触れない
  （取り込むファイルと未コミットの変更が重なるときは、git が止めるので「失敗」になる）
- 取り込むファイルと同じ名前の未追跡ファイル（Unity が作る ProjectSettings/ProjectVersion.txt など）があると git は止まる。
  その場合は、GitHub 側と同じ内容なら置き換え、違う内容なら「<ファイル名>.local」に退避してから取り込む（消さない）。
  取り込みに失敗したら元に戻す。-NoMoveUntracked を付けると退避せずに「失敗」と表示する

例
  .\pull-all.ps1                              # 一覧を出して、全部・選んだもの・やめるを選ぶ
  .\pull-all.ps1 -Yes                         # 確認せずに全部
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
  [switch]$NoMoveUntracked,
  [switch]$Yes
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

# 取り込むリポジトリを選ぶ。-Yes か -Repos のときは聞かない
function Read-Answer([string]$Prompt) {
  if ([Console]::IsInputRedirected) { Write-Host -NoNewline "$Prompt "; $line = [Console]::In.ReadLine(); if ($null -ne $line) { Write-Host $line }; return $line }
  return (Read-Host $Prompt)
}
# 「3」「1,3,5」「1-3」「2 4」を番号の一覧にする。範囲外や読めない値があれば $null
function ConvertTo-Numbers([string]$Text, [int]$Max) {
  $nums = @()
  foreach ($tok in ($Text -split '[,、\s]+' | Where-Object { $_ })) {
    if ($tok -match '^(\d+)[-~〜](\d+)$') { $a = [int]$Matches[1]; $b = [int]$Matches[2]; if ($a -gt $b) { $t = $a; $a = $b; $b = $t }; $nums += $a..$b }
    elseif ($tok -match '^\d+$') { $nums += [int]$tok }
    else { return $null }
  }
  $nums = @($nums | Sort-Object -Unique)
  if ($nums.Count -eq 0) { return $null }
  foreach ($n in $nums) { if ($n -lt 1 -or $n -gt $Max) { return $null } }
  return ,$nums
}

if ($targets.Count -eq 0) {
  Write-Host "取り込む対象のリポジトリがありません（$Root）"
  if ($skipped.Count -gt 0) { Write-Host "対象外: $($skipped -join '、')" }
  exit 0
}
if (-not $Yes -and -not $Repos) {
  Write-Host "取り込む対象のリポジトリ（$Root）:"
  for ($i = 0; $i -lt $targets.Count; $i++) {
    $b = Invoke-GitText $targets[$i] @('rev-parse', '--abbrev-ref', 'HEAD')
    if ($script:GitCode -ne 0 -or -not $b) { $b = '?' }
    Write-Host ("  [{0}] {1}（ブランチ {2}）" -f ($i + 1), (Split-Path $targets[$i] -Leaf), $b)
  }
  if ($skipped.Count -gt 0) { Write-Host "  対象外: $($skipped -join '、')" }
  Write-Host ''
  Write-Host '注意: 取り込むのは、各リポジトリで今チェックアウトしているブランチです（ブランチは切り替えません）。' -ForegroundColor Yellow
  Write-Host '      早送りだけで取り込み、未コミットの変更には触れません。Unity やツクールなどのエディタは閉じてから実行してください。' -ForegroundColor Yellow
  Write-Host '      取り込むファイルと同じ名前の未追跡ファイルは、内容が違えば <ファイル名>.local に退避します。' -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'どれを取り込みますか？'
  Write-Host '  A       … 全部'
  Write-Host '  番号    … 選んだものだけ（例 3、1,3,5、1-3。1つだけでもよい）'
  Write-Host '  Q/Enter … やめる（何もしない）'
  $chosen = $null
  for ($try = 1; $try -le 3 -and $null -eq $chosen; $try++) {
    $ans = Read-Answer '選択'
    if ($null -eq $ans) { Write-Host '入力がないため、やめました（確認なしで全部取り込むなら -Yes）' -ForegroundColor Red; exit 1 }
    $ans = $ans.Trim()
    if ($ans -eq '' -or $ans -match '^[qQ]$') { Write-Host 'やめました（何も取り込んでいません）'; exit 0 }
    if ($ans -match '^[aA]$') { $chosen = $targets; break }
    $nums = ConvertTo-Numbers $ans $targets.Count
    if ($null -eq $nums) { Write-Host "  「$ans」は選べません。A、1〜$($targets.Count) の番号、Q のどれかを入力してください" -ForegroundColor Red; continue }
    $chosen = @($nums | ForEach-Object { $targets[$_ - 1] })
  }
  if ($null -eq $chosen) { Write-Host 'やめました（選択を3回読めませんでした）' -ForegroundColor Red; exit 1 }
  $notChosen = @($targets | Where-Object { $chosen -notcontains $_ } | ForEach-Object { Split-Path $_ -Leaf })
  $targets = @($chosen)
  Write-Host ''
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
  $oldHead = Invoke-GitText $repo @('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
  $out = Invoke-GitText $repo @('fetch', '--quiet')
  if ($script:GitCode -ne 0) {
    $failed++
    Write-Host "  ${name}: 失敗（GitHub から取得できません。ブランチ $branch）" -ForegroundColor Red
    Write-Indented $out
    continue
  }

  # GitHub 側の既定のブランチを確かめ直す（手元の origin/HEAD は clone したときのままで、git fetch では変わらない）
  Invoke-GitText $repo @('remote', 'set-head', 'origin', '--auto') | Out-Null
  $newHead = Invoke-GitText $repo @('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
  if ($script:GitCode -eq 0 -and $oldHead -and $newHead -and $oldHead -ne $newHead) {
    $newName = $newHead -replace '^origin/', ''
    Write-Host "  ${name}: GitHub の既定のブランチが $($oldHead -replace '^origin/', '') から $newName に変わっていました（手元の記録を直しました）" -ForegroundColor Yellow
    if ($branch -ne $newName) { Write-Host "      今のブランチは $branch のままです。$newName に移るなら: git -C `"$repo`" switch $newName" }
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
if ($notChosen -and $notChosen.Count -gt 0) { Write-Host "選ばなかったもの: $($notChosen -join '、')" }
if ($skipped.Count -gt 0) { Write-Host "対象外: $($skipped -join '、')" }
if ($failed -gt 0) {
  Write-Host "失敗 $failed 件。表示された内容を確認してください（未コミットの変更との重なり、履歴の分かれ、ネットワーク）" -ForegroundColor Red
  exit 1
}
exit 0

<#
daily-log-kit v1.10.3 — 一括導入（install-all.ps1）、反映（publish-kit.ps1）、一括の取り込み（pull-all.ps1）、ダッシュボード（dashboard.ps1）の通しテスト

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
function Run-PsInput([string]$File, [string[]]$ArgList, [string]$Text) {
  $o = $Text | & $Ps -NoProfile -ExecutionPolicy Bypass -File $File @ArgList 2>&1 | Out-String
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
Write-Host '== 5. pull-all.ps1（日報の仕組みを入れたリポジトリだけ、まとめて git pull）'
# 導入のブランチを GitHub 役の main に入れる（PR のマージの代わり）。手元の main は1コミット遅れた状態になる
G $game push -q origin "${branch}:main" | Out-Null
Check ((& git --git-dir=$gameRemote rev-parse refs/heads/main) -eq (G $game rev-parse $branch)) '準備: GitHub 役の main に導入のコミットが入った'
# 日報の仕組みを入れていないリポジトリ（対象外になること）
$other = Join-Path $Root 'repos\other'
New-Item -ItemType Directory -Path $other -Force | Out-Null
G $other init -q | Out-Null
Set-Content -Path (Join-Path $other 'b.txt') -Value 'b' -Encoding ASCII
G $other add . | Out-Null
G $other commit -q -m 'init' | Out-Null
G $game fetch -q origin | Out-Null   # GitHub 側の main に日報の仕組みが入ったことを手元に知らせる（まだ取り込まない）
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Exclude', 'game', '-Yes')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0) '終了コード 0（-Exclude）'
Check ($r.Out -match '対象外: .*game') '-Exclude で外したリポジトリは対象外'
Check (-not (Test-Path (Join-Path $game 'tools'))) '外したリポジトリは取り込まない'
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Yes')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0) '終了コード 0'
Check ($r.Out -match 'game: 更新') '日報の仕組みを入れたリポジトリを取り込む'
Check ($r.Out -match 'daily-log-kit: 最新') 'キット自身も対象'
Check ($r.Out -match '対象外: .*other') '日報の仕組みがないリポジトリは対象外'
Check (Test-Path (Join-Path $game 'tools\daily-log.mjs')) '取り込んだファイルが作業フォルダにある'
Check ((G $game status --short) -match 'a\.txt') '未コミットの変更が残っている'
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Yes')
Check ($r.Out -match 'game: 最新') '2回目は「最新」'

Write-Host ''
Write-Host '== 5b. pull-all.ps1（一覧を出して選ぶ）'
$pa = Join-Path $kit 'pull-all.ps1'
$rr = @('-Root', (Join-Path $Root 'repos'))
$r = Run-PsInput $pa $rr 'Q'
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0 -and $r.Out -match '\[1\] daily-log-kit' -and $r.Out -match '\[2\] game') '番号つきの一覧を出す'
Check ($r.Out -match '注意:') '注意文を出す'
Check ($r.Out -match 'やめました' -and $r.Out -notmatch 'git pull をまとめて実行します') 'Q なら何もしない'
$r = Run-PsInput $pa $rr ''
Check ($r.Out -match 'やめました' -and $r.Out -notmatch 'git pull をまとめて実行します') 'Enter だけなら何もしない'
$r = Run-PsInput $pa $rr '2'
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0 -and $r.Out -match 'game: ' -and $r.Out -notmatch 'daily-log-kit: ') '番号で1つだけ取り込む'
Check ($r.Out -match '選ばなかったもの: daily-log-kit') '選ばなかったものを表示'
$r = Run-PsInput $pa $rr "9`nA"
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Out -match '選べません' -and $r.Out -match 'game: ' -and $r.Out -match 'daily-log-kit: ') '範囲外の番号は聞き直し、A で全部'
$r = Run-PsInput $pa $rr '1-2'
Check ($r.Code -eq 0 -and $r.Out -match 'game: ' -and $r.Out -match 'daily-log-kit: ') '範囲（1-2）で選べる'

Write-Host ''
Write-Host '== 6. pull-all.ps1（取り込むファイルと同じ名前の未追跡ファイル、履歴の分かれ）'
$work = Join-Path $Root 'work\game'
& git clone -q $gameRemote $work 2>&1 | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $work 'ProjectSettings') | Out-Null
Set-Content -Path (Join-Path $work 'ProjectSettings\ProjectVersion.txt') -Value 'm_EditorVersion: 6000.0.1' -Encoding ASCII
Set-Content -Path (Join-Path $work 'same.txt') -Value 'same' -Encoding ASCII
G $work add . | Out-Null
G $work commit -q -m 'ProjectVersion' | Out-Null
G $work push -q origin HEAD:main | Out-Null
# 手元には同じ名前の未追跡ファイル（Unity が作ったもの、と同じ内容のもの）
New-Item -ItemType Directory -Force -Path (Join-Path $game 'ProjectSettings') | Out-Null
Set-Content -Path (Join-Path $game 'ProjectSettings\ProjectVersion.txt') -Value 'm_EditorVersion: 2022.3.0' -Encoding ASCII
Set-Content -Path (Join-Path $game 'same.txt') -Value 'same' -Encoding ASCII
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'game', '-NoMoveUntracked')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -ne 0 -and $r.Out -match 'ProjectSettings/ProjectVersion\.txt') '-NoMoveUntracked なら失敗と表示し、ファイル名を出す'
Check ((Get-Content (Join-Path $game 'ProjectSettings\ProjectVersion.txt') -Raw) -match '2022') '-NoMoveUntracked なら手元のファイルに触れない'
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'game')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0 -and $r.Out -match 'game: 更新') '未追跡ファイルがあっても取り込める'
Check ((Get-Content (Join-Path $game 'ProjectSettings\ProjectVersion.txt') -Raw) -match '6000') 'GitHub 側のファイルになる'
Check ((Get-Content (Join-Path $game 'ProjectSettings\ProjectVersion.txt.local') -Raw) -match '2022') '内容が違う手元のファイルは .local に退避'
Check ($r.Out -match '退避: ProjectSettings/ProjectVersion\.txt') '退避したことを表示'
Check ((Test-Path (Join-Path $game 'same.txt')) -and -not (Test-Path (Join-Path $game 'same.txt.local'))) '同じ内容のファイルは置き換えるだけ（.local を作らない）'
Check ((G $game status --short) -match 'a\.txt') '未コミットの変更が残っている（6）'
# 履歴が分かれたとき: 失敗と表示し、PowerShell のエラーの飾り（発生場所など）を出さない
Set-Content -Path (Join-Path $work 'remote.txt') -Value 'r' -Encoding ASCII
G $work add . | Out-Null
G $work commit -q -m 'remote' | Out-Null
G $work push -q origin HEAD:main | Out-Null
Set-Content -Path (Join-Path $game 'local.txt') -Value 'l' -Encoding ASCII
G $game add local.txt | Out-Null
G $game commit -q -m 'local' | Out-Null
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'game')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -ne 0 -and $r.Out -match 'game: 失敗') '履歴が分かれていたら失敗と表示'
Check ($r.Out -notmatch 'NativeCommandError|CategoryInfo|FullyQualifiedErrorId') 'git のエラーを PowerShell のエラー表示にしない'

Write-Host ''
Write-Host '== 7. dashboard.ps1（ダッシュボードを作る。ブラウザは開かない）'
$dash = Join-Path $Root 'dashboard.html'
$r = Run-Ps (Join-Path $kit 'dashboard.ps1') @('-Root', (Join-Path $Root 'repos'), '-Out', $dash, '-NoOpen')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0) '終了コード 0（dashboard）'
Check (Test-Path $dash) 'HTML ができる'
$html = if (Test-Path $dash) { [System.IO.File]::ReadAllText($dash, [System.Text.Encoding]::UTF8) } else { '' }
Check ($html -match '"name":"game"' -and $html -match '"name":"daily-log-kit"') '日報の仕組みを入れたリポジトリとキット本体が入る'
Check ($html -notmatch '"name":"other"') '日報の仕組みがないリポジトリは入らない'
Check ($r.Out -match '対象外: .*other') '対象外を表示'
Check ($html -notmatch '__DATA__' -and $html -match '日報ダッシュボード') 'ひな形に集計結果が入っている'

Write-Host ''
Write-Host '== 8. GitHub で既定のブランチを変えた後（手元の origin/HEAD は古いまま）'
# 既定のブランチが claude/old のリポジトリ（日報の仕組みは未導入）
$movedRemote = Join-Path $Root 'remote\moved.git'
$moved = Join-Path $Root 'repos\moved'
& git init -q --bare -b claude/old $movedRemote
& git clone -q $movedRemote $moved 2>&1 | Out-Null
G $moved switch -q -c claude/old | Out-Null
Set-Content -Path (Join-Path $moved 'm.txt') -Value 'm' -Encoding ASCII
G $moved add . | Out-Null
G $moved commit -q -m 'init' | Out-Null
G $moved push -q -u origin claude/old | Out-Null
G $moved remote set-head origin --auto | Out-Null
Check ((G $moved symbolic-ref --short refs/remotes/origin/HEAD) -eq 'origin/claude/old') '準備: 手元の origin/HEAD は claude/old'
# GitHub 役で main を作り、既定のブランチを main に変える（古いブランチは残す）
G $moved push -q origin claude/old:main | Out-Null
& git --git-dir=$movedRemote symbolic-ref HEAD refs/heads/main
G $moved fetch -q origin --prune | Out-Null
Check ((G $moved symbolic-ref --short refs/remotes/origin/HEAD) -eq 'origin/claude/old') '準備: git fetch だけでは origin/HEAD は変わらない'
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'moved')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0 -and $r.Out -match 'moved: 最新') 'pull-all: 取り込みは今のブランチのまま成功'
Check ($r.Out -match '既定のブランチが claude/old から main に変わっていました') 'pull-all: 既定のブランチが変わったことを知らせる'
Check ($r.Out -match 'switch main') 'pull-all: main に移るコマンドを示す'
Check ((G $moved symbolic-ref --short refs/remotes/origin/HEAD) -eq 'origin/main') 'pull-all: 手元の origin/HEAD を main に直す'
Check ((G $moved rev-parse --abbrev-ref HEAD) -eq 'claude/old') 'pull-all: ブランチは切り替えない'
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'moved')
Check ($r.Out -notmatch '変わっていました') 'pull-all: 2回目は知らせない'

# 古いブランチを GitHub 役で消す。手元の origin/HEAD は、消えたブランチを指した状態に戻しておく（一度も直していない PC と同じ）
G $moved push -q origin --delete claude/old | Out-Null
G $moved fetch -q origin --prune | Out-Null
G $moved symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/claude/old | Out-Null
$main0 = (& git --git-dir=$movedRemote rev-parse refs/heads/main)
$ver8 = ([regex]::Match((Get-Content (Join-Path $kit 'install.mjs') -Raw -Encoding UTF8), "KIT_VERSION = '([\d.]+)'")).Groups[1].Value
$branch8 = "chore/daily-log-v$ver8"
$r = Run-Ps (Join-Path $kit 'install-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Repos', 'moved', '-Backfill', '-Apply')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Code -eq 0 -and $r.Out -notmatch 'スキップ') 'install-all: 古いブランチが消えていても導入できる'
Check ($r.Out -match '基準 origin/main') 'install-all: 基準は main'
Check ($r.Out -match '既定のブランチが claude/old から main に変わっていました') 'install-all: 既定のブランチが変わったことを知らせる'
Check ([bool](G $moved branch --list $branch8)) "install-all: ブランチ $branch8 にコミット"
Check ((G $moved rev-parse "$branch8~1") -eq $main0) 'install-all: main の先頭から作っている'
Check ((G $moved symbolic-ref --short refs/remotes/origin/HEAD) -eq 'origin/main') 'install-all: 手元の origin/HEAD を main に直す'

# 導入を GitHub 役の main に入れる（PR のマージの代わり）。作業フォルダは古いブランチのままで、ツールがない
G $moved push -q origin "${branch8}:main" | Out-Null
G $moved fetch -q origin | Out-Null
G $moved symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/claude/old | Out-Null
Check (-not (Test-Path (Join-Path $moved 'tools'))) '準備: 作業フォルダにツールがなく、origin/HEAD は消えたブランチを指す'
$r = Run-Ps (Join-Path $kit 'pull-all.ps1') @('-Root', (Join-Path $Root 'repos'), '-Exclude', 'game', '-Yes')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
Check ($r.Out -match 'moved: ' -and $r.Out -notmatch '対象外: .*moved') 'pull-all: 日報の仕組みを入れたリポジトリとして扱う（main を見る）'
$dash8 = Join-Path $Root 'dashboard8.html'
$r = Run-Ps (Join-Path $kit 'dashboard.ps1') @('-Root', (Join-Path $Root 'repos'), '-Out', $dash8, '-NoOpen')
if ($env:E2E_DEBUG) { Write-Host $r.Out }
$html8 = if (Test-Path $dash8) { [System.IO.File]::ReadAllText($dash8, [System.Text.Encoding]::UTF8) } else { '' }
Check ($r.Code -eq 0 -and $html8 -match '"name":"moved"') 'dashboard: 日報の仕組みを入れたリポジトリとして扱う（main を見る）'

Write-Host ''
if (-not $env:E2E_KEEP) { Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue }
if ($script:Failed -gt 0) { Write-Host "失敗 $($script:Failed) 件" -ForegroundColor Red; exit 1 }
Write-Host 'すべて成功' -ForegroundColor Green
exit 0

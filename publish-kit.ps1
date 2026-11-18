<#
daily-log-kit v1.10.0 — 新しい版のキット（zip）を GitHub の daily-log-kit リポジトリへ反映する

■ 置き場所と実行場所
  このファイルと publish-kit.bat は、キットのフォルダ（例 C:\AllGitRepository\daily-log-kit）の直下に置いて実行する。
  ゲームなど各リポジトリの中や、ダウンロードフォルダでは実行しない。

■ 実行方法（どれか1つ）
  1. publish-kit.bat をダブルクリック        … 次の順に探し、版番号が最も大きい daily-log-kit-v*.zip を使う
                                                ① このフォルダ（キットのフォルダ） ② ダウンロードフォルダ
                                                （このフォルダに置いた zip は .gitignore で除外され、コミットされない）
  2. zip を publish-kit.bat にドラッグ＆ドロップ … その zip を使う
  3. PowerShell で .\publish-kit.ps1 -Zip <zipのパス> [-Yes]

■ 処理の流れ
  1. 事前確認: git・node がある / キットのフォルダが Git リポジトリ / 未コミットの変更がない / GitHub と同期（git pull）
  2. zip を一時フォルダに展開し、版番号を確認（今より新しく、まだ公開していない版か）
  3. .git 以外をキットのフォルダへ上書きコピー
  4. テスト（node --test）。失敗したら上書き前の状態に戻して終了
  5. 変更一覧を表示し、確認（y で続行。-Yes なら確認なし）
  6. コミット → タグ v<版> → GitHub へ push
  7. 一時フォルダを削除し、次にやること（各リポジトリへの配布）を表示
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Zip,
  [switch]$Yes
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ('dlk-publish-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Stop-Publish([string]$Message) {
  Write-Host ''
  Write-Host "中止: $Message" -ForegroundColor Red
  if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue }
  exit 1
}
function Step([string]$Message) { Write-Host ''; Write-Host "== $Message" -ForegroundColor Cyan }
function Get-KitVersion([string]$Dir) {
  $f = Join-Path $Dir 'install.mjs'
  if (-not (Test-Path $f)) { return $null }
  $m = [regex]::Match((Get-Content $f -Raw -Encoding UTF8), "KIT_VERSION = '([\d.]+)'")
  if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}
# 版番号が最も大きい zip（同じ版なら新しいファイル）。「daily-log-kit-v1.2.0 (1).zip」のような名前にも対応
function Find-KitZip([string]$Dir) {
  if (-not $Dir -or -not (Test-Path $Dir)) { return $null }
  $items = Get-ChildItem -Path $Dir -Filter 'daily-log-kit-v*.zip' -File -ErrorAction SilentlyContinue | ForEach-Object {
    $m = [regex]::Match($_.Name, 'daily-log-kit-v(\d+\.\d+\.\d+)')
    if ($m.Success) { [pscustomobject]@{ File = $_; Version = [version]$m.Groups[1].Value } }
  }
  $best = $items | Sort-Object -Property @{ Expression = 'Version'; Descending = $true }, @{ Expression = { $_.File.LastWriteTime }; Descending = $true } | Select-Object -First 1
  if ($best) { return $best.File.FullName } else { return $null }
}
function Get-Downloads {
  try {
    $p = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
    if ($p -and (Test-Path $p)) { return $p }
  } catch { }
  if ($env:USERPROFILE) { return (Join-Path $env:USERPROFILE 'Downloads') }
  return (Join-Path $HOME 'Downloads')
}

Write-Host "キットのフォルダ: $Kit"

# 1. 事前確認
Step '1/7 事前確認'
foreach ($cmd in @('git', 'node')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Stop-Publish "$cmd が見つかりません" }
}
if (-not (Test-Path (Join-Path $Kit 'install.mjs'))) { Stop-Publish 'このファイルはキットのフォルダ（install.mjs がある場所）に置いて実行してください' }
if (-not (Test-Path (Join-Path $Kit '.git'))) { Stop-Publish 'キットのフォルダが Git リポジトリではありません（README「GitHub での運用」の「1. 置く」を先に実施）' }
$origin = & git -C $Kit remote get-url origin 2>$null
if (-not $origin) { Stop-Publish 'GitHub のリモート（origin）が設定されていません' }
$branch = (& git -C $Kit rev-parse --abbrev-ref HEAD 2>$null)
if ($branch -ne 'main') { Stop-Publish "main ブランチで実行してください（現在: $branch）。git -C `"$Kit`" switch main" }
$dirty = & git -C $Kit status --porcelain --untracked-files=no
if ($dirty) { Stop-Publish "キットのフォルダに未コミットの変更があります。先にコミットするか元に戻してください:`n$($dirty -join "`n")" }
& git -C $Kit pull --ff-only --quiet origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Publish 'git pull に失敗しました（GitHub 側と履歴が分かれている可能性）。git -C <キット> status で確認してください' }
$current = Get-KitVersion $Kit
Write-Host "GitHub: $origin"
Write-Host "現在の版: v$current"

# 2. zip の展開と版の確認
Step '2/7 zip の確認'
if (-not $Zip) {
  $dl = Get-Downloads
  $Zip = Find-KitZip $Kit
  if ($Zip) { Write-Host '（キットのフォルダにある zip を使います）' }
  else {
    $Zip = Find-KitZip $dl
    if ($Zip) { Write-Host '（ダウンロードフォルダの zip を使います）' }
  }
  if (-not $Zip) { Stop-Publish "daily-log-kit-v*.zip が見つかりません。キットのフォルダ（$Kit）か、ダウンロードフォルダ（$dl）に置いてください" }
}
if (-not (Test-Path $Zip)) { Stop-Publish "zip が見つかりません: $Zip" }
Write-Host "zip: $Zip"
New-Item -ItemType Directory -Path $Temp | Out-Null
try { Expand-Archive -Path $Zip -DestinationPath $Temp -Force } catch { Stop-Publish "zip を展開できません: $($_.Exception.Message)" }
$src = Join-Path $Temp 'daily-log-kit'
if (-not (Test-Path (Join-Path $src 'install.mjs'))) {
  $found = Get-ChildItem -Path $Temp -Filter 'install.mjs' -Recurse -File | Select-Object -First 1
  if (-not $found) { Stop-Publish 'zip の中にキット（install.mjs）がありません' }
  $src = $found.DirectoryName
}
if (-not (Test-Path (Join-Path $src 'files'))) { Stop-Publish 'zip の中にキットの files フォルダがありません' }
$next = Get-KitVersion $src
if (-not $next) { Stop-Publish 'zip のキットの版番号を読めません' }
Write-Host "zip の版: v$next"
if ([version]$next -le [version]$current) { Stop-Publish "zip の版（v$next）が現在の版（v$current）より新しくありません。最新の zip か確認してください" }
$tag = "v$next"
$localTag = & git -C $Kit tag --list $tag
$remoteTag = & git -C $Kit ls-remote --tags origin "refs/tags/$tag" 2>$null
if ($localTag -or $remoteTag) { Stop-Publish "タグ $tag は既にあります（この版は公開済み）" }

# 3. 上書きコピー
Step "3/7 キットのフォルダへ上書き（v$current → v$next）"
$tracked = @(& git -C $Kit ls-files)
$untrackedBefore = @(& git -C $Kit ls-files --others --exclude-standard)
& robocopy $src $Kit /E /XD .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Stop-Publish "コピーに失敗しました（robocopy の終了コード $LASTEXITCODE）" }
$srcFiles = @(Get-ChildItem -Path $src -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($src.Length + 1).Replace('\', '/') })
$missing = @($tracked | Where-Object { $srcFiles -notcontains $_ })
$added = @($srcFiles | Where-Object { ($tracked -notcontains $_) -and ($untrackedBefore -notcontains $_) })

function Restore-Kit {
  & git -C $Kit reset --hard --quiet HEAD 2>&1 | Out-Null
  foreach ($f in $added) {
    $p = Join-Path $Kit $f
    if (Test-Path $p) { Remove-Item -Force $p }
  }
}

# 4. テスト
Step '4/7 テスト'
Push-Location $Kit
try { $testOut = & node --test 2>&1 | Out-String; $testCode = $LASTEXITCODE }  # キットの全テスト（*.test.mjs）
finally { Pop-Location }
$summary = ($testOut -split "`n" | Where-Object { $_ -match '^# (tests|pass|fail) ' }) -join ' / '
Write-Host $summary
if ($testCode -ne 0) {
  Write-Host $testOut
  Restore-Kit
  Stop-Publish 'テストが失敗したため、キットのフォルダを上書き前の状態に戻しました'
}

# 5. 変更の確認
Step '5/7 変更の一覧'
& git -C $Kit add -A
$changes = @(& git -C $Kit status --short)
if (-not $changes) { Restore-Kit; Stop-Publish 'zip とキットの中身が同じで、反映する変更がありません' }
$changes | ForEach-Object { Write-Host "  $_" }
Write-Host "  （合計 $($changes.Count) ファイル）"
if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host "注意: 次のファイルは zip にありませんが、キットのフォルダに残します（不要なら後で git rm）:" -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  $_" }
}
$readme = Get-Content (Join-Path $Kit 'README.md') -Encoding UTF8 -ErrorAction SilentlyContinue
$row = $readme | Where-Object { $_ -match ('^\| ' + [regex]::Escape($next) + ' \|') } | Select-Object -First 1
$note = if ($row) { ($row -split '\|')[3].Trim() } else { '' }
$message = if ($note) { "${tag}: $note" } else { "daily-log-kit $tag" }
Write-Host ''
Write-Host "コミットメッセージ: $message"
if (-not $Yes) {
  $ans = Read-Host "GitHub に反映しますか？ [y/N]"
  if ($ans -notmatch '^[yY]') { & git -C $Kit reset --quiet; Restore-Kit; Stop-Publish '取り消しました（キットのフォルダは元の状態に戻しました）' }
}

# 6. コミット・タグ・push
Step "6/7 コミット、タグ $tag、GitHub へ push"
& git -C $Kit commit --quiet -m $message
if ($LASTEXITCODE -ne 0) { Stop-Publish 'コミットに失敗しました' }
& git -C $Kit tag $tag
& git -C $Kit push --quiet origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Publish "push に失敗しました。コミットとタグは手元にあります。ネットワークを確認して git -C `"$Kit`" push origin main --tags を実行してください" }
& git -C $Kit push --quiet origin $tag 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Publish "タグの push に失敗しました。git -C `"$Kit`" push origin $tag を実行してください" }
Write-Host "GitHub に反映しました: $tag"

# 7. 後片付けと次の手順
Step '7/7 後片付け'
Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
Write-Host '一時フォルダを削除しました'
Write-Host ''
Write-Host '次にやること（各リポジトリへの配布。同じフォルダの PowerShell で）:' -ForegroundColor Green
Write-Host "  cd `"$Kit`""
Write-Host '  .\install-all.ps1                    # 確認のみ'
Write-Host '  .\install-all.ps1 -Apply -CreatePR   # 導入済みのリポジトリに更新のPR'
exit 0

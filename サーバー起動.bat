@echo off
chcp 65001 > nul
rem ===== TABLE TENNIS DUEL サーバー起動（ダブルクリックで動く） =====
rem このファイルがある場所の server フォルダに移動する
cd /d "%~dp0server"

where node > nul 2>&1
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS をインストールしてください。
  pause
  exit /b
)

rem 初回だけ部品をインストールする
if not exist node_modules (
  echo 部品をインストールしています（初回のみ・1〜2分かかります）...
  call npm install
)

echo.
echo サーバーを起動します。この黒い画面は閉じずにそのままにしてください。
echo 止めるときは Ctrl + C を押すか、この画面を閉じます。
echo.
call npm start
pause

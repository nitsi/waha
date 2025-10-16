@echo off
setlocal

call yarn build || goto :error
docker build --tag devlikeapro/waha:latest . || goto :error
wsl sh -c "cd ~/waha/; docker compose down; docker compose up -d" || goto :error

endlocal
exit /b 0

:error
endlocal
exit /b 1

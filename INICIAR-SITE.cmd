@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale Node.js 24 antes de iniciar.
  pause
  exit /b 1
)
if not exist ".env.local" (
  echo ATENCAO: arquivo .env.local ausente. O login Clerk nao funcionara.
  echo Restaure seu .env.local anterior nesta pasta ou preencha uma copia de .env.example.
  echo Nenhuma credencial foi incluida no ZIP.
  pause
  exit /b 1
)
if not exist "node_modules\next\package.json" (
  call npm ci
  if errorlevel 1 exit /b 1
)
echo Atualizando o build para aplicar as configuracoes do .env.local...
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
echo Acesse http://127.0.0.1:3000 e mantenha esta janela aberta.
call npm run start -- --hostname 127.0.0.1
if errorlevel 1 pause

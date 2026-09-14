@echo off
title Fretado Ao Vivo - Servidor
echo ========================================================
echo          INICIANDO FRETADO AO VIVO
echo ========================================================
echo.
echo Iniciando servidor local na porta 8080...
echo.
start "" python server.py
timeout /t 2 /nobreak > nul
start "" http://localhost:8080
echo Pronto! O aplicativo foi aberto no seu navegador padrao.

@echo off
rem Double-click to install or update CCS v2 on this server (asks for administrator rights).
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File ""%~dp0Install-Ccs.ps1""'"

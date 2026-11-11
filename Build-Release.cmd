@echo off
rem Double-click to build CCS v2 on this server and install it (asks for administrator rights).
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File ""%~dp0Build-Release.ps1""'"

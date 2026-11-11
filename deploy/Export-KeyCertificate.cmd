@echo off
rem Saves the CCS key certificate to a password-protected file (backup / moving to another server).
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File ""%~dp0Export-KeyCertificate.ps1""'"

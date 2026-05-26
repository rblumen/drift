@echo off
:: ============================================================
::  Portfolio Rebalancer — Desktop shortcut installer
::
::  Run this ONCE.  It creates a "Portfolio Rebalancer" shortcut
::  on your Desktop that points to launch.bat in this folder.
::
::  After that, double-click the Desktop icon any time to start
::  the app — no need to navigate to this folder again.
:: ============================================================
setlocal
set "LAUNCH=%~dp0launch.bat"
set "WDIR=%~dp0"
if "%WDIR:~-1%"=="\" set "WDIR=%WDIR:~0,-1%"

:: Write a temporary VBScript that creates the .lnk file, then run it.
:: VBScript needs no execution-policy workaround and works on all Windows.
set "VBS=%TEMP%\mkshortcut_%RANDOM%.vbs"

(
  echo Dim sh, fs, lnk, ico
  echo Set sh = CreateObject("WScript.Shell"^)
  echo Set fs = CreateObject("Scripting.FileSystemObject"^)
  echo Set lnk = sh.CreateShortcut(sh.SpecialFolders("Desktop"^) ^& "\Portfolio Rebalancer.lnk"^)
  echo lnk.TargetPath    = "%LAUNCH%"
  echo lnk.WorkingDirectory = "%WDIR%"
  echo lnk.Description   = "Launch Portfolio Rebalancer dev server and open browser"
  echo lnk.WindowStyle   = 1
  echo ico = "C:\Program Files\nodejs\node.exe"
  echo If fs.FileExists(ico^) Then
  echo   lnk.IconLocation = ico ^& ", 0"
  echo Else
  echo   lnk.IconLocation = sh.ExpandEnvironmentStrings("%%SystemRoot%%"^) ^& "\system32\imageres.dll, 170"
  echo End If
  echo lnk.Save()
  echo MsgBox "Done!" ^& Chr(10^) ^& Chr(10^) ^& "A 'Portfolio Rebalancer' shortcut has been added to your Desktop." ^& Chr(10^) ^& "Double-click it any time to launch the app.", 64, "Portfolio Rebalancer"
) > "%VBS%"

cscript //nologo "%VBS%"
del "%VBS%" >nul 2>&1
exit /b 0

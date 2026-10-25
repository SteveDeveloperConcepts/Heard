; Extra steps for the Windows installer (electron-builder includes this file automatically).

; Uninstalling removes the "start at login" entry, which would otherwise point at a missing app.
; Updates keep it, since the new version is installed in the same place.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.developerconcepts.stevenola"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.developerconcepts.stevenola"
  ${endIf}
!macroend

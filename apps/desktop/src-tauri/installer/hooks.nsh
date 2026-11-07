; Installer hooks for the build that ships nemora-mcp.exe (PLAN/22; src-tauri/tauri.mcp.json).
;
; An agent (Claude Desktop, an editor) keeps nemora-mcp.exe running for as long as it is open, so
; an update would find the file locked. Windows lets a running program's file be renamed: the old
; one moves aside to nemora-mcp.exe.old and keeps serving that agent until it restarts, and the new
; one is copied in its place. The aside copy goes on the next update or at uninstall, once nothing
; runs it.

!macro NSIS_HOOK_PREINSTALL
  Delete "$INSTDIR\nemora-mcp.exe.old"
  IfFileExists "$INSTDIR\nemora-mcp.exe.old" +3 0
  IfFileExists "$INSTDIR\nemora-mcp.exe" 0 +2
  Rename "$INSTDIR\nemora-mcp.exe" "$INSTDIR\nemora-mcp.exe.old"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete /REBOOTOK "$INSTDIR\nemora-mcp.exe.old"
!macroend

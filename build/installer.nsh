; Paperclip Desktop — custom NSIS hooks
; Adds an "also delete user data" prompt to the uninstaller, so users get
; a clean removal option without having to dig into %APPDATA% themselves.

!macro customUnInstall
  ; Don't prompt during silent uninstall (e.g. installer self-replace on update)
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also delete Paperclip's local data?$\r$\n$\r$\nThis removes your databases, saved connections, and settings under:$\r$\n$APPDATA\Paperclip$\r$\n$LOCALAPPDATA\Paperclip$\r$\n$PROFILE\.paperclip$\r$\n$\r$\nChoose No to keep your data for a future reinstall." \
      /SD IDNO \
      IDNO skipUserDataWipe

    RMDir /r "$APPDATA\Paperclip"
    RMDir /r "$LOCALAPPDATA\Paperclip"
    RMDir /r "$PROFILE\.paperclip"

    skipUserDataWipe:
  ${endIf}
!macroend

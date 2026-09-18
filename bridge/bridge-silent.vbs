' Starts the bridge with no console window.
' Put a shortcut to THIS file in shell:startup to have it run at login.
' It idles until Spotify opens, captures only Spotify, and releases when
' Spotify closes.

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Run "node """ & here & "\bridge.js""", 0, False

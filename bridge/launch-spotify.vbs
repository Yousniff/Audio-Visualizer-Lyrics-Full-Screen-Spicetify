' Alternative to running at login: launches Spotify AND the bridge together,
' and the bridge quits when Spotify does. Nothing runs when you're not
' listening to music.
'
' Pin a shortcut to this file to your taskbar in place of Spotify.

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)

' Spotify's usual install location (Microsoft Store builds differ — see README)
spotify = shell.ExpandEnvironmentStrings("%APPDATA%") & "\Spotify\Spotify.exe"

If fso.FileExists(spotify) Then
  shell.Run """" & spotify & """", 1, False
Else
  MsgBox "Couldn't find Spotify at:" & vbCrLf & spotify & vbCrLf & vbCrLf & _
         "Edit launch-spotify.vbs and set the correct path.", 48, "Spotify audio bridge"
  WScript.Quit
End If

shell.CurrentDirectory = here
shell.Run "node """ & here & "\bridge.js"" --exit-with-spotify", 0, False

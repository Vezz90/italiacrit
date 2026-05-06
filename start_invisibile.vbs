Set WshShell = CreateObject("WScript.Shell")
' Il parametro "0" significa "nascondi la finestra del terminale"
' Il parametro False significa "esegui in background senza bloccare"
WshShell.Run "python run_all.py", 0, False

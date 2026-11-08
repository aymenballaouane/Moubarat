# Fabrique le fichier app-release-bundle.aab de l'application Android (a envoyer a Google Play).
# Lancement, depuis ce dossier :  powershell -ExecutionPolicy Bypass -File .\build-android.ps1
# Le mot de passe de la cle de signature est demande ICI, saisi par la personne qui publie : il n'est ecrit nulle part
# (variables d'environnement du processus, effacees a la fin).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# L'application de bureau pose cette variable : elle empeche Windows de trouver gradlew.bat dans le dossier courant.
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue

# Le projet Android a ete corrige a la main (memoire de Gradle 1 Go car le JDK de Bubblewrap est en 32 bits, Android 7
# minimum, duree d'animation de demarrage) : on declare le projet a jour pour que Bubblewrap ne le regenere pas.
$hash = (Get-FileHash -Algorithm SHA1 .\twa-manifest.json).Hash.ToLower()
Set-Content -NoNewline -Encoding ascii .\manifest-checksum.txt $hash

$secure = Read-Host 'Mot de passe de la cle de signature (le meme pour le fichier et pour la cle)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:BUBBLEWRAP_KEYSTORE_PASSWORD = $plain
  $env:BUBBLEWRAP_KEY_PASSWORD = $plain
  bubblewrap build
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:BUBBLEWRAP_KEYSTORE_PASSWORD, Env:BUBBLEWRAP_KEY_PASSWORD -ErrorAction SilentlyContinue
}

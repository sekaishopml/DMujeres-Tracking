# Depuración del teléfono de prueba desde este PC, sin pasos a mano.
#
# Qué hace:
#  1. La primera vez baja las herramientas de Android (adb) y crea una llave
#     para entrar al servidor; pide la contraseña de root una sola vez. Esa
#     llave solo sirve para la depuración (túneles 41473 y 41474 y la orden
#     /usr/local/bin/dmj-adb-remoto del servidor).
#  2. Busca solo el teléfono en la red (no hace falta escribir IP ni puerto).
#  3. Si el servidor no está vinculado con el teléfono, muestra un QR: en el
#     teléfono, Depuración inalámbrica > Vincular dispositivo con código QR.
#  4. Abre el túnel al servidor y lo mantiene: si el teléfono cambia de puerto
#     o se corta, vuelve a conectar solo. Ctrl+C para terminar.
#
# Uso: clic derecho > "Ejecutar con PowerShell", o
#   powershell -ExecutionPolicy Bypass -File .\depuracion-qr.ps1
# Si el teléfono no aparece solo:  -Telefono 192.168.137.12:35191

param(
    [string]$Servidor = '68.168.20.219',
    [string]$Telefono = '',
    [int]$PuertoConexion = 41473,
    [int]$PuertoVinculo = 41474
)

# Continue: Windows PowerShell 5.1 toma como error lo que adb y ssh escriben
# en la salida de errores aunque sea un aviso normal.
$ErrorActionPreference = 'Continue'
$base = Join-Path $env:LOCALAPPDATA 'DMujeresDepuracion'
$adb = Join-Path $base 'platform-tools\adb.exe'
$llave = Join-Path $env:USERPROFILE '.ssh\dmj_depuracion'
$env:ADB_MDNS_OPENSCREEN = '1'

function Aviso([string]$texto, [string]$color = 'Gray') {
    Write-Host ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $texto) -ForegroundColor $color
}

$opciones = @('-i', $llave, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes')

function Remoto([string]$orden) {
    ((& ssh @opciones "root@$Servidor" $orden 2>&1 | ForEach-Object { "$_" }) -join "`n").Trim()
}

function Tunel([int]$puerto, [string]$destino) {
    $argumentos = ($opciones | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    $argumentos += " -N -R ${puerto}:$destino root@$Servidor"
    Start-Process ssh -ArgumentList $argumentos -WindowStyle Hidden -PassThru
}

function Cerrar($proceso) {
    if ($proceso -and -not $proceso.HasExited) { Stop-Process -Id $proceso.Id -Force -ErrorAction SilentlyContinue }
}

# Servicios que anuncia el teléfono en la red: conexión o vinculación.
function Buscar([string]$tipo, [string]$nombre = '') {
    $lineas = & $adb mdns services 2>&1 | ForEach-Object { "$_" }
    foreach ($linea in $lineas) {
        if ($linea -match "^(\S+)\s+_adb-tls-$tipo\._tcp\.?\s+([\d\.]+):(\d+)") {
            if (-not $nombre -or $Matches[1] -eq $nombre) { return "$($Matches[2]):$($Matches[3])" }
        }
    }
    return $null
}

function Al-Azar([int]$largo) {
    $letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
    -join (1..$largo | ForEach-Object { $letras | Get-Random })
}

function Mostrar-QR([string]$texto) {
    try {
        if (-not (Get-Module -ListAvailable QRCodeGenerator)) {
            Aviso 'Instalando el generador de QR (una sola vez)...'
            if (-not (Get-PackageProvider -ListAvailable NuGet -ErrorAction SilentlyContinue)) {
                Install-PackageProvider NuGet -Scope CurrentUser -Force -ErrorAction Stop | Out-Null
            }
            Install-Module QRCodeGenerator -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
        }
        Import-Module QRCodeGenerator -ErrorAction Stop
        New-PSOneQRCodeText -Text $texto -Width 12 -Show -ErrorAction Stop
        return $true
    } catch {
        Aviso "No se pudo mostrar el QR ($($_.Exception.Message))." 'Yellow'
        return $false
    }
}

# Vincula el adb del servidor con el teléfono (una vez; el teléfono lo recuerda).
function Vincular {
    $nombre = 'dmj-' + (Al-Azar 6)
    $clave = Al-Azar 10
    $conQR = Mostrar-QR "WIFI:T:ADB;S:$nombre;P:$clave;;"
    if ($conQR) {
        Aviso 'En el teléfono: Opciones de desarrollador > Depuración inalámbrica > Vincular dispositivo con código QR, y escanee el QR.' 'Cyan'
    } else {
        $nombre = ''
        Aviso 'En el teléfono: Depuración inalámbrica > Vincular con código de vinculación.' 'Cyan'
        $clave = Read-Host 'Escriba el código de 6 dígitos que muestra el teléfono'
    }
    $destino = $null
    for ($i = 0; $i -lt 60 -and -not $destino; $i++) { Start-Sleep -Seconds 2; $destino = Buscar 'pairing' $nombre }
    if (-not $destino) { Aviso 'El teléfono no apareció para vincular. Se vuelve a intentar.' 'Yellow'; return $false }
    $tunel = Tunel $PuertoVinculo $destino
    try {
        Start-Sleep -Seconds 3
        $respuesta = Remoto "vincular $clave"
        Aviso $respuesta
        return ($respuesta -match 'Successfully paired')
    } finally { Cerrar $tunel }
}

# 1. Herramientas de Android.
if (-not (Test-Path $adb)) {
    Aviso 'Bajando las herramientas de Android (una sola vez)...'
    New-Item -ItemType Directory -Force -Path $base -ErrorAction Stop | Out-Null
    $zip = Join-Path $base 'platform-tools.zip'
    Invoke-WebRequest 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip -UseBasicParsing -ErrorAction Stop
    Expand-Archive $zip -DestinationPath $base -Force -ErrorAction Stop
    Remove-Item $zip
}
& $adb start-server 2>&1 | Out-Null

# 2. Llave para el servidor.
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    throw 'Falta el cliente SSH de Windows: Configuración > Aplicaciones > Características opcionales > Cliente OpenSSH.'
}
if (-not (Test-Path $llave)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $llave) | Out-Null
    cmd /c "ssh-keygen -q -t ed25519 -C dmj-depuracion -N `"`" -f `"$llave`"" | Out-Null
    $publica = (Get-Content "$llave.pub" -Raw).Trim()
    $linea = "restrict,port-forwarding,permitlisten=`"$PuertoConexion`",permitlisten=`"$PuertoVinculo`",command=`"/usr/local/bin/dmj-adb-remoto`" $publica"
    Aviso 'Primera vez: escriba la contraseña de root del servidor (solo esta vez).' 'Cyan'
    $linea | ssh -o StrictHostKeyChecking=accept-new "root@$Servidor" "umask 077; mkdir -p ~/.ssh; tr -d '\r' >> ~/.ssh/authorized_keys"
    if ($LASTEXITCODE -ne 0) { Remove-Item $llave, "$llave.pub" -Force; throw 'No se pudo guardar la llave en el servidor.' }
}
if ((Remoto 'estado') -match 'Permission denied') { throw 'El servidor no acepta la llave. Borre la carpeta .ssh\dmj_depuracion* y vuelva a abrir el script.' }

# 3. Conectar y mantener.
Aviso 'Listo. Deje esta ventana abierta; Ctrl+C para terminar.' 'Green'
$tunel = $null
$destino = $null
$fallos = 0
try {
    while ($true) {
        $actual = if ($Telefono) { $Telefono } else { Buscar 'connect' }
        if (-not $actual) {
            Aviso 'Esperando el teléfono: Depuración inalámbrica activada y en la misma red o zona Wi-Fi de este PC.' 'Yellow'
            Start-Sleep -Seconds 10
            continue
        }
        if ($actual -ne $destino -or -not $tunel -or $tunel.HasExited) {
            Cerrar $tunel
            $tunel = Tunel $PuertoConexion $actual
            $destino = $actual
            Start-Sleep -Seconds 3
            $estado = Remoto 'conectar'
        } else {
            $estado = Remoto 'estado'
            if ($estado -notmatch '^device') { $estado = Remoto 'conectar' }
        }
        if ($estado -match '(?m)^device\s*$') {
            if ($fallos -gt 0 -or $estado -match 'connected') { Aviso "Teléfono conectado ($destino)." 'Green' }
            $fallos = 0
        } else {
            $fallos++
            Aviso "Sin conexión con el teléfono ($fallos): $($estado -replace '\s+', ' ')" 'Yellow'
            # Dos fallos seguidos con el teléfono a la vista: falta vincular.
            if ($fallos -ge 2 -and (Vincular)) { $destino = $null; $fallos = 0 }
        }
        Start-Sleep -Seconds 20
    }
} finally {
    Cerrar $tunel
    Aviso 'Túnel cerrado.'
}

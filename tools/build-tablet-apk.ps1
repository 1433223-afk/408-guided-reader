param(
    [string]$SdkPath = (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    [string]$JavaHome,
    [string]$BuildPython = 'python',
    [string]$GradlePath,
    [string]$SigningDirectory = (Join-Path $env:LOCALAPPDATA '408GuidedReaderAndroidTabletBuild\signing'),
    [switch]$Debuggable
)
$ErrorActionPreference = 'Stop'
$tabletRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tabletTools = Join-Path $tabletRoot '.tmp\offline-build-tools'
$tabletVersion = '0.2.0'
$gradleVersion = '9.1.0'
$gradleSha256 = 'a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806'
New-Item -ItemType Directory -Path $tabletTools -Force | Out-Null
if (-not $JavaHome) {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) {
        $JavaHome = $env:JAVA_HOME
    } else {
        $studio = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
            Where-Object DisplayName -eq 'Android Studio' | Select-Object -First 1
        if ($studio.DisplayIcon) { $JavaHome = Join-Path (Split-Path (Split-Path $studio.DisplayIcon.Trim('"') -Parent) -Parent) 'jbr' }
    }
}
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\javac.exe'))) { throw 'Pass -JavaHome with JDK 17 or newer.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-37.0\android.jar'))) { throw 'Android SDK Platform 37.0 is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $tabletRoot 'node_modules\pdfjs-dist\build\pdf.mjs'))) { throw 'Run npm ci before packaging the shared Reader.' }
if (-not $GradlePath) {
    $GradlePath = Join-Path $tabletTools "gradle-$gradleVersion\bin\gradle.bat"
    if (-not (Test-Path -LiteralPath $GradlePath)) {
        $archive = Join-Path $tabletTools "gradle-$gradleVersion-bin.zip"
        $downloaded = $false
        foreach ($source in @("https://downloads.gradle.org/distributions/gradle-$gradleVersion-bin.zip", "https://mirrors.cloud.tencent.com/gradle/gradle-$gradleVersion-bin.zip")) {
            try {
                Invoke-WebRequest -Uri $source -OutFile $archive -TimeoutSec 180
                if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $gradleSha256) { throw 'Gradle checksum mismatch' }
                $downloaded = $true
                break
            } catch { Write-Warning 'Gradle download failed or checksum mismatched; trying the next source.' }
        }
        if (-not $downloaded) { throw 'Could not obtain the verified Gradle distribution. Pass -GradlePath.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $tabletTools -Force
    }
}
$tabletSigning = [IO.Path]::GetFullPath($SigningDirectory)
New-Item -ItemType Directory -Path $tabletSigning -Force | Out-Null
$tabletKey = Join-Path $tabletSigning 'tablet-demo.keystore'
$previousKey = Join-Path $tabletRoot '.tmp\android-signing\tablet-demo.keystore'
if (-not (Test-Path -LiteralPath $tabletKey) -and (Test-Path -LiteralPath $previousKey)) { Copy-Item -LiteralPath $previousKey -Destination $tabletKey }
if (-not (Test-Path -LiteralPath $tabletKey)) {
    & (Join-Path $JavaHome 'bin\keytool.exe') -genkeypair -keystore $tabletKey -storepass android -keypass android -alias tablet-demo -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Guided Reader Tablet Demo,O=Guided Reader,C=CN'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local demo signing identity.' }
}
$savedJava = $env:JAVA_HOME
$savedAndroid = $env:ANDROID_HOME
$savedGradle = $env:GRADLE_USER_HOME
try {
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $SdkPath
    $env:GRADLE_USER_HOME = Join-Path $tabletTools 'gradle-user-home'
    $variant = if ($Debuggable) { 'Debug' } else { 'Release' }
    & $GradlePath -p (Join-Path $tabletRoot 'android') "-PreaderBuildPython=$BuildPython" "-PreaderSigningDirectory=$tabletSigning" ":app:assemble$variant" --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Offline Android APK build failed.' }
} finally {
    $env:JAVA_HOME = $savedJava
    $env:ANDROID_HOME = $savedAndroid
    $env:GRADLE_USER_HOME = $savedGradle
}
$variantPath = $variant.ToLowerInvariant()
$builtApk = Join-Path $tabletRoot "android\app\build\outputs\apk\$variantPath\app-$variantPath.apk"
$artifacts = Join-Path $tabletRoot 'dist\android'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$suffix = if ($Debuggable) { '-qa' } else { '' }
$tabletApk = Join-Path $artifacts "GuidedReader-Tablet-$tabletVersion$suffix.apk"
Copy-Item -LiteralPath $builtApk -Destination $tabletApk -Force
& (Join-Path $JavaHome 'bin\java.exe') --enable-native-access=ALL-UNNAMED -jar (Join-Path $SdkPath 'build-tools\36.0.0\lib\apksigner.jar') verify --verbose $tabletApk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$tabletHash = (Get-FileHash -LiteralPath $tabletApk -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($tabletApk+'.sha256'),($tabletHash+'  '+[IO.Path]::GetFileName($tabletApk)+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
if (-not $Debuggable) { Copy-Item -LiteralPath $tabletApk -Destination (Join-Path $artifacts 'GuidedReader-Tablet.apk') -Force }
Write-Output "Offline APK ready: $tabletApk"
Write-Output "SHA256: $tabletHash"
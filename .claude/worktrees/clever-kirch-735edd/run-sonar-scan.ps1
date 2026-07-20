Write-Host "Iniciando entorno de auditoría SonarQube..." -ForegroundColor Cyan

# Levantar el servidor
docker compose -f docker-compose.sonar.yml up -d sonarqube

Write-Host "Esperando a que SonarQube arranque. Esto puede tardar 2-3 minutos..." -ForegroundColor Yellow

# Bucle para verificar que el servidor está listo
$isReady = $false
while (-not $isReady) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:9000/api/system/status" -ErrorAction Stop
        if ($response.status -eq "UP") {
            $isReady = $true
            Write-Host "¡SonarQube está listo!" -ForegroundColor Green
        } else {
            Start-Sleep -Seconds 10
            Write-Host "." -NoNewline
        }
    } catch {
        Start-Sleep -Seconds 10
        Write-Host "." -NoNewline
    }
}

Write-Host ""
Write-Host "Iniciando escaneo estático de código (SAST)..." -ForegroundColor Cyan

# Ejecutar el escáner
docker compose -f docker-compose.sonar.yml run --rm sonar-scanner

Write-Host "=========================================================" -ForegroundColor Green
Write-Host "¡Auditoría completada exitosamente!" -ForegroundColor Green
Write-Host "Abre tu navegador en: http://localhost:9000" -ForegroundColor Cyan
Write-Host "Usuario por defecto: admin"
Write-Host "Contraseña por defecto: admin"
Write-Host "=========================================================" -ForegroundColor Green

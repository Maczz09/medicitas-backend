# MediCitas Backend 🏥

El backend de **MediCitas** es un sistema de gestión clínica construido bajo la filosofía de **Monolito Modular** utilizando **Clean Architecture** y **Domain-Driven Design (DDD)**. El sistema integra múltiples dominios de negocio (Citas, Pacientes, Historia Clínica, Auth, Facturación, etc.) asegurando un alto grado de desacoplamiento a través de una **Arquitectura Orientada a Eventos (EDA)** con RabbitMQ y el patrón Outbox.

## 🚀 Tecnologías Principales

- **Plataforma:** Node.js (v22+)
- **Framework Web:** Express.js
- **Base de Datos Relacional:** MySQL 8 (Múltiples schemas lógicos por dominio)
- **Caché y Rate Limiting:** Redis
- **Message Broker (Eventos Asíncronos):** RabbitMQ
- **Orquestación y Despliegue:** Docker y Docker Compose
- **Documentación API:** Swagger (OpenAPI 3.0)

---

## 🛠️ Requisitos Previos

Asegúrate de tener instalados los siguientes programas en tu entorno local:
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) o Docker Engine
- Git

---

## ⚙️ Instalación y Ejecución Local

Todo el ecosistema está contenerizado para que puedas levantarlo con un solo comando sin tener que instalar bases de datos en tu máquina local.

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/Maczz09/medicitas-backend.git
   cd medicitas-backend
   ```

2. **Configurar Variables de Entorno**
   Copia el archivo de ejemplo para crear tu propio archivo `.env`:
   ```bash
   cp .env.example .env
   ```
   *(Si estás en Windows, puedes simplemente duplicar el archivo `.env.example` y renombrarlo a `.env`)*.

3. **Levantar la Infraestructura (Base de datos, Caché, Broker y Backend)**
   ```bash
   docker-compose up -d
   ```
   *Nota: La primera vez que lo ejecutes tomará unos minutos mientras descarga las imágenes de MySQL, Redis, RabbitMQ y construye la imagen del backend.*

4. **Verificar que el sistema esté corriendo**
   Abre tu navegador y entra a:
   👉 **http://localhost/api-docs/**
   
   Allí verás la documentación interactiva (Swagger) de todos los módulos y podrás probar los endpoints.

---

## 🗺️ Estructura de Módulos (Rutas Principales)

El backend expone su API a través del proxy inverso (Nginx) en el puerto `80`. Todos los endpoints tienen el prefijo `/api/v1`.

### 🛡️ 1. Módulo de Seguridad (Auth) `svc_auth`
- `POST /api/v1/auth/login` - Inicio de sesión (Retorna JWT).
- `POST /api/v1/auth/refresh` - Renovar un token JWT expirado.
- `POST /api/v1/auth/forgot-password` - Solicitar reseteo de clave vía correo electrónico.
- `POST /api/v1/auth/reset-password` - Validar OTP y cambiar la contraseña.

### 👥 2. Módulo de Pacientes `svc_pac`
- `POST /api/v1/pacientes` - Registrar un paciente (DNI, CE, Pasaporte).
- `GET /api/v1/pacientes/:id` - Consultar datos demográficos de un paciente.
- `PUT /api/v1/pacientes/:id` - Actualizar información del paciente.
- `DELETE /api/v1/pacientes/:id` - Soft delete del paciente.

### 📅 3. Módulo de Citas Médicas `svc_cit`
- `POST /api/v1/citas` - Reservar una nueva cita médica.
- `GET /api/v1/citas/:id` - Obtener información de la cita.
- `POST /api/v1/citas/:id/cancelar` - Cancelar una cita médica.

### 🩺 4. Módulo de Historia Clínica `svc_hcl`
- `POST /api/v1/historias-clinicas/:idPaciente/encuentros` - Registrar una atención médica o encuentro clínico (requiere una cita *EnCurso*). Crea el diagnóstico clínico y encola la generación de prescripciones.
- `GET /api/v1/historias-clinicas/:idPaciente/resumen` - Consultar el resumen del historial médico del paciente, alergias y últimas atenciones.

---

## 💡 Patrones de Arquitectura Implementados

1. **Monolito Modular:** El código vive en un solo repositorio y corre bajo un mismo proceso de Node.js, pero internamente está estrictamente dividido en carpetas `/src/modules/` por contexto (Bounded Contexts).
2. **Clean Architecture:** Separación por capas (`domain`, `application`, `infrastructure`, `adapters`). Las reglas de negocio no dependen de Express ni de MySQL.
3. **Múltiples Schemas DB:** Aunque hay un solo servidor MySQL corriendo, existen múltiples bases de datos lógicas (`svc_auth`, `svc_pac`, `svc_cit`, `svc_hcl`) para evitar acoplamiento de tablas entre dominios.
4. **Patrón Outbox y RabbitMQ:** Para lograr consistencia eventual. En lugar de comunicarse directamente, el módulo A guarda un evento en su tabla `outbox` local, un Worker lo lee asíncronamente y lo dispara a RabbitMQ, de donde el módulo B lo consume.
5. **Autenticación Interna S2S:** Para casos donde es estrictamente necesaria la lectura síncrona entre módulos (ej. Historia Clínica validando si la Cita existe), se utiliza un token S2S (`INTERNAL_SERVICE_TOKEN`) en el middleware, simulando una arquitectura de microservicios puros.

---

### Comandos Útiles

**Ver logs del backend en tiempo real:**
```bash
docker logs -f medicitas_backend
```

**Apagar la infraestructura:**
```bash
docker-compose down
```

**Reiniciar solo el backend (para aplicar cambios de código localmente):**
```bash
docker restart medicitas_backend
```

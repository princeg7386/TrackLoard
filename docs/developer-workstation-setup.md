# Developer Workstation Setup & Audit Report

## 1. Workstation Audit Summary (Current Machine)

| Tool / Runtime | Status | Detected Version / Path | Action Required |
| :--- | :--- | :--- | :--- |
| **Git** | ✅ **Installed** | `v2.51.0.windows.1` | None |
| **VS Code / IDE** | ✅ **Installed** | `C:\Users\princ\AppData\Local\Programs\Microsoft VS Code\bin\code` | Recommended extensions listed below |
| **Node.js** | ✅ **Installed** | `v22.17.1` (Current LTS) | None |
| **npm** | ✅ **Installed** | `10.9.2` | None |
| **Docker Desktop** | ⚠️ **Optional / To Install** | Not in PATH (`winget install Docker.DockerDesktop`) | Required when running containerized PostGIS locally |
| **Flutter SDK** | ⚠️ **Optional / To Install** | Not in PATH (`winget install Google.Flutter`) | Required for building the Driver Android APK |
| **Android Studio / SDK**| ⚠️ **Optional / To Install** | Not in PATH (`winget install Google.AndroidStudio`) | Required for Android emulator & Gradle compilation |

---

## 2. One-Command Setup Guide (Using Windows Package Manager `winget`)

If you wish to install Docker Desktop, Flutter SDK, and Android Studio automatically on this machine, run the following PowerShell command:

```powershell
# 1. Install Docker Desktop (PostGIS container runtime)
winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements

# 2. Install Flutter SDK
winget install -e --id Google.Flutter --accept-source-agreements --accept-package-agreements

# 3. Install Android Studio (Android SDK & Build Tools)
winget install -e --id Google.AndroidStudio --accept-source-agreements --accept-package-agreements
```

---

## 3. Recommended VS Code Extensions

For the best developer experience across TypeScript, Next.js, and Flutter:

- **TypeScript / React / Next.js:**
  - `dbaeumer.vscode-eslint` — ESLint
  - `esbenp.prettier-vscode` — Prettier Formatter
  - `bradlc.vscode-tailwindcss` — Tailwind CSS IntelliSense
  - `Prisma.prisma` — Prisma ORM schema formatting & linting (if Prisma/Drizzle is selected)
- **Mobile Development:**
  - `Dart-Code.dart-code` — Dart Language Support
  - `Dart-Code.flutter` — Flutter Framework Tools
- **Database & PostGIS:**
  - `cweijan.vscode-database-client2` — Database Client (PostgreSQL / PostGIS spatial viewer)

---

## 4. Environment Variables Checklist
Ensure the following are added to user/system `PATH` once installed:
```powershell
# Android Home
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")

# Path updates (if not automatically configured by installer)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$userPath;C:\flutter\bin", "User")
```

<div align="center">

# 🛡️ Homeserver Ops

**Enterprise-Grade Homelab Observability Center & Sandboxed AI Companion**

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-black.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/flask-3.0+-black.svg?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Docker](https://img.shields.io/badge/docker-ready-black.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Security Hardened](https://img.shields.io/badge/Security-Hardened%20(A%2B)-black.svg?style=for-the-badge&logo=shield&logoColor=white)](#-security--threat-model)

<p align="center">
  A high-performance, single-pane-of-glass server control dashboard engineered for Linux homelabs and VPS nodes.<br>
  Features sub-millisecond cached telemetry, real-time Docker inspection, NVMe/SATA SMART thermals, journal error triage, and an isolated, guest-friendly AI conversational assistant.
</p>

[Key Features](#-features) •
[Quickstart](#-quickstart) •
[Security Architecture](#-security--threat-model) •
[API Reference](#-api-reference) •
[Contributing](#-contributing)

</div>

---

## ⚡ Why Homeserver Ops?

Most homelab monitoring dashboards fall into one of two traps:
1. **Bloated & Resource-Hungry:** Heavy stacks (Prometheus + Grafana + Telegraf) consuming gigabytes of RAM and constant disk I/O.
2. **Insecure by Default:** Web interfaces that broadcast raw listening ports, internal IP topology, container networks, and hostnames to anyone on the network.

**Homeserver Ops** takes a radically different approach:
- **Zero-Overhead Asynchronous Engine:** A background daemon caches all system metrics every 2–3 seconds. HTTP requests serve directly from memory in **< 0.5 milliseconds** with 0% CPU impact on web requests.
- **Pure Black (#0a0a0a) Design System:** High-contrast, dark-mode terminal aesthetic with zero external CSS/JS dependencies. Fast, mobile-responsive, and clean.
- **Zero-Recon Security:** All sensitive attack surfaces (open ports, bind IPs, local usernames, Docker host port mappings) are masked from the public UI.
- **Sandboxed AI Companion:** Embeds Hermes Agent in an unprivileged, read-only guest sandbox (`webchat`). Visitors can ask questions without having access to shell tools, VPS execution, or server credentials.

---

## 📸 Architecture Overview

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          HOMESERVER OPS                                │
│                                                                        │
│   ┌─────────────────────┐               ┌──────────────────────────┐   │
│   │   Browser Client    │ ◄── HTTP ───► │ Flask Web Engine (:9090) │   │
│   │  (Clean Black UI)   │ (JSON/HTML)   │  - Strict CSP / HSTS     │   │
│   └─────────────────────┘               │  - Token Bucket Rate Lmt │   │
│                                         └────────────┬─────────────┘   │
│                                                      │                 │
│                 ┌────────────────────────────────────┼─────────────┐   │
│                 ▼                                    ▼             ▼   │
│   ┌───────────────────────────┐     ┌───────────────────┐ ┌────────┐   │
│   │ Async Telemetry Collector │     │ Hermes AI Sandbox │ │ Docker │   │
│   │  - NVMe / SATA hwmon      │     │  - Read-Only Mode │ │ Engine │   │
│   │  - CPU Package & Cores    │     │  - Zero Terminal  │ │ Socket │   │
│   │  - Systemd Journal Errors │     │  - Rate Limited   │ └────────┘   │
│   │  - RAM / Disk Capacities  │     └───────────────────┘              │
│   └───────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Features

### 🖥️ 1. Real-Time Hardware & System Telemetry
- **CPU & Load:** Overall load percentage, core-by-core load distribution, and temperature monitoring.
- **Hardware Thermals:** Exact NVMe SSD temps via `hwmon`, SATA HDD temps via SMART, PCH chipset, and CPU package sensors.
- **Storage Metrics:** Live mount point analysis (`/`, `/mnt/*`), used/total capacity, and percentage gauges.
- **Memory Tracking:** Active vs. buffer/cache memory breakdown.

### 🐳 2. Complete Docker Container Supervision
- Real-time container statuses (`running`, `healthy`, `unhealthy`, `exited`).
- Memory usage with live limit calculation and utilization progress bars.
- Live CPU percentage, Block I/O, and Network I/O metrics.
- **In-Browser Container Log Inspection:** Inspect the last 100 lines of any container with one click.

### 🤖 3. Sandboxed Hermes AI Companion
- Interactive conversational interface directly in the dashboard.
- **Guest-Safe & Read-Only:** Stripped of bash, terminal tools, and file execution capabilities. Safe for public or shared networks.
- Injects high-level public telemetry context so visitors can inquire about server health without internal reconnaissance.

### 🔍 4. Incident Triage & Error Detection
- Automated journal parsing for system errors (`priority 0–3`).
- Automatic detection and counting of Kernel Out-Of-Memory (OOM) killer events.
- Failed systemd units detection with instant diagnosis snippets.

### 🛡️ 5. Network & Service Registry
- Active monitoring of system daemons, Docker proxies, and PM2 application managers.
- Privacy-first display: classifies scope (Loopback vs. Network) without exposing vulnerable port numbers.

### 📱 6. Mobile-First & Progressive Web App (PWA)
- **Installable PWA:** Add directly to home screen on iOS, Android, and Desktop with standalone window experience and custom 192/512/maskable icons.
- **Offline Shell Caching:** Service Worker (`sw.js`) pre-caches HTML, CSS, JS, and branding assets for instant loading.
- **Phone Optimized:** Touch-friendly tap targets (≥44px), horizontal swipeable navigation tabs, iOS viewport zoom prevention (16px inputs), and safe-area inset support.

---

## 🚀 Quickstart

### Prerequisites
- **Linux OS** (Ubuntu 22.04+, Debian 12+, Fedora, Arch)
- **Python 3.10+**
- **Docker** (optional, for container monitoring)
- `smartmontools` (optional, for SATA HDD temperatures)

### One-Line Automated Setup

Clone and run the automated installer:

```bash
git clone https://github.com/hyperdargo/Homeserver-OPS.git
cd Homeserver-OPS
chmod +x install.sh
./install.sh
```

The script automatically creates an isolated systemd user service with linger enabled, configures auto-restart, and binds to port `9090`.

### Manual Installation

1. **Clone repository:**
   ```bash
   git clone https://github.com/hyperdargo/Homeserver-OPS.git
   cd Homeserver-OPS
   ```

2. **Install Python requirements:**
   ```bash
   pip3 install -r requirements.txt
   ```

3. **Start the server:**
   ```bash
   python3 app.py
   ```
   Open your browser at `http://localhost:9090`.

---

## 🔒 Security & Threat Model

Homeserver Ops adheres to strict defense-in-depth principles:

| Defense Layer | Implementation Detail |
| :--- | :--- |
| **Data Minimization** | Raw listening ports, internal IP addresses, and private usernames are masked from UI and API payloads. |
| **HTTP Security Headers** | Hardened `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `HSTS`, `Referrer-Policy: no-referrer`. |
| **Rate Limiting** | Sliding window rate limiting: **10 req/min** on AI chat, **120 req/min** on telemetry polling. |
| **AI Sandboxing** | Web chat executes in `/tmp` using isolated profile `webchat` with zero tool permissions. |
| **Input Validation** | Strict regex filtering on log query parameters to eliminate directory traversal and command injection. |
| **Payload Capping** | Max request body size capped at 32 KB to mitigate buffer overflow / memory exhaustion. |

For full security documentation, see [SECURITY.md](SECURITY.md).

---

## 📡 API Reference

All endpoints return JSON and are cached in memory for sub-millisecond responses.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/overview` | Core system overview (CPU, RAM, Disks, Docker count, Uptime). |
| `GET` | `/api/docker` | Detailed container metrics (CPU, RAM %, limits, net/block I/O). |
| `GET` | `/api/services` | Active systemd services, PM2 processes, and sanitized network registry. |
| `GET` | `/api/storage` | Partitions, filesystem types, and drive temperatures. |
| `GET` | `/api/errors` | Recent system journal errors and Kernel OOM events. |
| `GET` | `/api/logs/container?name=<id>` | Real-time container log output (last 100 lines). |
| `POST` | `/api/hermes/chat` | Safe conversational endpoint powered by sandboxed AI companion. |

---

## 🛠️ Configuration & Systemd

Homeserver Ops is configured to run effortlessly as a systemd user unit:

```bash
# Check status
systemctl --user status homeserver-ops.service

# Restart
systemctl --user restart homeserver-ops.service

# View live application logs
journalctl --user -u homeserver-ops.service -f
```

---

## 🤝 Contributing

Contributions, bug reports, and feature proposals are welcome!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

---

<div align="center">
  <sub>Engineered by <a href="https://github.com/hyperdargo">Ankit Gupta (HyperDargo)</a> &bull; Designed for high-reliability Linux Homelabs.</sub>
</div>

# Security Policy & Architecture

## Security Philosophy

Homeserver Ops is designed with a **defense-in-depth, zero-trust mindset** suitable for public or shared homelab infrastructure. Observability shouldn't come at the cost of exposing attack vectors to casual visitors, friends, or automated scanners.

---

## Security Guarantees & Built-in Defenses

### 1. Data Minimization & Anti-Reconnaissance
- **Port Masking:** Raw listening ports (e.g., MySQL, Redis, SSH, internal microservices) are masked from the public UI. The dashboard displays classified service components and status without revealing specific listening ports or local binding addresses.
- **Identity Obfuscation:** Internal IP addresses (LAN, VPN, overlay subnets) and local usernames/hostnames are anonymized to prevent network mapping.
- **Docker Port Isolation:** Raw port forward strings (`0.0.0.0:xxxx->yyyy/tcp`) are sanitized to prevent container enumeration.

### 2. AI Companion Sandboxing (`webchat`)
- **Zero Tool Execution:** The embedded web companion runs on an isolated Hermes profile completely stripped of tools (`terminal`, `execute_code`, `write_file`, `patch`, `read_file`, `browser_exec`).
- **Read-Only System Context:** The assistant receives only high-level telemetry indicators (CPU load %, memory usage %, container count) via prompt injection.
- **Restricted Working Directory:** Subprocess execution is locked to `/tmp` with unprivileged execution.
- **Strict Anti-Hacking Guardrails:** Refuses attempts to dump `.env` files, read credentials, execute reverse shells, or conduct offensive security against internal or external infrastructure.

### 3. HTTP Security Headers
All HTTP responses include hardened enterprise-grade headers:
- `Content-Security-Policy (CSP)`: Strict default-src 'self', blocks clickjacking (`frame-ancestors 'none'`), script injection, and object loading.
- `X-Frame-Options: DENY`: Prevents UI redressing and iframe embedding.
- `X-Content-Type-Options: nosniff`: Mitigates MIME type confusion attacks.
- `Strict-Transport-Security (HSTS)`: Enforces TLS when fronted by HTTPS proxies.
- `Referrer-Policy: no-referrer`: Prevents leaking URL paths in outbound requests.
- `Permissions-Policy`: Restricts access to client hardware APIs (camera, microphone, geolocation).
- `Server Obfuscation`: Strips default server banners to avoid framework fingerprinting.

### 4. Rate Limiting & DoS Prevention
- **Chat Endpoint:** Rate-limited to **10 requests/minute per client IP** to prevent LLM token exhaustion and resource starvation.
- **Telemetry Endpoints:** Sliding window token bucket limiting telemetry polling to prevent background thread starvation.
- **Payload Restrictions:** Request bodies are strictly capped at 32 KB to prevent buffer overruns and memory exhaustion attacks.

---

## Reporting a Vulnerability

If you discover a potential security flaw in Homeserver Ops:
1. Do **NOT** open a public issue on GitHub.
2. Report the vulnerability privately to [Ankit Gupta](https://github.com/hyperdargo) via GitHub Security Advisories or direct message.
3. Include detailed steps to reproduce and any relevant proof-of-concept.
4. We aim to acknowledge and address confirmed security issues within 48 hours.

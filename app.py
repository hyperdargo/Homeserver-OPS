"""
Hermes Pulse / Server Ops Dashboard
Production-grade server monitoring and management dashboard.
Strict black & white operational UI, real-time Docker/Hermes/System telemetry.
"""

import os
import re
import subprocess
import shutil
import time
from flask import Flask, jsonify, request, render_template, send_from_directory
import collector

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024  # 32 KB max request body

class SecurityHeaderMiddleware:
    """WSGI middleware to suppress server fingerprinting and enforce security."""
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        def custom_start_response(status, headers, exc_info=None):
            cleaned = [(k, v) for (k, v) in headers if k.lower() != 'server']
            cleaned.append(('Server', 'Protected-Node'))
            return start_response(status, cleaned, exc_info)
        return self.wsgi_app(environ, custom_start_response)

app.wsgi_app = SecurityHeaderMiddleware(app.wsgi_app)

# Start metrics background updater
collector.start_collector_thread()

# Regex for safe input parameters (alphanumeric, dots, dashes, underscores)
SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_\.\-]+$")

# In-memory sliding-window IP rate limiter
_RATE_LIMITS = {}
_RATE_WINDOW = 60  # seconds

def is_rate_limited(limit_type="general", max_requests=120):
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr or "127.0.0.1").split(",")[0].strip()
    now = time.time()
    bucket_key = f"{client_ip}:{limit_type}:{int(now // _RATE_WINDOW)}"
    
    current_count = _RATE_LIMITS.get(bucket_key, 0)
    if current_count >= max_requests:
        return True
    
    _RATE_LIMITS[bucket_key] = current_count + 1
    
    # Garbage collect older buckets periodically
    if len(_RATE_LIMITS) > 1000:
        cutoff = (now - _RATE_WINDOW * 2) // _RATE_WINDOW
        for k in list(_RATE_LIMITS.keys()):
            try:
                if int(k.split(":")[-1]) < cutoff:
                    del _RATE_LIMITS[k]
            except Exception:
                pass
    return False

@app.before_request
def enforce_rate_limits():
    # Enforce strict 10 req/min for AI chat to prevent prompt flooding / resource exhaustion
    if request.path == "/api/hermes/chat":
        if is_rate_limited(limit_type="chat", max_requests=10):
            return jsonify({
                "status": "error",
                "message": "Rate limit exceeded. Max 10 messages per minute. Please slow down."
            }), 429
    elif request.path.startswith("/api/"):
        if is_rate_limited(limit_type="api", max_requests=120):
            return jsonify({
                "status": "error",
                "message": "Too many requests. Please wait a moment."
            }), 429

@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "font-src 'self'; "
        "worker-src 'self'; "
        "manifest-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Server"] = "Protected-Node"
    return response

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/manifest.json")
@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory(app.static_folder, "manifest.json", mimetype="application/manifest+json")

@app.route("/sw.js")
def service_worker():
    response = send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response

@app.route("/favicon.ico")
def favicon():
    return send_from_directory(app.static_folder, "favicon.png", mimetype="image/png")

@app.route("/api/overview")
def api_overview():
    data = collector.get_cached_data("overview")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "data": data
    })

@app.route("/api/docker")
def api_docker():
    data = collector.get_cached_data("docker")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "count": len(data),
        "data": data
    })

@app.route("/api/hermes")
def api_hermes():
    data = collector.get_cached_data("hermes")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "data": data
    })

@app.route("/api/services")
def api_services():
    data = collector.get_cached_data("services")
    ports = collector.get_cached_data("ports")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "services": data,
        "ports": ports
    })

@app.route("/api/storage")
def api_storage():
    data = collector.get_cached_data("storage")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "data": data
    })

@app.route("/api/errors")
def api_errors():
    data = collector.get_cached_data("errors")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "data": data
    })

@app.route("/api/top_processes")
def api_top_processes():
    data = collector.get_cached_data("top_processes")
    return jsonify({
        "status": "success",
        "timestamp": collector.get_cached_data("timestamp"),
        "data": data
    })

@app.route("/api/logs")
def api_logs():
    """
    Safely retrieves system logs using journalctl.
    """
    unit = request.args.get("unit", "").strip()
    try:
        lines = min(max(int(request.args.get("lines", 100)), 10), 500)
    except ValueError:
        lines = 100
    
    cmd = ["journalctl", "-n", str(lines), "--no-pager"]
    
    if unit:
        if not SAFE_NAME_RE.match(unit):
            return jsonify({"status": "error", "message": "Invalid unit name"}), 400
        cmd.extend(["-u", unit])
    
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=4.0)
        output = res.stdout if res.returncode == 0 else res.stderr
        return jsonify({
            "status": "success",
            "unit": unit or "system",
            "lines": lines,
            "logs": output
        })
    except subprocess.TimeoutExpired:
        return jsonify({"status": "error", "message": "Log query timed out"}), 504
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/container_logs/<name>")
def api_container_logs(name):
    """
    Safely retrieves docker container logs.
    """
    name = name.strip()
    if not SAFE_NAME_RE.match(name):
        return jsonify({"status": "error", "message": "Invalid container name"}), 400
    
    try:
        lines = min(max(int(request.args.get("lines", 100)), 10), 500)
    except ValueError:
        lines = 100
    
    cmd = ["docker", "logs", "--tail", str(lines), name]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=4.0)
        # docker logs may write to stdout or stderr depending on container
        output = (res.stdout + ("\n" + res.stderr if res.stderr else "")).strip()
        return jsonify({
            "status": "success",
            "container": name,
            "lines": lines,
            "logs": output
        })
    except subprocess.TimeoutExpired:
        return jsonify({"status": "error", "message": "Docker logs query timed out"}), 504
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/hermes/chat", methods=["POST"])
def api_hermes_chat():
    """
    Secure public/guest conversational interface powered by Hermes.
    Uses the isolated 'webchat' profile:
    - Zero server execution, terminal, or shell access.
    - Zero file editing or filesystem modification.
    - Zero access to .env, credentials, passwords, or tokens.
    - Strict refusal of hacking, penetration testing, or exploit commands.
    - Runs in /tmp with a safe timeout.
    """
    try:
        data = request.get_json(silent=True) or {}
        message = str(data.get("message", "")).strip()
        if not message:
            return jsonify({"status": "error", "message": "Empty message provided"}), 400
        
        if len(message) > 2000:
            return jsonify({"status": "error", "message": "Message exceeds 2000 characters limit"}), 400

        hermes_bin = "/home/dargo/.hermes/hermes-agent/venv/bin/hermes"
        if not os.path.exists(hermes_bin):
            hermes_bin = shutil.which("hermes") or "hermes"

        # Safely inject high-level public telemetry without exposing any private IPs or secrets
        overview = collector.get_cached_data("overview") or {}
        cpu = overview.get("cpu", {}) if isinstance(overview, dict) else {}
        mem = overview.get("memory", {}) if isinstance(overview, dict) else {}
        docker_data = collector.get_cached_data("docker") or []
        active_containers = len(docker_data) if isinstance(docker_data, list) else 0

        prompt_with_context = (
            f"[Dashboard Public Telemetry: CPU={cpu.get('percent', 0)}%, "
            f"RAM={mem.get('percent', 0)}% ({mem.get('used_gib', 0)}/{mem.get('total_gib', 0)} GiB), "
            f"Active_Containers={active_containers}]\n\n"
            f"User message: {message}"
        )

        t0 = time.time()
        res = subprocess.run(
            [hermes_bin, "-p", "webchat", "-z", prompt_with_context],
            capture_output=True,
            text=True,
            timeout=70,
            cwd="/tmp"
        )
        duration = time.time() - t0
        
        output = res.stdout.strip()
        if not output and res.stderr:
            output = res.stderr.strip()
            
        return jsonify({
            "status": "success",
            "reply": output or "Hello! I am online and ready to chat. How can I help you?",
            "duration_s": round(duration, 2),
            "returncode": res.returncode
        })
    except subprocess.TimeoutExpired:
        return jsonify({
            "status": "error",
            "message": "Hermes response took longer than expected (70s limit). Please try asking again."
        }), 504
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/health")
def api_health():
    uptime = collector.get_system_uptime()
    return jsonify({
        "status": "healthy",
        "app": "Homeserver Ops",
        "uptime": uptime["formatted"],
        "timestamp": collector.get_cached_data("timestamp")
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 9090))
    print(f"Starting Homeserver Ops Dashboard on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)

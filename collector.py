"""
Server Dashboard - Hardware & Metrics Collector
Collects Docker, Hermes, Systemd, CPU/RAM, Storage, Temperatures, Network, and Errors.
Caches state in a background thread to guarantee sub-millisecond API responses.
"""

import os
import time
import json
import glob
import psutil
import datetime
import threading
import subprocess
import re
import shutil

# Global thread-safe state cache
_CACHE_LOCK = threading.Lock()
_CACHE = {
    "timestamp": 0,
    "overview": {},
    "docker": [],
    "hermes": {},
    "services": {},
    "storage": {},
    "errors": {},
    "ports": [],
    "top_processes": []
}

def get_cpu_info():
    try:
        model = "Unknown CPU"
        with open("/proc/cpuinfo") as f:
            for line in f:
                if "model name" in line:
                    model = line.split(":", 1)[1].strip()
                    break
        
        cpu_pct = psutil.cpu_percent(interval=None)
        cpu_cores = psutil.cpu_percent(percpu=True, interval=None)
        load_1, load_5, load_15 = os.getloadavg()
        
        return {
            "model": model,
            "core_count": psutil.cpu_count(logical=True),
            "physical_core_count": psutil.cpu_count(logical=False),
            "usage_percent": round(cpu_pct, 1),
            "cores": [round(c, 1) for c in cpu_cores],
            "load_avg": [round(load_1, 2), round(load_5, 2), round(load_15, 2)]
        }
    except Exception as e:
        return {"error": str(e), "usage_percent": 0, "cores": [], "load_avg": [0, 0, 0]}

def get_memory_info():
    try:
        v = psutil.virtual_memory()
        s = psutil.swap_memory()
        return {
            "total_bytes": v.total,
            "used_bytes": v.used,
            "free_bytes": v.free,
            "available_bytes": v.available,
            "cached_bytes": getattr(v, "cached", 0),
            "buffers_bytes": getattr(v, "buffers", 0),
            "shared_bytes": getattr(v, "shared", 0),
            "percent": round(v.percent, 1),
            "swap_total_bytes": s.total,
            "swap_used_bytes": s.used,
            "swap_free_bytes": s.free,
            "swap_percent": round(s.percent, 1)
        }
    except Exception as e:
        return {"error": str(e), "percent": 0, "swap_percent": 0}

_LAST_HDD_TEMP = 51.0
_LAST_HDD_TIME = 0

def get_temperatures():
    global _LAST_HDD_TEMP, _LAST_HDD_TIME
    """
    Reads hardware sensors from /sys/class/hwmon:
    - NVMe drive temp
    - CPU Package & individual Core temperatures
    - PCH chipset
    - ACPI zone
    - Also queries /dev/sda HDD temperature via smartctl (cached)
    """
    temps = {
        "nvme": [],
        "cpu": [],
        "pch": [],
        "acpi": [],
        "hdd": [],
        "highest_temp": 0.0
    }
    
    try:
        for hw in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
            hw_name = ""
            name_path = os.path.join(hw, "name")
            if os.path.exists(name_path):
                try:
                    with open(name_path) as nf:
                        hw_name = nf.read().strip()
                except Exception:
                    pass
            
            for tf in sorted(glob.glob(os.path.join(hw, "temp*_input"))):
                lbl_file = tf.replace("_input", "_label")
                lbl = os.path.basename(tf).replace("_input", "")
                if os.path.exists(lbl_file):
                    try:
                        with open(lbl_file) as lf:
                            lbl = lf.read().strip()
                    except Exception:
                        pass
                
                try:
                    with open(tf) as f:
                        val = round(int(f.read().strip()) / 1000.0, 1)
                        if val > temps["highest_temp"]:
                            temps["highest_temp"] = val
                        item = {"label": lbl, "temp_c": val, "sensor": hw_name}
                        
                        if "nvme" in hw_name:
                            temps["nvme"].append(item)
                        elif "coretemp" in hw_name:
                            temps["cpu"].append(item)
                        elif "pch" in hw_name:
                            temps["pch"].append(item)
                        elif "acpi" in hw_name:
                            temps["acpi"].append(item)
                        else:
                            temps["cpu"].append(item)
                except Exception:
                    pass
    except Exception:
        pass
    
    # Query SATA HDD /dev/sda temperature via sudo -n smartctl (cached for 60s)
    now = time.time()
    if now - _LAST_HDD_TIME < 60 and _LAST_HDD_TEMP is not None:
        temps["hdd"].append({
            "label": "/dev/sda (Mass Storage)",
            "temp_c": _LAST_HDD_TEMP,
            "sensor": "smartctl (cached)"
        })
        if _LAST_HDD_TEMP > temps["highest_temp"]:
            temps["highest_temp"] = _LAST_HDD_TEMP
    else:
        try:
            res = subprocess.run(
                ["sudo", "-n", "smartctl", "-A", "/dev/sda"],
                capture_output=True, text=True, timeout=1.5
            )
            if res.returncode == 0:
                for line in res.stdout.splitlines():
                    if "Temperature_Celsius" in line or "194 Temperature" in line:
                        parts = line.split()
                        if len(parts) >= 10:
                            raw_temp = float(parts[9])
                            _LAST_HDD_TEMP = raw_temp
                            _LAST_HDD_TIME = now
                            temps["hdd"].append({
                                "label": "/dev/sda (Mass Storage)",
                                "temp_c": raw_temp,
                                "sensor": "smartctl"
                            })
                            if raw_temp > temps["highest_temp"]:
                                temps["highest_temp"] = raw_temp
                        break
        except Exception:
            pass
    
    return temps

def get_storage_info():
    try:
        temps = get_temperatures()
        disks = []
        seen_mounts = set()
        
        # Priority partitions first
        priority_mounts = ["/", "/mnt/hdd", "/boot/efi"]
        partitions = psutil.disk_partitions(all=False)
        
        for p in partitions:
            if p.mountpoint in seen_mounts:
                continue
            if p.mountpoint.startswith(("/var/lib/docker", "/snap", "/run", "/sys", "/proc")):
                continue
            try:
                u = psutil.disk_usage(p.mountpoint)
                seen_mounts.add(p.mountpoint)
                
                # Associate temperature with disk
                drive_temp = None
                if p.mountpoint == "/" or "nvme" in p.device:
                    if temps["nvme"]:
                        drive_temp = temps["nvme"][0]["temp_c"]
                elif p.mountpoint == "/mnt/hdd" or "sda" in p.device:
                    if temps["hdd"]:
                        drive_temp = temps["hdd"][0]["temp_c"]
                
                disks.append({
                    "mount": p.mountpoint,
                    "device": p.device,
                    "fstype": p.fstype,
                    "total_bytes": u.total,
                    "used_bytes": u.used,
                    "free_bytes": u.free,
                    "percent": round(u.percent, 1),
                    "temp_c": drive_temp
                })
            except Exception:
                pass
        
        # Sort so / and /mnt/hdd come first
        disks.sort(key=lambda d: 0 if d["mount"] == "/" else (1 if d["mount"] == "/mnt/hdd" else 2))
        
        return {
            "disks": disks,
            "temperatures": temps
        }
    except Exception as e:
        return {"disks": [], "temperatures": {}, "error": str(e)}

def get_docker_containers():
    """
    Fetches all containers via `docker ps -a` and merges with `docker stats --no-stream`.
    """
    try:
        # 1. Fetch metadata (ps -a)
        ps_res = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{json .}}"],
            capture_output=True, text=True, timeout=4
        )
        if ps_res.returncode != 0:
            return []
        
        containers_meta = {}
        for line in ps_res.stdout.strip().splitlines():
            if not line:
                continue
            try:
                obj = json.loads(line)
                name = obj.get("Names", "")
                containers_meta[name] = obj
            except Exception:
                pass
        
        # 2. Fetch resource metrics (stats)
        stats_res = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{json .}}"],
            capture_output=True, text=True, timeout=5
        )
        
        stats_map = {}
        if stats_res.returncode == 0:
            for line in stats_res.stdout.strip().splitlines():
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    name = obj.get("Name", "")
                    stats_map[name] = obj
                except Exception:
                    pass
        
        # Merge
        result = []
        for name, meta in containers_meta.items():
            st = stats_map.get(name, {})
            
            state = meta.get("State", "unknown")
            status_text = meta.get("Status", "")
            health = meta.get("HealthStatus", "none")
            
            # Memory parsing
            mem_usage_str = st.get("MemUsage", "0B / 0B")
            mem_pct_str = st.get("MemPerc", "0.00%")
            try:
                mem_pct = float(mem_pct_str.replace("%", "").strip())
            except Exception:
                mem_pct = 0.0
            
            cpu_pct_str = st.get("CPUPerc", "0.00%")
            try:
                cpu_pct = float(cpu_pct_str.replace("%", "").strip())
            except Exception:
                cpu_pct = 0.0
            
            result.append({
                "id": meta.get("ID", "")[:12],
                "name": name,
                "image": meta.get("Image", ""),
                "state": state,
                "status": status_text,
                "health": health,
                "ports": "Active Protected Binding" if meta.get("Ports") else "Internal Isolated",
                "created": meta.get("RunningFor", ""),
                "cpu_percent": cpu_pct,
                "cpu_percent_str": cpu_pct_str,
                "mem_usage_str": mem_usage_str,
                "mem_percent": mem_pct,
                "mem_percent_str": mem_pct_str,
                "net_io": st.get("NetIO", "0B / 0B"),
                "block_io": st.get("BlockIO", "0B / 0B"),
                "pids": st.get("PIDs", "-")
            })
        
        # Sort active/running first, then by memory percentage descending
        result.sort(key=lambda c: (0 if c["state"] == "running" else 1, -c["mem_percent"]))
        return result
    except Exception as e:
        return []

def get_hermes_status():
    """
    Monitors all Hermes services & processes:
    - hermes-gateway.service (user systemd)
    - hermes-dashboard.service (user systemd, port 9229)
    - hermesbot.service (system systemd)
    - hermesbot-web.service (system systemd, port 8081)
    - hermesbot-adventure.service (system systemd)
    - headroom.service (user systemd)
    - Running hermes CLI / agent processes
    """
    status = {
        "gateway": {"active": False, "status": "unknown", "pid": None, "port": None},
        "dashboard": {"active": False, "status": "unknown", "pid": None, "port": 9229},
        "hermesbot": {"active": False, "status": "unknown", "memory_mb": 0},
        "hermesbot_web": {"active": False, "status": "unknown", "port": 8081, "memory_mb": 0},
        "hermesbot_adventure": {"active": False, "status": "unknown", "memory_mb": 0},
        "headroom": {"active": False, "status": "unknown"},
        "processes": [],
        "summary": "All Hermes services operational"
    }
    
    # Check user units
    try:
        u_res = subprocess.run(
            ["systemctl", "--user", "list-units", "--type=service", "--output=json"],
            capture_output=True, text=True, timeout=2
        )
        if u_res.returncode == 0:
            units = json.loads(u_res.stdout)
            for u in units:
                uname = u.get("unit", "")
                active = u.get("active") == "active"
                if "hermes-gateway" in uname:
                    status["gateway"]["active"] = active
                    status["gateway"]["status"] = u.get("sub", "unknown")
                elif "hermes-dashboard" in uname:
                    status["dashboard"]["active"] = active
                    status["dashboard"]["status"] = u.get("sub", "unknown")
                elif "headroom" in uname:
                    status["headroom"]["active"] = active
                    status["headroom"]["status"] = u.get("sub", "unknown")
    except Exception:
        pass
    
    # Check system units for hermesbot
    try:
        s_res = subprocess.run(
            ["systemctl", "list-units", "--type=service", "--output=json"],
            capture_output=True, text=True, timeout=2
        )
        if s_res.returncode == 0:
            units = json.loads(s_res.stdout)
            for u in units:
                uname = u.get("unit", "")
                active = u.get("active") == "active"
                if uname == "hermesbot.service":
                    status["hermesbot"]["active"] = active
                    status["hermesbot"]["status"] = u.get("sub", "unknown")
                elif uname == "hermesbot-web.service":
                    status["hermesbot_web"]["active"] = active
                    status["hermesbot_web"]["status"] = u.get("sub", "unknown")
                elif uname == "hermesbot-adventure.service":
                    status["hermesbot_adventure"]["active"] = active
                    status["hermesbot_adventure"]["status"] = u.get("sub", "unknown")
    except Exception:
        pass
    
    # Scan running processes for hermes
    hermes_procs = []
    try:
        for p in psutil.process_iter(["pid", "name", "cmdline", "memory_info", "cpu_percent"]):
            try:
                cmd = " ".join(p.info["cmdline"] or [])
                if "hermes" in cmd.lower() or "hermesbot" in cmd.lower():
                    rss_mb = round((p.info["memory_info"].rss if p.info["memory_info"] else 0) / (1024 * 1024), 1)
                    hermes_procs.append({
                        "pid": p.info["pid"],
                        "name": p.info["name"],
                        "memory_mb": rss_mb,
                        "cpu_percent": round(p.info["cpu_percent"] or 0, 1),
                        "cmd": cmd[:120]
                    })
            except Exception:
                pass
    except Exception:
        pass
    
    status["processes"] = hermes_procs
    
    # Overall summary
    all_ok = (status["gateway"]["active"] and 
              status["dashboard"]["active"] and 
              status["hermesbot"]["active"] and 
              status["hermesbot_web"]["active"] and 
              status["hermesbot_adventure"]["active"])
    status["healthy"] = all_ok
    status["summary"] = "Fully Active (5/5 Services Running)" if all_ok else "Attention: One or more Hermes units degraded"
    
    return status

def get_services_and_pm2():
    """
    Collects systemd core services and PM2 process manager list.
    """
    result = {
        "systemd": [],
        "pm2": [],
        "failed_units": []
    }
    
    # Core system services we care about
    monitored = [
        "docker.service", "nginx.service", "mysqld.service", "redis.service",
        "postfix.service", "smbd.service", "pure-ftpd.service", "pm2-dargo.service",
        "tailscaled.service", "smartmontools.service", "chrony.service",
        "actions.runner.hyperdargo-Alluva.homeserver.service", "pollinations-bridge.service",
        "site_total.service", "pdns.service", "rspamd.service"
    ]
    
    try:
        s_res = subprocess.run(
            ["systemctl", "list-units", "--type=service", "--all", "--output=json"],
            capture_output=True, text=True, timeout=2.5
        )
        if s_res.returncode == 0:
            units = json.loads(s_res.stdout)
            for u in units:
                uname = u.get("unit", "")
                active = u.get("active", "")
                if active == "failed":
                    result["failed_units"].append({
                        "unit": uname,
                        "description": u.get("description", "")
                    })
                if uname in monitored:
                    result["systemd"].append({
                        "unit": uname.replace(".service", ""),
                        "full_unit": uname,
                        "active": active == "active",
                        "status": u.get("sub", ""),
                        "description": u.get("description", "")
                    })
    except Exception:
        pass
    
    # PM2 processes
    try:
        import shutil
        pm2_bin = shutil.which("pm2") or "/home/dargo/.npm-global/bin/pm2"
        env = dict(os.environ)
        env["PATH"] = f"/home/dargo/.npm-global/bin:{env.get('PATH', '')}"
        pm2_res = subprocess.run(
            [pm2_bin, "jlist"],
            capture_output=True, text=True, timeout=2.5, env=env
        )
        if pm2_res.returncode == 0:
            p_list = json.loads(pm2_res.stdout)
            for p in p_list:
                pm2_env = p.get("pm2_env", {})
                monit = p.get("monit", {})
                mem_mb = round((monit.get("memory", 0)) / (1024 * 1024), 1)
                result["pm2"].append({
                    "name": p.get("name", ""),
                    "pid": p.get("pid", 0),
                    "status": pm2_env.get("status", "unknown"),
                    "uptime": pm2_env.get("pm_uptime", 0),
                    "restarts": pm2_env.get("restart_time", 0),
                    "cpu": monit.get("cpu", 0),
                    "memory_mb": mem_mb
                })
    except Exception:
        pass
    
    return result

def get_listening_ports():
    """
    Parses `ss -tlnp` into clean port objects, enriched with container names and service labels.
    """
    ports = []
    
    # Pre-map docker exposed ports to container names
    docker_port_map = {}
    try:
        ps_res = subprocess.run(["docker", "ps", "--format", "{{.Names}}\t{{.Ports}}"], capture_output=True, text=True, timeout=2)
        if ps_res.returncode == 0:
            for line in ps_res.stdout.splitlines():
                if not line.strip():
                    continue
                parts = line.split("\t")
                if len(parts) == 2:
                    cname, ports_str = parts[0], parts[1]
                    for seg in ports_str.split(","):
                        seg = seg.strip()
                        if "->" in seg and ":" in seg:
                            host_part = seg.split("->")[0]
                            host_port = host_part.rsplit(":", 1)[-1]
                            docker_port_map[host_port] = cname
    except Exception:
        pass
    
    # Well-known service name hints
    known_ports = {
        9090: "Homeserver Ops Dashboard",
        9119: "BoardDesk (Kanban)",
        9229: "Hermes Dashboard",
        8081: "HermesBot Web Dashboard",
        20128: "OmniRoute (LLM Gateway)",
        20129: "Pollinations Bridge",
        4000: "HRMS Backend",
        5555: "Prisma Studio"
    }
    
    try:
        p = subprocess.run(["ss", "-tlnp"], capture_output=True, text=True, timeout=2)
            
        lines = p.stdout.splitlines()
        for line in lines[1:]:
            parts = line.split()
            if len(parts) >= 4:
                proto = "TCP"
                local_addr = parts[3]
                proc_str = parts[-1] if len(parts) >= 6 else ""
                
                # Extract IP and port
                if ":" in local_addr:
                    ip = local_addr.rsplit(":", 1)[0]
                    port_str = local_addr.rsplit(":", 1)[1]
                    try:
                        port_num = int(port_str)
                    except ValueError:
                        continue
                    
                    # Parse process name and pid
                    pname = ""
                    pid_val = ""
                    m = re.search(r'users:\(\("([^"]+)",pid=(\d+)', proc_str)
                    if m:
                        pname = m.group(1)
                        pid_val = m.group(2)
                    elif proc_str and not proc_str.startswith("*"):
                        pname = proc_str
                    
                    # Enrich pname
                    if str(port_num) in docker_port_map:
                        pname = f"Docker: {docker_port_map[str(port_num)]}"
                    elif port_num in known_ports:
                        pname = known_ports[port_num]
                    
                    scope = "Internal Loopback" if ip in ("127.0.0.1", "::1") else "Firewalled Network"
                    ports.append({
                        "protocol": proto,
                        "scope": scope,
                        "service": pname or "System Daemon",
                        "status": "Monitored & Active"
                    })
        # Deduplicate by service and scope
        unique_services = {}
        for item in ports:
            key = (item["service"], item["scope"])
            if key not in unique_services:
                unique_services[key] = item
        
        sorted_ports = sorted(unique_services.values(), key=lambda x: x["service"])
        return sorted_ports
    except Exception:
        return []

def get_system_errors():
    """
    Fetches:
    1. System journal errors with priority 0-3 (emerg, alert, crit, err)
    2. Kernel OOM kill events
    3. Failed systemd units
    """
    errors_data = {
        "count": 0,
        "critical_count": 0,
        "oom_events": [],
        "recent_errors": []
    }
    
    # 1. Recent priority 0-3 errors from journalctl
    try:
        p = subprocess.run(
            ["journalctl", "-p", "3", "-xb", "-n", "60", "--no-pager", "-o", "json"],
            capture_output=True, text=True, timeout=3.5
        )
        if p.returncode == 0:
            parsed = []
            for line in p.stdout.splitlines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    ts_raw = int(obj.get("__REALTIME_TIMESTAMP", 0)) // 1000000
                    dt = datetime.datetime.fromtimestamp(ts_raw).strftime("%Y-%m-%d %H:%M:%S") if ts_raw else "Unknown"
                    msg = obj.get("MESSAGE", "")
                    unit = obj.get("_SYSTEMD_UNIT", obj.get("SYSLOG_IDENTIFIER", obj.get("_COMM", "system")))
                    prio = int(obj.get("PRIORITY", 3))
                    prio_names = {0: "EMERGENCY", 1: "ALERT", 2: "CRITICAL", 3: "ERROR"}
                    
                    if prio <= 2:
                        errors_data["critical_count"] += 1
                        
                    parsed.append({
                        "timestamp": dt,
                        "epoch": ts_raw,
                        "unit": unit,
                        "priority": prio,
                        "priority_name": prio_names.get(prio, "ERROR"),
                        "message": msg
                    })
                except Exception:
                    pass
            # Newest errors first
            parsed.reverse()
            errors_data["recent_errors"] = parsed
            errors_data["count"] = len(parsed)
    except Exception:
        pass
    
    # 2. Kernel OOM killer events
    try:
        p = subprocess.run(
            ["journalctl", "-k", "-g", "Out of memory", "-n", "10", "--no-pager", "-o", "json"],
            capture_output=True, text=True, timeout=2.5
        )
        if p.returncode == 0:
            oom_list = []
            for line in p.stdout.splitlines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    ts_raw = int(obj.get("__REALTIME_TIMESTAMP", 0)) // 1000000
                    dt = datetime.datetime.fromtimestamp(ts_raw).strftime("%Y-%m-%d %H:%M:%S") if ts_raw else "Unknown"
                    oom_list.append({
                        "timestamp": dt,
                        "epoch": ts_raw,
                        "message": obj.get("MESSAGE", "")
                    })
                except Exception:
                    pass
            oom_list.reverse()
            errors_data["oom_events"] = oom_list
    except Exception:
        pass
    
    return errors_data

def get_top_processes():
    """
    Returns top 10 processes sorted by RAM and top 10 by CPU.
    """
    procs = []
    try:
        for p in psutil.process_iter(["pid", "name", "username", "cpu_percent", "memory_percent", "memory_info", "status"]):
            try:
                info = p.info
                mem_bytes = info["memory_info"].rss if info["memory_info"] else 0
                procs.append({
                    "pid": info["pid"],
                    "name": info["name"] or "unknown",
                    "user": info["username"] or "-",
                    "cpu_percent": round(info["cpu_percent"] or 0, 1),
                    "memory_mb": round(mem_bytes / (1024 * 1024), 1),
                    "memory_percent": round(info["memory_percent"] or 0, 1),
                    "status": info["status"] or "running"
                })
            except Exception:
                pass
        
        top_ram = sorted(procs, key=lambda x: x["memory_mb"], reverse=True)[:10]
        top_cpu = sorted(procs, key=lambda x: x["cpu_percent"], reverse=True)[:10]
        return {"top_ram": top_ram, "top_cpu": top_cpu}
    except Exception:
        return {"top_ram": [], "top_cpu": []}

def get_system_uptime():
    try:
        boot_time = psutil.boot_time()
        uptime_seconds = int(time.time() - boot_time)
        days = uptime_seconds // 86400
        hours = (uptime_seconds % 86400) // 3600
        minutes = (uptime_seconds % 3600) // 60
        return {
            "uptime_seconds": uptime_seconds,
            "formatted": f"{days}d {hours}h {minutes}m"
        }
    except Exception:
        return {"uptime_seconds": 0, "formatted": "Unknown"}

# Background Cache Updater
def refresh_cache():
    while True:
        try:
            cpu = get_cpu_info()
            mem = get_memory_info()
            storage = get_storage_info()
            docker = get_docker_containers()
            hermes = get_hermes_status()
            services = get_services_and_pm2()
            ports = get_listening_ports()
            errors = get_system_errors()
            procs = get_top_processes()
            uptime = get_system_uptime()
            
            # Count running containers and total container memory
            running_dockers = sum(1 for c in docker if c["state"] == "running")
            
            overview = {
                "hostname": "Protected Host Node",
                "uptime": uptime["formatted"],
                "uptime_seconds": uptime["uptime_seconds"],
                "cpu": cpu,
                "memory": mem,
                "storage_summary": [
                    {
                        "mount": d["mount"],
                        "percent": d["percent"],
                        "used_gb": round(d["used_bytes"] / (1024**3), 1),
                        "total_gb": round(d["total_bytes"] / (1024**3), 1),
                        "temp_c": d.get("temp_c")
                    } for d in storage.get("disks", [])
                ],
                "docker_count": len(docker),
                "docker_running": running_dockers,
                "hermes": hermes,
                "alerts_count": errors["critical_count"],
                "errors_count": errors["count"],
                "highest_temp_c": storage.get("temperatures", {}).get("highest_temp", 0)
            }
            
            with _CACHE_LOCK:
                _CACHE["timestamp"] = time.time()
                _CACHE["overview"] = overview
                _CACHE["docker"] = docker
                _CACHE["hermes"] = hermes
                _CACHE["services"] = services
                _CACHE["storage"] = storage
                _CACHE["errors"] = errors
                _CACHE["ports"] = ports
                _CACHE["top_processes"] = procs
        except Exception as e:
            # Continue loop on error
            pass
        
        time.sleep(2.5)

def start_collector_thread():
    t = threading.Thread(target=refresh_cache, daemon=True)
    t.start()
    # Wait briefly for initial population
    time.sleep(0.5)

def get_cached_data(section=None):
    with _CACHE_LOCK:
        if section:
            return _CACHE.get(section, {})
        return dict(_CACHE)

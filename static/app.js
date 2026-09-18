/**
 * HOMESERVER OPS - Client Application
 * Vanilla JS, reactive polling, zero dependencies, high performance.
 */

// Application State
const state = {
  activeTab: 'overview',
  refreshIntervalMs: 5000,
  refreshTimer: null,
  isFetching: false,
  dockerContainers: [],
  systemErrors: [],
  listeningPorts: [],
  selectedModalContainer: null,
  lastSync: null
};

// Utilities
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getProgressColorClass(percent) {
  if (percent > 85) return 'progress-danger';
  if (percent > 70) return 'progress-warning';
  return 'progress-success';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Tab Switching
function switchTab(tabId) {
  state.activeTab = tabId;
  window.location.hash = tabId;

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabId}`);
  });

  // If switched to logs tab and empty, auto-fetch
  if (tabId === 'logs') {
    const terminal = document.getElementById('log-terminal');
    if (terminal && terminal.textContent.includes('Select a source')) {
      fetchLogs();
    }
  }
}

// Initialize Navigation & Event Listeners
function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Restore active tab from URL hash
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById(`tab-${hash}`)) {
    switchTab(hash);
  }

  // Refresh interval change
  const intervalSelect = document.getElementById('refresh-interval');
  intervalSelect.addEventListener('change', (e) => {
    state.refreshIntervalMs = parseInt(e.target.value, 10);
    resetAutoRefresh();
  });

  // Manual refresh button
  document.getElementById('btn-refresh').addEventListener('click', () => {
    fetchAllData();
  });

  // Docker search filter
  const dockerSearch = document.getElementById('docker-search');
  if (dockerSearch) {
    dockerSearch.addEventListener('input', () => filterDockerTable());
  }

  // Ports search filter
  const portsFilter = document.getElementById('ports-filter');
  if (portsFilter) {
    portsFilter.addEventListener('input', () => filterPortsTable());
  }

  // Errors search filter
  const errorsSearch = document.getElementById('errors-search');
  if (errorsSearch) {
    errorsSearch.addEventListener('input', () => filterErrorsTable());
  }

  // Log controls
  document.getElementById('btn-fetch-logs').addEventListener('click', fetchLogs);
  document.getElementById('btn-copy-logs').addEventListener('click', () => {
    const text = document.getElementById('log-terminal').textContent;
    navigator.clipboard.writeText(text).then(() => alert('Logs copied to clipboard!'));
  });

  // Modal controls
  const modalClose = document.getElementById('modal-close-btn');
  const modal = document.getElementById('container-log-modal');
  modalClose.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
  document.getElementById('modal-copy-btn').addEventListener('click', () => {
    const text = document.getElementById('modal-log-content').textContent;
    navigator.clipboard.writeText(text).then(() => alert('Container logs copied!'));
  });
  document.getElementById('modal-refresh-btn').addEventListener('click', () => {
    if (state.selectedModalContainer) {
      fetchContainerLogs(state.selectedModalContainer);
    }
  });
}

// Data Fetching
async function fetchAllData() {
  if (state.isFetching) return;
  state.isFetching = true;

  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) refreshIcon.style.transform = 'rotate(360deg)';

  try {
    const [overviewRes, dockerRes, hermesRes, servicesRes, storageRes, errorsRes, topProcsRes] = await Promise.all([
      fetch('/api/overview').then(r => r.json()),
      fetch('/api/docker').then(r => r.json()),
      fetch('/api/hermes').then(r => r.json()),
      fetch('/api/services').then(r => r.json()),
      fetch('/api/storage').then(r => r.json()),
      fetch('/api/errors').then(r => r.json()),
      fetch('/api/top_processes').then(r => r.json())
    ]);

    state.lastSync = new Date();
    document.getElementById('footer-sync-time').textContent = `Last synced: ${state.lastSync.toLocaleTimeString()}`;

    // Update state
    state.dockerContainers = dockerRes.data || [];
    state.systemErrors = errorsRes.data?.recent_errors || [];
    state.listeningPorts = servicesRes.ports || [];

    // Render components
    renderHeaderPills(overviewRes.data, storageRes.data);
    renderOverview(overviewRes.data, hermesRes.data, errorsRes.data);
    renderDocker(state.dockerContainers);
    renderHermes(hermesRes.data, servicesRes);
    renderStorage(storageRes.data, topProcsRes.data);
    renderErrors(errorsRes.data);

  } catch (err) {
    console.error('Failed to fetch dashboard data:', err);
  } finally {
    state.isFetching = false;
    if (refreshIcon) {
      setTimeout(() => { refreshIcon.style.transform = 'none'; }, 300);
    }
  }
}

// 1. Header Quick Pills
function renderHeaderPills(overview, storage) {
  if (!overview) return;

  const cpuPct = overview.cpu?.usage_percent ?? 0;
  const ramPct = overview.memory?.percent ?? 0;
  
  // CPU
  const quickCpu = document.getElementById('quick-cpu');
  quickCpu.textContent = `${cpuPct}%`;
  
  // RAM
  const quickRam = document.getElementById('quick-ram');
  quickRam.textContent = `${ramPct}%`;

  // NVMe Storage
  const quickNvme = document.getElementById('quick-nvme');
  const rootDisk = overview.storage_summary?.find(d => d.mount === '/');
  if (rootDisk) {
    quickNvme.textContent = `${rootDisk.percent}%`;
  }

  // Max Temp
  const quickTemp = document.getElementById('quick-temp');
  const maxTemp = overview.highest_temp_c || 0;
  quickTemp.textContent = `${maxTemp}°C`;

  // Docker
  const quickDocker = document.getElementById('quick-docker');
  quickDocker.textContent = `${overview.docker_running}/${overview.docker_count}`;

  // Hermes
  const quickHermes = document.getElementById('quick-hermes');
  const hermesHealthy = overview.hermes?.healthy;
  quickHermes.textContent = hermesHealthy ? 'HEALTHY' : 'DEGRADED';
  quickHermes.style.color = hermesHealthy ? 'var(--accent-green)' : 'var(--accent-amber)';

  // Badges in Tabs
  document.getElementById('badge-docker-count').textContent = overview.docker_count;
  const errBadge = document.getElementById('badge-errors-count');
  errBadge.textContent = overview.errors_count;
  if (overview.alerts_count > 0) {
    errBadge.classList.add('alert-badge');
  } else {
    errBadge.classList.remove('alert-badge');
  }
}

// 2. Overview Tab Rendering
function renderOverview(overview, hermes, errors) {
  if (!overview) return;

  // Primary Stat 1: CPU
  const cpuPct = overview.cpu?.usage_percent ?? 0;
  document.getElementById('card-cpu-pct').innerHTML = `${cpuPct}<span class="stat-unit">%</span>`;
  const cpuBar = document.getElementById('bar-cpu-pct');
  cpuBar.style.width = `${cpuPct}%`;
  cpuBar.className = `progress-bar-fill ${getProgressColorClass(cpuPct)}`;
  
  const load = overview.cpu?.load_avg || [0, 0, 0];
  document.getElementById('card-cpu-load').textContent = `Load: ${load[0]} | ${load[1]} | ${load[2]}`;
  document.getElementById('cpu-load-detail').textContent = `1m: ${load[0]} | 5m: ${load[1]} | 15m: ${load[2]}`;
  document.getElementById('card-cpu-model').textContent = `${overview.cpu?.model || 'Intel CPU'} • ${overview.cpu?.core_count || 6} Cores`;

  // Primary Stat 2: RAM
  const mem = overview.memory || {};
  const memPct = mem.percent ?? 0;
  document.getElementById('card-ram-pct').innerHTML = `${memPct}<span class="stat-unit">%</span>`;
  const ramBar = document.getElementById('bar-ram-pct');
  ramBar.style.width = `${memPct}%`;
  ramBar.className = `progress-bar-fill ${getProgressColorClass(memPct)}`;
  document.getElementById('card-swap-badge').textContent = `Swap: ${mem.swap_percent || 0}%`;

  const usedGb = (mem.used_bytes / (1024**3)).toFixed(1);
  const totalGb = (mem.total_bytes / (1024**3)).toFixed(1);
  const freeGb = (mem.free_bytes / (1024**3)).toFixed(1);
  document.getElementById('card-ram-details').textContent = `${usedGb} / ${totalGb} GiB used • ${freeGb} GiB free`;
  document.getElementById('ram-available-detail').textContent = `Available: ${(mem.available_bytes / (1024**3)).toFixed(1)} GiB`;

  // Primary Stat 3: Storage
  const rootDisk = overview.storage_summary?.find(d => d.mount === '/');
  const hddDisk = overview.storage_summary?.find(d => d.mount === '/mnt/hdd');
  const rootPct = rootDisk?.percent ?? 0;
  document.getElementById('card-storage-primary').innerHTML = `${rootPct}<span class="stat-unit">%</span>`;
  const diskBar = document.getElementById('bar-storage-primary');
  diskBar.style.width = `${rootPct}%`;
  diskBar.className = `progress-bar-fill ${getProgressColorClass(rootPct)}`;
  document.getElementById('card-temp-badge').textContent = `Max: ${overview.highest_temp_c || 0}°C`;
  document.getElementById('card-storage-details').textContent = `/: ${rootDisk?.used_gb || 0}/${rootDisk?.total_gb || 0} GB • /mnt/hdd: ${hddDisk?.used_gb || 0}/${hddDisk?.total_gb || 0} GB`;

  // Primary Stat 4: Docker & Health
  document.getElementById('card-docker-running').innerHTML = `${overview.docker_running}<span class="stat-unit"> / ${overview.docker_count} UP</span>`;
  document.getElementById('card-hermes-status').textContent = hermes?.healthy ? 'ALL ACTIVE' : 'CHECK';
  document.getElementById('card-hermes-status').className = hermes?.healthy ? 'badge badge-success' : 'badge badge-warning';
  document.getElementById('card-uptime-text').textContent = `Uptime: ${overview.uptime || 'Unknown'}`;

  // Cores Grid
  const coresGrid = document.getElementById('cores-grid');
  coresGrid.innerHTML = '';
  const cores = overview.cpu?.cores || [];
  cores.forEach((coreVal, idx) => {
    const row = document.createElement('div');
    row.className = 'core-row';
    row.innerHTML = `
      <span class="core-label">Core ${idx}</span>
      <div class="core-bar-wrap">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${getProgressColorClass(coreVal)}" style="width: ${coreVal}%;"></div>
        </div>
      </div>
      <span class="core-val">${coreVal}%</span>
    `;
    coresGrid.appendChild(row);
  });

  // Memory Matrix
  document.getElementById('mem-used-val').textContent = `${formatBytes(mem.used_bytes)} (${mem.percent}%)`;
  document.getElementById('mem-cache-val').textContent = `${formatBytes(mem.cached_bytes + mem.buffers_bytes)}`;
  document.getElementById('mem-free-val').textContent = `${formatBytes(mem.free_bytes)}`;
  document.getElementById('mem-swap-val').textContent = `${formatBytes(mem.swap_used_bytes)} / ${formatBytes(mem.swap_total_bytes)} (${mem.swap_percent}%)`;
  document.getElementById('mem-shared-val').textContent = `${formatBytes(mem.shared_bytes)}`;

  // Overview Hermes Quick List
  const hermesList = document.getElementById('overview-hermes-list');
  hermesList.innerHTML = '';
  const hermesUnits = [
    { name: 'Hermes Agent Gateway', status: hermes?.gateway?.active, sub: hermes?.gateway?.status },
    { name: 'Hermes Web Dashboard', status: hermes?.dashboard?.active, sub: hermes?.dashboard?.status },
    { name: 'HermesBot Discord Bot', status: hermes?.hermesbot?.active, sub: hermes?.hermesbot?.status },
    { name: 'HermesBot Web Portal', status: hermes?.hermesbot_web?.active, sub: hermes?.hermesbot_web?.status },
    { name: 'HermesBot Adventure Bot', status: hermes?.hermesbot_adventure?.active, sub: hermes?.hermesbot_adventure?.status }
  ];

  hermesUnits.forEach(item => {
    const el = document.createElement('div');
    el.className = 'quick-item';
    el.innerHTML = `
      <div class="quick-item-title">
        <span class="status-dot ${item.status ? 'dot-online' : 'dot-offline'}"></span>
        <span>${escapeHtml(item.name)}</span>
      </div>
      <span class="badge ${item.status ? 'badge-success' : 'badge-danger'}">
        ${item.status ? (item.sub || 'RUNNING').toUpperCase() : 'STOPPED'}
      </span>
    `;
    hermesList.appendChild(el);
  });

  // Overview Recent Errors Snippet
  const errorsList = document.getElementById('overview-errors-list');
  errorsList.innerHTML = '';
  const recentErrors = errors?.recent_errors?.slice(0, 4) || [];
  if (recentErrors.length === 0) {
    errorsList.innerHTML = '<div class="text-muted" style="padding: 12px 0;">No active critical errors recorded in system journal.</div>';
  } else {
    recentErrors.forEach(err => {
      const el = document.createElement('div');
      el.className = 'quick-item';
      el.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0; width: 100%;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="badge ${err.priority <= 2 ? 'badge-danger' : 'badge-warning'}">${err.priority_name}</span>
            <span style="font-weight: 600; color: #fff;">${escapeHtml(err.unit)}</span>
            <span class="text-muted" style="font-size: 10px;">${escapeHtml(err.timestamp)}</span>
          </div>
          <div class="text-muted" style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">
            ${escapeHtml(err.message)}
          </div>
        </div>
      `;
      errorsList.appendChild(el);
    });
  }
}

// 3. Docker Containers Tab Rendering
function renderDocker(containers) {
  const tbody = document.getElementById('docker-tbody');
  const summary = document.getElementById('docker-summary-stats');
  const logSelect = document.getElementById('log-docker-options');

  if (!containers || containers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No Docker containers found.</td></tr>';
    summary.innerHTML = '0 containers';
    return;
  }

  const runningCount = containers.filter(c => c.state === 'running').length;
  summary.innerHTML = `<strong>${runningCount}</strong> running &bull; <strong>${containers.length}</strong> total containers`;

  // Update container select in Live Logs tab
  if (logSelect) {
    logSelect.innerHTML = '';
    containers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = `container:${c.name}`;
      opt.textContent = `container: ${c.name}`;
      logSelect.appendChild(opt);
    });
  }

  filterDockerTable();
}

function filterDockerTable() {
  const query = (document.getElementById('docker-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('docker-tbody');
  tbody.innerHTML = '';

  const filtered = state.dockerContainers.filter(c => {
    return c.name.toLowerCase().includes(query) ||
           c.image.toLowerCase().includes(query) ||
           c.status.toLowerCase().includes(query) ||
           c.state.toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No matching containers found.</td></tr>';
    return;
  }

  filtered.forEach(c => {
    const tr = document.createElement('tr');
    
    // Status Badge
    let badgeClass = 'badge';
    if (c.health === 'healthy') badgeClass = 'badge badge-success';
    else if (c.health === 'unhealthy') badgeClass = 'badge badge-danger';
    else if (c.state === 'running') badgeClass = 'badge badge-success';
    else badgeClass = 'badge badge-danger';

    const healthText = c.health !== 'none' ? ` (${c.health})` : '';

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: #ffffff;">${escapeHtml(c.name)}</div>
        <div class="text-muted col-secondary" style="font-size: 10px;">${escapeHtml(c.image)}</div>
      </td>
      <td>
        <span class="${badgeClass}">${escapeHtml(c.status || c.state)}</span>
      </td>
      <td>
        <div style="font-weight: 600;">${escapeHtml(c.mem_usage_str)}</div>
        <div class="progress-bar-bg" style="margin-top: 4px; height: 4px;">
          <div class="progress-bar-fill ${getProgressColorClass(c.mem_percent)}" style="width: ${c.mem_percent}%;"></div>
        </div>
      </td>
      <td class="col-secondary" style="font-weight: 600;">${c.mem_percent_str}</td>
      <td style="font-weight: 600;">${c.cpu_percent_str}</td>
      <td class="text-muted col-secondary">${escapeHtml(c.net_io)}</td>
      <td class="text-muted col-secondary">${escapeHtml(c.block_io)}</td>
      <td class="text-muted col-secondary" style="font-size: 11px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c.ports)}">
        ${escapeHtml(c.ports || '-')}
      </td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openContainerLogs('${escapeHtml(c.name)}')">Logs</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 4. Hermes & Services Tab Rendering
function renderHermes(hermes, servicesData) {
  // Hermes cards
  const cardsGrid = document.getElementById('hermes-cards-grid');
  cardsGrid.innerHTML = '';

  const suite = [
    {
      title: 'Hermes Agent Gateway',
      desc: 'Messaging Platform Integration (Telegram / Discord bridge)',
      status: hermes?.gateway?.active,
      statusText: hermes?.gateway?.status || 'Unknown',
      meta: 'User Systemd: hermes-gateway.service'
    },
    {
      title: 'Hermes Web Dashboard',
      desc: 'Local Hermes UI and Sessions Inspector',
      status: hermes?.dashboard?.active,
      statusText: hermes?.dashboard?.status || 'Unknown',
      meta: 'Service: hermes-dashboard.service'
    },
    {
      title: 'HermesBot Discord Bot',
      desc: 'Multi-purpose AI bot & utility engine',
      status: hermes?.hermesbot?.active,
      statusText: hermes?.hermesbot?.status || 'Unknown',
      meta: 'Systemd: hermesbot.service'
    },
    {
      title: 'HermesBot Web Dashboard',
      desc: 'Full web administration portal',
      status: hermes?.hermesbot_web?.active,
      statusText: hermes?.hermesbot_web?.status || 'Unknown',
      meta: 'Service: hermesbot-web.service'
    },
    {
      title: 'HermesBot Adventure RPG',
      desc: 'Text-based RPG adventure bot engine',
      status: hermes?.hermesbot_adventure?.active,
      statusText: hermes?.hermesbot_adventure?.status || 'Unknown',
      meta: '10 Slash Commands • hermesbot-adventure.service'
    },
    {
      title: 'Headroom Proxy',
      desc: 'Hermes Agent network & traffic proxy',
      status: hermes?.headroom?.active,
      statusText: hermes?.headroom?.status || 'Unknown',
      meta: 'User Systemd: headroom.service'
    }
  ];

  suite.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${escapeHtml(item.title)}</span>
        <span class="badge ${item.status ? 'badge-success' : 'badge-danger'}">
          ${item.status ? (item.statusText || 'ACTIVE').toUpperCase() : 'INACTIVE'}
        </span>
      </div>
      <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${escapeHtml(item.desc)}</p>
      <div class="card-sub">${escapeHtml(item.meta)}</div>
    `;
    cardsGrid.appendChild(card);
  });

  // Hermes Active Processes
  const procsTbody = document.getElementById('hermes-procs-tbody');
  procsTbody.innerHTML = '';
  const procs = hermes?.processes || [];
  if (procs.length === 0) {
    procsTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No active Hermes processes found.</td></tr>';
  } else {
    procs.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-secondary" style="font-weight: 700;">${p.pid}</td>
        <td>${escapeHtml(p.name)}</td>
        <td style="font-weight: 600;">${p.memory_mb} MB</td>
        <td>${p.cpu_percent}%</td>
        <td class="text-muted col-secondary" style="font-size: 11px;">${escapeHtml(p.cmd)}</td>
      `;
      procsTbody.appendChild(tr);
    });
  }

  // PM2 Applications
  const pm2Tbody = document.getElementById('pm2-tbody');
  pm2Tbody.innerHTML = '';
  const pm2List = servicesData?.services?.pm2 || [];
  if (pm2List.length === 0) {
    pm2Tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No PM2 processes online.</td></tr>';
  } else {
    pm2List.forEach(app => {
      const tr = document.createElement('tr');
      const isOnline = app.status === 'online';
      tr.innerHTML = `
        <td style="font-weight: 700; color: #fff;">${escapeHtml(app.name)}</td>
        <td class="col-secondary">${app.pid}</td>
        <td><span class="badge ${isOnline ? 'badge-success' : 'badge-danger'}">${app.status.toUpperCase()}</span></td>
        <td>${app.memory_mb} MB</td>
        <td class="col-secondary">${app.cpu}%</td>
        <td class="col-secondary">${app.restarts}</td>
      `;
      pm2Tbody.appendChild(tr);
    });
  }

  // Systemd Core Services
  const sysTbody = document.getElementById('systemd-tbody');
  sysTbody.innerHTML = '';
  const sysList = servicesData?.services?.systemd || [];
  if (sysList.length === 0) {
    sysTbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No systemd services found.</td></tr>';
  } else {
    sysList.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600; color: #fff;">${escapeHtml(s.unit)}</td>
        <td><span class="badge ${s.active ? 'badge-success' : 'badge-danger'}">${s.status.toUpperCase()}</span></td>
        <td class="text-muted col-secondary" style="font-size: 11px;">${escapeHtml(s.description)}</td>
      `;
      sysTbody.appendChild(tr);
    });
  }

  // Listening Ports
  filterPortsTable();
}

function filterPortsTable() {
  const query = (document.getElementById('ports-filter')?.value || '').toLowerCase();
  const tbody = document.getElementById('ports-tbody');
  tbody.innerHTML = '';

  const filtered = state.listeningPorts.filter(p => {
    return (p.service || '').toLowerCase().includes(query) ||
           (p.scope || '').toLowerCase().includes(query) ||
           (p.protocol || '').toLowerCase().includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No network services matched query.</td></tr>';
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600; color: #ffffff;">${escapeHtml(p.service || 'System Service')}</td>
      <td class="col-secondary">${(p.protocol || 'TCP').toUpperCase()}</td>
      <td class="text-muted col-secondary">${escapeHtml(p.scope || 'Internal Network')}</td>
      <td>
        <span class="badge badge-success">PROTECTED &bull; ACTIVE</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 5. Storage & Temperatures Tab Rendering
function renderStorage(storageData, topProcsData) {
  // Disks
  const disksGrid = document.getElementById('disks-grid');
  disksGrid.innerHTML = '';
  const disks = storageData?.disks || [];

  disks.forEach(d => {
    const card = document.createElement('div');
    card.className = 'card stat-card';

    const usedGb = (d.used_bytes / (1024**3)).toFixed(1);
    const totalGb = (d.total_bytes / (1024**3)).toFixed(1);
    const freeGb = (d.free_bytes / (1024**3)).toFixed(1);

    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${escapeHtml(d.mount)} (${escapeHtml(d.device)})</span>
        ${d.temp_c ? `<span class="badge badge-success">${d.temp_c}°C</span>` : ''}
      </div>
      <div class="stat-value">${d.percent}<span class="stat-unit">%</span></div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill ${getProgressColorClass(d.percent)}" style="width: ${d.percent}%;"></div>
      </div>
      <div class="stat-subtext">
        ${usedGb} GB used / ${totalGb} GB total • ${freeGb} GB free (${d.fstype})
      </div>
    `;
    disksGrid.appendChild(card);
  });

  // Temperatures
  const tempsGrid = document.getElementById('temps-grid');
  tempsGrid.innerHTML = '';
  const temps = storageData?.temperatures || {};

  // NVMe sensor
  if (temps.nvme && temps.nvme.length > 0) {
    temps.nvme.forEach(s => {
      tempsGrid.appendChild(createTempCard('NVMe SSD (Composite)', s.temp_c, 'Storage Sensor (hwmon1)'));
    });
  }

  // HDD sensor
  if (temps.hdd && temps.hdd.length > 0) {
    temps.hdd.forEach(s => {
      tempsGrid.appendChild(createTempCard('SATA HDD (/dev/sda)', s.temp_c, 'SMART Diagnostic (smartctl)'));
    });
  }

  // CPU Package
  const cpuPkg = temps.cpu?.find(s => s.label.includes('Package') || s.label.includes('temp1'));
  if (cpuPkg) {
    tempsGrid.appendChild(createTempCard('CPU Package', cpuPkg.temp_c, 'coretemp (i5-8500T)'));
  }

  // PCH
  if (temps.pch && temps.pch.length > 0) {
    tempsGrid.appendChild(createTempCard('PCH Chipset', temps.pch[0].temp_c, 'pch_cannonlake'));
  }

  // CPU Cores
  const cores = temps.cpu?.filter(s => s.label.includes('Core')) || [];
  cores.forEach(c => {
    tempsGrid.appendChild(createTempCard(c.label, c.temp_c, 'coretemp sensor'));
  });

  // Top RAM processes
  const ramTbody = document.getElementById('top-ram-tbody');
  ramTbody.innerHTML = '';
  const topRam = topProcsData?.top_ram || [];
  topRam.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-secondary" style="font-weight: 700;">${p.pid}</td>
      <td style="font-weight: 600; color: #fff;">${escapeHtml(p.name)}</td>
      <td class="text-muted col-secondary">${escapeHtml(p.user)}</td>
      <td style="font-weight: 600;">${p.memory_mb} MB</td>
      <td>${p.memory_percent}%</td>
    `;
    ramTbody.appendChild(tr);
  });

  // Top CPU processes
  const cpuTbody = document.getElementById('top-cpu-tbody');
  cpuTbody.innerHTML = '';
  const topCpu = topProcsData?.top_cpu || [];
  topCpu.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-secondary" style="font-weight: 700;">${p.pid}</td>
      <td style="font-weight: 600; color: #fff;">${escapeHtml(p.name)}</td>
      <td class="text-muted col-secondary">${escapeHtml(p.user)}</td>
      <td style="font-weight: 600; color: #fff;">${p.cpu_percent}%</td>
      <td>${p.memory_mb} MB</td>
    `;
    cpuTbody.appendChild(tr);
  });
}

function createTempCard(title, tempC, subtext) {
  const card = document.createElement('div');
  card.className = 'card stat-card';

  let badgeColor = 'badge-success';
  if (tempC > 75) badgeColor = 'badge-danger';
  else if (tempC > 60) badgeColor = 'badge-warning';

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escapeHtml(title)}</span>
      <span class="badge ${badgeColor}">${tempC > 75 ? 'HOT' : (tempC > 60 ? 'WARM' : 'NORMAL')}</span>
    </div>
    <div class="stat-value">${tempC}<span class="stat-unit">°C</span></div>
    <div class="stat-subtext">${escapeHtml(subtext)}</div>
  `;
  return card;
}

// 6. Errors & Incidents Tab Rendering
function renderErrors(errorsData) {
  // OOM alerts
  const oomBox = document.getElementById('oom-container');
  oomBox.innerHTML = '';
  const oomList = errorsData?.oom_events || [];

  if (oomList.length > 0) {
    oomList.forEach(ev => {
      const el = document.createElement('div');
      el.className = 'oom-alert-box';
      el.innerHTML = `
        <div class="oom-title">
          <span>&#x26a0;</span> KERNEL OUT-OF-MEMORY (OOM) KILLER DETECTED
          <span style="font-weight: normal; font-size: 11px; margin-left: auto;">${escapeHtml(ev.timestamp)}</span>
        </div>
        <div class="oom-desc">${escapeHtml(ev.message)}</div>
      `;
      oomBox.appendChild(el);
    });
  }

  filterErrorsTable();
}

function filterErrorsTable() {
  const query = (document.getElementById('errors-search')?.value || '').toLowerCase();
  const tbody = document.getElementById('errors-tbody');
  const stats = document.getElementById('errors-summary-stats');
  tbody.innerHTML = '';

  const filtered = state.systemErrors.filter(e => {
    return e.message.toLowerCase().includes(query) ||
           e.unit.toLowerCase().includes(query) ||
           e.priority_name.toLowerCase().includes(query);
  });

  stats.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${state.systemErrors.length}</strong> recorded error events`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No matching error records found.</td></tr>';
    return;
  }

  filtered.forEach(err => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-muted col-secondary" style="font-size: 11px;">${escapeHtml(err.timestamp)}</td>
      <td>
        <span class="badge ${err.priority <= 2 ? 'badge-danger' : 'badge-warning'}">${err.priority_name}</span>
      </td>
      <td style="font-weight: 600; color: #fff;">${escapeHtml(err.unit)}</td>
      <td style="font-size: 11px; line-height: 1.4; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(err.message)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 7. Live Logs Fetching
async function fetchLogs() {
  const terminal = document.getElementById('log-terminal');
  const sourceVal = document.getElementById('log-source').value;
  const linesVal = document.getElementById('log-lines').value;

  terminal.textContent = `Streaming logs from ${sourceVal}...`;

  let url = '';
  if (sourceVal.startsWith('container:')) {
    const cname = sourceVal.replace('container:', '');
    url = `/api/container_logs/${encodeURIComponent(cname)}?lines=${linesVal}`;
  } else if (sourceVal.startsWith('unit:')) {
    const uname = sourceVal.replace('unit:', '');
    url = `/api/logs?unit=${encodeURIComponent(uname)}&lines=${linesVal}`;
  } else {
    url = `/api/logs?lines=${linesVal}`;
  }

  try {
    const res = await fetch(url).then(r => r.json());
    if (res.status === 'success') {
      terminal.textContent = res.logs || '(No logs returned)';
      if (document.getElementById('log-autoscroll').checked) {
        terminal.scrollTop = terminal.scrollHeight;
      }
    } else {
      terminal.textContent = `Error: ${res.message || 'Failed to retrieve logs'}`;
    }
  } catch (err) {
    terminal.textContent = `Network error: ${err.message}`;
  }
}

// 8. Docker Container Logs Modal
function openContainerLogs(containerName) {
  state.selectedModalContainer = containerName;
  const modal = document.getElementById('container-log-modal');
  document.getElementById('modal-container-name').textContent = `Logs: ${containerName}`;
  modal.style.display = 'flex';
  fetchContainerLogs(containerName);
}

async function fetchContainerLogs(containerName) {
  const contentEl = document.getElementById('modal-log-content');
  contentEl.textContent = 'Loading container logs...';

  try {
    const res = await fetch(`/api/container_logs/${encodeURIComponent(containerName)}?lines=100`).then(r => r.json());
    if (res.status === 'success') {
      contentEl.textContent = res.logs || '(No logs emitted yet)';
      contentEl.scrollTop = contentEl.scrollHeight;
    } else {
      contentEl.textContent = `Error: ${res.message}`;
    }
  } catch (err) {
    contentEl.textContent = `Failed to fetch logs: ${err.message}`;
  }
}

// 9. Hermes Interactive AI Console Client Logic
let isHermesProcessing = false;

function formatMarkdown(rawText) {
  if (!rawText) return '';
  
  // 1. Escape HTML to prevent XSS injection
  let text = String(rawText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. Extract code blocks with triple backticks
  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9_\-\.\+]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang.trim(), code: code.trim() });
    return `__CODE_BLOCK_${idx}__`;
  });

  // 3. Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 4. Headers
  text = text.replace(/^### (.*$)/gim, '<h4 style="margin:8px 0 4px; color:#fff; font-size:13px;">$1</h4>');
  text = text.replace(/^## (.*$)/gim, '<h3 style="margin:10px 0 6px; color:#fff; font-size:14px; border-bottom:1px solid #27272a; padding-bottom:4px;">$1</h3>');
  text = text.replace(/^# (.*$)/gim, '<h3 style="margin:12px 0 6px; color:#fff; font-size:15px; border-bottom:1px solid #333; padding-bottom:4px;">$1</h3>');

  // 5. Bold & Italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 6. Lists
  text = text.replace(/^\s*[\-\*]\s+(.*)$/gim, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/gis, '<ul>$1</ul>');

  // 7. Paragraphs & Line Breaks
  const paragraphs = text.split(/\n\n+/);
  text = paragraphs.map(p => {
    if (p.startsWith('<h3') || p.startsWith('<h4') || p.startsWith('<ul>') || p.startsWith('__CODE_BLOCK_')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
  }).join('');

  // 8. Restore code blocks safely with Copy button
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (match, idx) => {
    const item = codeBlocks[parseInt(idx, 10)];
    if (!item) return '';
    const safeCodeId = `cb-${Date.now()}-${idx}`;
    return `<pre id="${safeCodeId}"><button class="copy-code-btn" type="button" onclick="copySnippet('${safeCodeId}')">Copy</button><code>${item.code}</code></pre>`;
  });

  return text;
}

window.copySnippet = function(preId) {
  const pre = document.getElementById(preId);
  if (!pre) return;
  const codeEl = pre.querySelector('code');
  const text = codeEl ? codeEl.textContent : pre.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = pre.querySelector('.copy-code-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = orig, 1800);
    }
  });
};

function appendChatMessage(role, content, timeStr, durationSec = null) {
  const stream = document.getElementById('hermes-chat-stream');
  if (!stream) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg chat-msg-${role}`;

  const isUser = role === 'user';
  const authorName = isUser ? 'User (Laptop)' : 'Hermes Agent';
  const avatarHtml = isUser 
    ? '<div class="chat-avatar" style="background:#222; border-color:#444;">U</div>' 
    : '<div class="chat-avatar"><img src="/static/logo.png" alt="Hermes" onerror="this.src=\'/static/icon-192.png\'"></div>';

  const durationBadge = durationSec ? ` &bull; <span style="color:#10b981;">⚡ ${durationSec}s</span>` : '';
  const parsedContent = isUser 
    ? `<p>${escapeHtml(content).replace(/\n/g, '<br/>')}</p>` 
    : formatMarkdown(content);

  msgDiv.innerHTML = `
    ${avatarHtml}
    <div class="chat-bubble">
      <div class="chat-bubble-header">
        <span class="chat-author">${authorName}</span>
        <span class="chat-time">${timeStr || new Date().toLocaleTimeString()}${durationBadge}</span>
      </div>
      <div class="chat-text">${parsedContent}</div>
    </div>
  `;

  stream.appendChild(msgDiv);
  stream.scrollTop = stream.scrollHeight;

  // Save conversation state to localStorage
  saveChatHistory();
}

function saveChatHistory() {
  try {
    const stream = document.getElementById('hermes-chat-stream');
    if (!stream) return;
    // Save last 20 messages HTML
    const messages = [];
    const msgNodes = stream.querySelectorAll('.chat-msg');
    // Skip initial greeting if needed, or save up to 25 items
    msgNodes.forEach((node, i) => {
      if (i > 0) { // Keep after welcome msg
        messages.push(node.outerHTML);
      }
    });
    localStorage.setItem('homeserver_ops_hermes_chat', JSON.stringify(messages.slice(-25)));
  } catch (e) {
    console.warn('Failed to save chat history:', e);
  }
}

function loadChatHistory() {
  try {
    const raw = localStorage.getItem('homeserver_ops_hermes_chat');
    if (!raw) return;
    const messages = JSON.parse(raw);
    const stream = document.getElementById('hermes-chat-stream');
    if (!stream || !Array.isArray(messages)) return;
    
    messages.forEach(html => {
      const temp = document.createElement('div');
      temp.innerHTML = html;
      if (temp.firstElementChild) {
        stream.appendChild(temp.firstElementChild);
      }
    });
    stream.scrollTop = stream.scrollHeight;
  } catch (e) {
    console.warn('Failed to load chat history:', e);
  }
}

async function sendHermesPrompt(prompt) {
  prompt = String(prompt || '').trim();
  if (!prompt || isHermesProcessing) return;

  const inputBox = document.getElementById('hermes-input-box');
  const sendBtn = document.getElementById('hermes-send-btn');
  const thinking = document.getElementById('hermes-thinking');
  const statusBadge = document.getElementById('hermes-console-status');

  isHermesProcessing = true;
  if (inputBox) inputBox.value = '';
  updateHermesCharCount();

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner-inline" style="width:12px;height:12px;"></span> Running...';
  }
  if (thinking) thinking.style.display = 'flex';
  if (statusBadge) {
    statusBadge.textContent = 'PROCESSING';
    statusBadge.className = 'badge badge-warning';
  }

  // Append user's message
  appendChatMessage('user', prompt, new Date().toLocaleTimeString());

  try {
    const res = await fetch('/api/hermes/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt })
    });

    const data = await res.json();
    if (res.ok && data.status === 'success') {
      appendChatMessage('hermes', data.reply, new Date().toLocaleTimeString(), data.duration_s);
    } else {
      appendChatMessage('hermes', `⚠️ **Error:** ${data.message || 'Failed to process request'}`, new Date().toLocaleTimeString());
    }
  } catch (err) {
    appendChatMessage('hermes', `❌ **Network Failure:** ${err.message}. Ensure the server is reachable and port 9090 is allowed.`, new Date().toLocaleTimeString());
  } finally {
    isHermesProcessing = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>Send</span> &rarr;';
    }
    if (thinking) thinking.style.display = 'none';
    if (statusBadge) {
      statusBadge.textContent = 'ONLINE';
      statusBadge.className = 'badge badge-success';
    }
    if (inputBox) inputBox.focus();
  }
}

function updateHermesCharCount() {
  const inputBox = document.getElementById('hermes-input-box');
  const countEl = document.getElementById('hermes-char-count');
  if (!inputBox || !countEl) return;
  const len = inputBox.value.length;
  countEl.textContent = `${len} / 4000`;
  if (len > 3800) countEl.style.color = 'var(--accent-danger)';
  else countEl.style.color = '#71717a';
}

function initHermesChat() {
  const form = document.getElementById('hermes-chat-form');
  const inputBox = document.getElementById('hermes-input-box');
  const clearBtn = document.getElementById('btn-clear-chat');
  const welcomeTime = document.getElementById('welcome-msg-time');

  if (welcomeTime) {
    welcomeTime.textContent = new Date().toLocaleTimeString();
  }

  // Load persistent chat history
  loadChatHistory();

  // Form submission
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (inputBox) sendHermesPrompt(inputBox.value);
    });
  }

  // Textarea Enter key handling (Enter = send, Shift+Enter = newline)
  if (inputBox) {
    inputBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendHermesPrompt(inputBox.value);
      }
    });
    inputBox.addEventListener('input', updateHermesCharCount);
  }

  // Quick Action Chips delegation
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-action');
    if (chip) {
      const prompt = chip.dataset.prompt;
      if (prompt) {
        // Automatically switch to hermes-console tab if clicked from elsewhere
        switchTab('hermes-console');
        sendHermesPrompt(prompt);
      }
    }
  });

  // Clear chat button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear chat history on this browser?')) {
        localStorage.removeItem('homeserver_ops_hermes_chat');
        const stream = document.getElementById('hermes-chat-stream');
        if (stream) {
          const first = stream.querySelector('.chat-msg-hermes');
          stream.innerHTML = '';
          if (first) stream.appendChild(first);
        }
      }
    });
  }
}

// 10. Progressive Web App (PWA) Support
let deferredInstallPrompt = null;

function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[PWA] ServiceWorker registered successfully with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] ServiceWorker registration failed:', err);
        });
    });
  }

  // Handle BeforeInstallPrompt event for custom installation trigger
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
      installBtn.style.display = 'inline-flex';
      installBtn.onclick = async () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          const { outcome } = await deferredInstallPrompt.userChoice;
          console.log('[PWA] User install choice:', outcome);
          if (outcome === 'accepted') {
            installBtn.style.display = 'none';
          }
          deferredInstallPrompt = null;
        }
      };
    }
  });

  // Handle App Installed event
  window.addEventListener('appinstalled', () => {
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) installBtn.style.display = 'none';
    console.log('[PWA] Homeserver Ops PWA was installed successfully!');
  });

  // Support browser back/forward buttons for tab history
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const tabId = hash.startsWith('tab-') ? hash.replace('tab-', '') : hash;
      if (document.getElementById(`tab-${tabId}`)) {
        switchTab(tabId);
      }
    }
  });
}

// Auto-Refresh Loop
function resetAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  if (state.refreshIntervalMs > 0) {
    state.refreshTimer = setInterval(fetchAllData, state.refreshIntervalMs);
  }
}

// Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initHermesChat();
  initPWA();
  fetchAllData();
  resetAutoRefresh();
});

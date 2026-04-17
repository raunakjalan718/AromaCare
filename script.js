let chartInstance = null;
const DB_KEY = 'enose_client_v2_db';

// 1. NAVIGATION
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageId).classList.add('active');
    
    // Auto-init visual elements
    if (pageId === 'dashboard') initChart();
    if (pageId === 'history') renderHistory();
}

// 2. AUTHENTICATION
function handleLogin() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    
    if (user === "admin" && pass === "password123") {
        document.getElementById('nav-links').style.display = 'flex';
        showPage('dashboard');
        startDataStream();
    } else {
        alert("Authentication Failed. Please check credentials.");
    }
}

// 3. DATABASE (LOCAL JSON STORAGE)
function saveToDB(gas, temp, hum) {
    let history = JSON.parse(localStorage.getItem(DB_KEY)) || [];
    const entry = {
        timestamp: new Date().toLocaleString(),
        gas: gas,
        temp: temp,
        hum: hum
    };
    history.push(entry);
    if (history.length > 100) history.shift(); // Keep last 100 for client
    localStorage.setItem(DB_KEY, JSON.stringify(history));
}

function clearDatabase() {
    if(confirm("Are you sure? This will delete all historical sensor data.")) {
        localStorage.removeItem(DB_KEY);
        renderHistory();
    }
}

// 4. DATA STREAMING (SIMULATED ESP32)
function startDataStream() {
    // Only start one interval
    if (window.sensorInterval) return;
    window.sensorInterval = setInterval(() => {
        const g = (Math.random() * 40 + 200).toFixed(0);
        const t = (Math.random() * 0.5 + 24).toFixed(1);
        const h = (Math.random() * 2 + 60).toFixed(0);
        
        // Update UI
        if(document.getElementById('live-gas')) {
            document.getElementById('live-gas').innerHTML = `${g} <small>ppm</small>`;
            document.getElementById('live-temp').innerHTML = `${t} <small>°C</small>`;
            document.getElementById('live-hum').innerHTML = `${h} <small>%</small>`;
        }
        
        saveToDB(g, t, h);
        if (chartInstance) updateChart(g);
    }, 3000);
}

// 5. CHARTS
function initChart() {
    if (chartInstance) return;
    const ctx = document.getElementById('liveChart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Air Quality Index (ppm)',
                data: [],
                borderColor: '#ff85a1',
                backgroundColor: 'rgba(255, 133, 161, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { grid: { display: false } } }
        }
    });
}

function updateChart(gas) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (chartInstance.data.labels.length > 15) {
        chartInstance.data.labels.shift();
        chartInstance.data.datasets[0].data.shift();
    }
    chartInstance.data.labels.push(time);
    chartInstance.data.datasets[0].data.push(gas);
    chartInstance.update();
}

// 6. ANALYTICS & EXPORT
function renderHistory() {
    const history = JSON.parse(localStorage.getItem(DB_KEY)) || [];
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = history.slice().reverse().map(row => `
        <tr>
            <td>${row.timestamp}</td>
            <td><strong>${row.gas}</strong></td>
            <td>${row.temp}</td>
            <td>${row.hum}</td>
        </tr>
    `).join('');
}

function downloadCSV() {
    const history = JSON.parse(localStorage.getItem(DB_KEY)) || [];
    if (history.length === 0) return alert("No data available to export.");
    
    let csv = "Timestamp,Gas (ppm),Temperature (C),Humidity (%)\n";
    history.forEach(row => {
        csv += `${row.timestamp},${row.gas},${row.temp},${row.hum}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'ENose_Sensor_Data.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function logout() {
    location.reload();
}

lucide.createIcons();
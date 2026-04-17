const DB_KEY = 'enose_sensor_db';

// Initialize the database if empty
if (!localStorage.getItem(DB_KEY)) {
    localStorage.setItem(DB_KEY, JSON.stringify([]));
}

// Function to save a new reading
function saveReading(gas, temp, hum) {
    const db = JSON.parse(localStorage.getItem(DB_KEY));
    
    const newEntry = {
        timestamp: new Date().toLocaleString(),
        gas: parseFloat(gas),
        temp: parseFloat(temp),
        hum: parseFloat(hum)
    };

    db.push(newEntry);
    
    // Keep only the last 100 entries to prevent memory overflow
    if (db.length > 100) db.shift();

    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return newEntry;
}

// Function to get all logs
function getLogs() {
    return JSON.parse(localStorage.getItem(DB_KEY));
}
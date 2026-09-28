const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
const backupsDir = path.join(__dirname, 'backups');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

const dbFile = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      status TEXT DEFAULT 'Completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      status TEXT DEFAULT 'Success',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

function logAction(action, details, status = 'Success') {
  db.run(`INSERT INTO logs (action, details, status) VALUES (?, ?, ?)`, [action, details, status]);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/api/stats', (req, res) => {
  db.get(`SELECT COUNT(*) as count, SUM(file_size) as total_size FROM backups`, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      count: row.count || 0,
      total_size: row.total_size || 0
    });
  });
});

app.get('/api/backups', (req, res) => {
  db.all(`SELECT * FROM backups ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/backups', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Backup name is required' });

  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '_');
  const filename = `${safeName}_${Date.now()}.zip`;
  const filePath = path.join(backupsDir, filename);
  
  const dummyContent = `Backup data for ${name}\nCreated at ${new Date().toISOString()}\nDescription: ${description || 'None'}`;
  fs.writeFileSync(filePath, dummyContent);
  const stats = fs.statSync(filePath);

  db.run(`INSERT INTO backups (name, description, filename, file_size, status) VALUES (?, ?, ?, ?, ?)`,
    [name, description || '', filename, stats.size, 'Completed'],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      logAction('CREATE_BACKUP', `Created backup: ${name}`);
      res.json({ id: this.lastID, name, filename, file_size: stats.size, status: 'Completed' });
    }
  );
});

app.post('/api/backups/:id/verify', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM backups WHERE id = ?`, [id], (err, backup) => {
    if (err || !backup) return res.status(404).json({ error: 'Backup not found' });
    
    const filePath = path.join(backupsDir, backup.filename);
    const isValid = fs.existsSync(filePath);
    
    const status = isValid ? 'Verified' : 'Corrupted';
    db.run(`UPDATE backups SET status = ? WHERE id = ?`, [status, id]);
    logAction('VERIFY_BACKUP', `Verified backup ${backup.name}: ${status}`);
    res.json({ success: true, status });
  });
});

app.post('/api/backups/:id/restore', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM backups WHERE id = ?`, [id], (err, backup) => {
    if (err || !backup) return res.status(404).json({ error: 'Backup not found' });
    
    logAction('RESTORE_BACKUP', `Restored backup: ${backup.name}`);
    res.json({ success: true, message: `Backup ${backup.name} restored successfully.` });
  });
});

app.delete('/api/backups/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM backups WHERE id = ?`, [id], (err, backup) => {
    if (err || !backup) return res.status(404).json({ error: 'Backup not found' });

    const filePath = path.join(backupsDir, backup.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.run(`DELETE FROM backups WHERE id = ?`, [id], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      logAction('DELETE_BACKUP', `Deleted backup: ${backup.name}`);
      res.json({ success: true });
    });
  });
});

app.get('/api/logs', (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 50`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backup Manager running on port ${PORT}`);
});

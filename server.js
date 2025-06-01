const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
const db = new sqlite3.Database('./database.db');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/tickets', express.static(path.join(__dirname, 'tickets')));
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false
}));

// Database setup
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    is_super_admin INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS trains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    source TEXT,
    destination TEXT,
    total_seats INTEGER,
    available_seats INTEGER,
    departure TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    pnr TEXT PRIMARY KEY,
    passenger_name TEXT,
    age INTEGER,
    mobile TEXT,
    address TEXT,
    train_id INTEGER,
    seat_number TEXT,
    booking_date TEXT
  )`);

  // Seed super admin if not exists
  db.get("SELECT * FROM admins WHERE is_super_admin=1", (err, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('admin123', 10);
      db.run("INSERT INTO admins (username, password, is_super_admin) VALUES (?, ?, 1)", ['superadmin', hash]);
      console.log('Super admin created: Username: superadmin, Password: admin123');
    }
  });
});

// Helper functions
function generatePNR() {
  return Math.random().toString(36).substr(2, 10).toUpperCase();
}
function generateSeat() {
  const coach = 'A' + Math.ceil(Math.random() * 3);
  const seat = Math.ceil(Math.random() * 72);
  return `${coach}-${seat}`;
}

// Middleware
function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Admin login required' });
}
function requireSuperAdmin(req, res, next) {
  if (req.session.admin && req.session.is_super_admin) return next();
  res.status(403).json({ error: 'Super admin only' });
}

// --- Admin APIs ---

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM admins WHERE username=?", [username], (err, admin) => {
    if (admin && bcrypt.compareSync(password, admin.password)) {
      req.session.admin = admin.username;
      req.session.is_super_admin = !!admin.is_super_admin;
      res.json({ success: true, is_super_admin: !!admin.is_super_admin });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check Admin Auth
app.get('/api/admin/check', (req, res) => {
  if (req.session.admin) {
    res.json({ admin: req.session.admin, is_super_admin: !!req.session.is_super_admin });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// Create new admin (super admin only)
app.post('/api/admin/create', requireAdmin, requireSuperAdmin, (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO admins (username, password) VALUES (?, ?)", [username, hash], function (err) {
    if (err) return res.status(400).json({ error: 'Username exists' });
    res.json({ success: true });
  });
});

// Add Train
app.post('/api/admin/train', requireAdmin, (req, res) => {
  const { name, source, destination, total_seats, departure } = req.body;
  db.run(`INSERT INTO trains (name, source, destination, total_seats, available_seats, departure)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [name, source, destination, total_seats, total_seats, departure],
    function (err) {
      if (err) return res.status(400).json({ error: 'Train add failed' });
      res.json({ success: true });
    }
  );
});

// Delete Train
app.delete('/api/admin/train/:id', requireAdmin, (req, res) => {
  db.run("DELETE FROM trains WHERE id=?", [req.params.id], function (err) {
    if (err) return res.status(400).json({ error: 'Delete failed' });
    res.json({ success: true });
  });
});

// List Trains
app.get('/api/admin/trains', requireAdmin, (req, res) => {
  db.all("SELECT * FROM trains", (err, rows) => {
    res.json(rows);
  });
});

// --- User APIs ---

// List Trains (public)
app.get('/api/trains', (req, res) => {
  db.all("SELECT * FROM trains WHERE available_seats > 0", (err, rows) => {
    res.json(rows);
  });
});

// Book Ticket
app.post('/api/book', (req, res) => {
  const { passenger_name, age, mobile, address, train_id } = req.body;
  db.get("SELECT * FROM trains WHERE id=?", [train_id], (err, train) => {
    if (!train || train.available_seats <= 0) {
      return res.status(400).json({ error: 'No seats available' });
    }
    const pnr = generatePNR();
    const seat_number = generateSeat();
    const booking_date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    db.run(`INSERT INTO bookings (pnr, passenger_name, age, mobile, address, train_id, seat_number, booking_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pnr, passenger_name, age, mobile, address, train_id, seat_number, booking_date],
      function (err) {
        if (err) return res.status(400).json({ error: 'Booking failed' });
        db.run("UPDATE trains SET available_seats = available_seats - 1 WHERE id=?", [train_id]);
        // Generate PDF ticket
        if (!fs.existsSync('./tickets')) fs.mkdirSync('./tickets');
        const doc = new PDFDocument();
        const pdfPath = `./tickets/${pnr}.pdf`;
        doc.pipe(fs.createWriteStream(pdfPath));
        doc.fontSize(20).text('Railway Ticket', { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(`PNR: ${pnr}`);
        doc.text(`Passenger: ${passenger_name}`);
        doc.text(`Age: ${age}`);
        doc.text(`Mobile: ${mobile}`);
        doc.text(`Address: ${address}`);
        doc.text(`Train: ${train.name} (${train.source} to ${train.destination})`);
        doc.text(`Departure: ${train.departure}`);
        doc.text(`Seat: ${seat_number}`);
        doc.text(`Booking Date: ${booking_date}`);
        doc.end();
        res.json({ success: true, pnr, seat_number, ticket_url: `/tickets/${pnr}.pdf` });
      }
    );
  });
});

// PNR Status
app.get('/api/pnr/:pnr', (req, res) => {
  db.get(`SELECT b.*, t.name as train_name, t.source, t.destination, t.departure
    FROM bookings b JOIN trains t ON b.train_id = t.id WHERE b.pnr=?`, [req.params.pnr], (err, row) => {
    if (!row) return res.status(404).json({ error: 'PNR not found' });
    res.json(row);
  });
});

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

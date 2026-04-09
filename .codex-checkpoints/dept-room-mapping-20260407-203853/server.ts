import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || "smart-campus-secret-key";

// Database Setup
const db = new Database("campus.db");

// Initialize Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    department TEXT,
    designation TEXT,
    role TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    mobile_number TEXT,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campus_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    location TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id TEXT UNIQUE NOT NULL,
    campus_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY(campus_id) REFERENCES campuses(id)
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id TEXT UNIQUE NOT NULL,
    building_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY(building_id) REFERENCES buildings(id)
  );

  CREATE TABLE IF NOT EXISTS floors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id TEXT UNIQUE NOT NULL,
    block_id INTEGER NOT NULL,
    floor_number INTEGER NOT NULL,
    description TEXT,
    FOREIGN KEY(block_id) REFERENCES blocks(id)
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT UNIQUE NOT NULL,
    room_number TEXT NOT NULL,
    floor_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    accessibility TEXT,
    status TEXT DEFAULT 'Available',
    FOREIGN KEY(floor_id) REFERENCES floors(id)
  );

  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    school_id INTEGER NOT NULL,
    type TEXT,
    description TEXT,
    FOREIGN KEY(school_id) REFERENCES schools(id)
  );

  CREATE TABLE IF NOT EXISTS department_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    semester TEXT,
    room_type TEXT,
    capacity INTEGER,
    FOREIGN KEY(school_id) REFERENCES schools(id),
    FOREIGN KEY(department_id) REFERENCES departments(id),
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id TEXT UNIQUE NOT NULL,
    room_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    installation_date DATE,
    condition TEXT,
    maintenance_status TEXT,
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id TEXT UNIQUE NOT NULL,
    department_id INTEGER,
    course_code TEXT,
    course_name TEXT,
    faculty TEXT,
    room_id INTEGER,
    day_of_week TEXT,
    start_time TEXT,
    end_time TEXT,
    student_count INTEGER,
    FOREIGN KEY(department_id) REFERENCES departments(id),
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE NOT NULL,
    faculty_name TEXT NOT NULL,
    department_id INTEGER,
    event_name TEXT,
    student_count INTEGER,
    room_type TEXT,
    room_id INTEGER,
    equipment_required TEXT,
    date DATE,
    start_time TEXT,
    end_time TEXT,
    status TEXT DEFAULT 'Pending',
    FOREIGN KEY(department_id) REFERENCES departments(id),
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    maintenance_id TEXT UNIQUE NOT NULL,
    room_id INTEGER NOT NULL,
    equipment_name TEXT,
    issue_description TEXT,
    reported_date DATE,
    assigned_staff TEXT,
    status TEXT DEFAULT 'Pending',
    FOREIGN KEY(room_id) REFERENCES rooms(id)
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at DATETIME NOT NULL
  );
`);

// Seed Master Admin
const seedAdmin = () => {
  const admin = db.prepare("SELECT * FROM users WHERE role = 'Administrator'").get();
  if (!admin) {
    const hashedPassword = bcrypt.hashSync("admin123", 10);
    db.prepare(`
      INSERT INTO users (full_name, employee_id, role, email, password)
      VALUES (?, ?, ?, ?, ?)
    `).run("Master Admin", "ADMIN001", "Administrator", "admin@smartcampus.ai", hashedPassword);
    console.log("Master Admin created: admin@smartcampus.ai / admin123");
  }
};
seedAdmin();

const ensureColumn = (tableName: string, columnName: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
  if (!columns.some(column => column.name === columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
};

ensureColumn("bookings", "purpose", "TEXT");
ensureColumn("bookings", "notes", "TEXT");

app.use(express.json());
app.use(cookieParser());

// Auth Middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// --- AUTH ROUTES ---

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.full_name }, JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
  res.json({ user: { id: user.id, email: user.email, role: user.role, name: user.full_name } });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ user: decoded });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.post("/api/auth/forgot-password", (req, res) => {
  const { email } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(404).json({ error: "User not found" });
  
  const token = Math.random().toString(36).substring(2, 15);
  const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour
  db.prepare("INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)").run(email, token, expiresAt);
  
  // In a real app, send email. Here we just return the token for the demo flow.
  res.json({ success: true, message: "Reset link sent to email", token });
});

app.post("/api/auth/reset-password", (req, res) => {
  const { token, password } = req.body;
  const reset: any = db.prepare("SELECT * FROM reset_tokens WHERE token = ? AND expires_at > ?").get(token, new Date().toISOString());
  if (!reset) return res.status(400).json({ error: "Invalid or expired token" });
  
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password = ? WHERE email = ?").run(hashedPassword, reset.email);
  db.prepare("DELETE FROM reset_tokens WHERE token = ?").run(token);
  res.json({ success: true });
});

// --- CRUD ROUTES ---

const duplicateRules: Record<string, Array<{ fields: string[]; label: string }>> = {
  users: [
    { fields: ["employee_id"], label: "Employee ID" },
    { fields: ["email"], label: "Email" },
  ],
  campuses: [
    { fields: ["campus_id"], label: "Campus ID" },
    { fields: ["name"], label: "Campus name" },
  ],
  buildings: [
    { fields: ["building_id"], label: "Building ID" },
    { fields: ["campus_id", "name"], label: "Building name in this campus" },
  ],
  blocks: [
    { fields: ["block_id"], label: "Block ID" },
    { fields: ["building_id", "name"], label: "Block name in this building" },
  ],
  floors: [
    { fields: ["floor_id"], label: "Floor ID" },
    { fields: ["block_id", "floor_number"], label: "Floor number in this block" },
  ],
  rooms: [
    { fields: ["room_id"], label: "Room ID" },
    { fields: ["room_number"], label: "Room number" },
  ],
  schools: [
    { fields: ["school_id"], label: "School ID" },
    { fields: ["name"], label: "School name" },
  ],
  departments: [
    { fields: ["department_id"], label: "Department ID" },
    { fields: ["school_id", "name"], label: "Department name in this school" },
  ],
  department_allocations: [
    { fields: ["room_id"], label: "Room allocation" },
  ],
  equipment: [
    { fields: ["equipment_id"], label: "Equipment ID" },
    { fields: ["room_id", "name"], label: "Equipment name in this room" },
  ],
  schedules: [
    { fields: ["schedule_id"], label: "Schedule ID" },
    { fields: ["room_id", "day_of_week", "start_time", "end_time"], label: "Schedule slot for this room" },
  ],
  bookings: [
    { fields: ["request_id"], label: "Request ID" },
  ],
  maintenance: [
    { fields: ["maintenance_id"], label: "Maintenance ID" },
  ],
};

const normalizeDuplicateValue = (value: any) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

const checkDuplicateRecord = (tableName: string, data: any, excludeId?: string | number) => {
  const rules = duplicateRules[tableName] || [];

  for (const rule of rules) {
    if (rule.fields.some(field => data[field] == null || data[field] === "")) continue;

    const whereClause = rule.fields
      .map(field => typeof data[field] === "string" ? `LOWER(TRIM(${field})) = ?` : `${field} = ?`)
      .join(" AND ");
    const values = rule.fields.map(field => normalizeDuplicateValue(data[field]));
    const query = `SELECT id FROM ${tableName} WHERE ${whereClause}${excludeId ? " AND id != ?" : ""}`;
    const existing = db.prepare(query).get(...values, ...(excludeId ? [excludeId] : []));

    if (existing) {
      return `${rule.label} already exists. Duplicate records are not allowed.`;
    }
  }

  return null;
};

const isPastDateTime = (date: string, time: string) => {
  const value = new Date(`${date}T${time}`);
  return Number.isNaN(value.getTime()) || value.getTime() < Date.now();
};

const createCrudRoutes = (tableName: string, idField: string = "id") => {
  app.get(`/api/${tableName}`, authenticate, (req, res) => {
    if (tableName === "bookings") {
      const bookings = db.prepare(`
        SELECT bk.*, r.room_number
        FROM bookings bk
        LEFT JOIN rooms r ON bk.room_id = r.id
      `).all();
      return res.json(bookings);
    }

    const items = db.prepare(`SELECT * FROM ${tableName}`).all();
    res.json(items);
  });

  app.post(`/api/${tableName}`, authenticate, (req, res) => {
    const fields = Object.keys(req.body);
    const placeholders = fields.map(() => "?").join(", ");
    const values = Object.values(req.body);
    
    // Special handling for user password
    if (tableName === 'users' && req.body.password) {
      const passIdx = fields.indexOf('password');
      values[passIdx] = bcrypt.hashSync(req.body.password, 10);
    }

    try {
      const duplicateError = checkDuplicateRecord(tableName, req.body);
      if (duplicateError) {
        return res.status(400).json({ error: duplicateError });
      }

      if (tableName === "bookings") {
        if (!req.body.room_id || !req.body.date || !req.body.start_time || !req.body.end_time) {
          return res.status(400).json({ error: "Room, date, start time, and end time are required." });
        }

        if (isPastDateTime(req.body.date, req.body.start_time)) {
          return res.status(400).json({ error: "Past booking times are not allowed." });
        }

        if (req.body.status === "Approved") {
          const conflictingBooking = db.prepare(`
            SELECT id FROM bookings
            WHERE room_id = ?
            AND date = ?
            AND status = 'Approved'
            AND NOT (end_time <= ? OR start_time >= ?)
          `).get(req.body.room_id, req.body.date, req.body.start_time, req.body.end_time);

          if (conflictingBooking) {
            return res.status(400).json({ error: "This room is already booked for the selected time." });
          }
        }
      }

      const info = db.prepare(`INSERT INTO ${tableName} (${fields.join(", ")}) VALUES (${placeholders})`).run(...values);
      res.json({ id: info.lastInsertRowid, ...req.body });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put(`/api/${tableName}/:id`, authenticate, (req, res) => {
    const fields = Object.keys(req.body);
    const setClause = fields.map(f => `${f} = ?`).join(", ");
    const values = [...Object.values(req.body), req.params.id];

    // Special handling for user password update
    if (tableName === 'users' && req.body.password) {
      const passIdx = fields.indexOf('password');
      values[passIdx] = bcrypt.hashSync(req.body.password, 10);
    }

    try {
      const existingItem = db.prepare(`SELECT * FROM ${tableName} WHERE ${idField} = ?`).get(req.params.id) as any;
      const duplicateError = checkDuplicateRecord(tableName, { ...existingItem, ...req.body }, req.params.id);
      if (duplicateError) {
        return res.status(400).json({ error: duplicateError });
      }

      if (tableName === "bookings") {
        const nextBooking = { ...existingItem, ...req.body };
        if (nextBooking.room_id && nextBooking.date && nextBooking.start_time && nextBooking.end_time && isPastDateTime(nextBooking.date, nextBooking.start_time)) {
          return res.status(400).json({ error: "Past booking times are not allowed." });
        }

        if (nextBooking.status === "Approved" && nextBooking.room_id && nextBooking.date && nextBooking.start_time && nextBooking.end_time) {
          const conflictingBooking = db.prepare(`
            SELECT id FROM bookings
            WHERE room_id = ?
            AND date = ?
            AND status = 'Approved'
            AND id != ?
            AND NOT (end_time <= ? OR start_time >= ?)
          `).get(nextBooking.room_id, nextBooking.date, req.params.id, nextBooking.start_time, nextBooking.end_time);

          if (conflictingBooking) {
            return res.status(400).json({ error: "This room is already booked for the selected time." });
          }
        }
      }

      db.prepare(`UPDATE ${tableName} SET ${setClause} WHERE ${idField} = ?`).run(...values);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete(`/api/${tableName}/reset`, authenticate, (req, res) => {
    try {
      db.prepare(`DELETE FROM ${tableName}`).run();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete(`/api/${tableName}/:id`, authenticate, (req, res) => {
    try {
      db.prepare(`DELETE FROM ${tableName} WHERE ${idField} = ?`).run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
};

createCrudRoutes("users");
createCrudRoutes("campuses");
createCrudRoutes("buildings");
createCrudRoutes("blocks");
createCrudRoutes("floors");
createCrudRoutes("rooms");
createCrudRoutes("schools");
createCrudRoutes("departments");
createCrudRoutes("department_allocations");
createCrudRoutes("equipment");
createCrudRoutes("schedules");
createCrudRoutes("bookings");
createCrudRoutes("maintenance");
  app.get(`/api/rooms`, authenticate, (req, res) => {
    const items = db.prepare(`SELECT * FROM rooms`).all() as any[];
    
    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const currentDate = now.toISOString().split('T')[0];

    const enrichedItems = items.map(room => {
      if (room.status !== 'Available') return room;

      const schedule = db.prepare(`
        SELECT * FROM schedules 
        WHERE room = ? AND day_of_week = ? AND start_time <= ? AND end_time > ?
      `).get(room.room_number, dayOfWeek, currentTime, currentTime);

      if (schedule) return { ...room, status: 'Occupied (Scheduled)' };

      const booking = db.prepare(`
        SELECT * FROM bookings 
        WHERE room_number = ? AND date = ? AND status = 'Approved' AND start_time <= ? AND end_time > ?
      `).get(room.room_number, currentDate, currentTime, currentTime);

      if (booking) return { ...room, status: 'Occupied (Booked)' };

      return room;
    });

    res.json(enrichedItems);
  });

  app.get(`/api/rooms/:roomId/schedule`, authenticate, (req, res) => {
    const { roomId } = req.params;
    const { date } = req.query;
    const dayOfWeek = new Date(date as string).toLocaleDateString('en-US', { weekday: 'long' });
    
    const schedules = db.prepare(`SELECT * FROM schedules WHERE room_id = ? AND day_of_week = ?`).all(roomId, dayOfWeek);
    const bookings = db.prepare(`SELECT * FROM bookings WHERE room_id = ? AND date = ? AND status = 'Approved'`).all(roomId, date);
    
    res.json({ schedules, bookings });
  });

  createCrudRoutes("rooms");
createCrudRoutes("equipment");
createCrudRoutes("schedules");
createCrudRoutes("bookings");
createCrudRoutes("maintenance");
createCrudRoutes("schools");
createCrudRoutes("departments");

// --- DASHBOARD STATS ---

app.get("/api/dashboard/stats", authenticate, (req, res) => {
  try {
    const totalBuildings = db.prepare("SELECT COUNT(*) as count FROM buildings").get() as any;
    const totalRooms = db.prepare("SELECT COUNT(*) as count FROM rooms").get() as any;
    const maintenanceRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'Maintenance'").get() as any;
    const equipmentIssues = db.prepare("SELECT COUNT(*) as count FROM maintenance WHERE status = 'Pending'").get() as any;
    const pendingBookings = db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'Pending'").get() as any;
    
    // Calculate currently scheduled rooms
    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const currentDate = now.toISOString().split('T')[0];

    const currentlyScheduled = db.prepare(`
      SELECT COUNT(DISTINCT room_id) as count FROM (
        SELECT room_id FROM schedules 
        WHERE day_of_week = ? AND start_time <= ? AND end_time > ?
        UNION
        SELECT room_id FROM bookings 
        WHERE date = ? AND status = 'Approved' AND start_time <= ? AND end_time > ?
      )
    `).get(dayOfWeek, currentTime, currentTime, currentDate, currentTime, currentTime) as any;

    const availableNow = totalRooms.count - maintenanceRooms.count - currentlyScheduled.count;

    const recentAlerts = db.prepare(`
      SELECT m.*, r.room_number, bld.name as building_name
      FROM maintenance m 
      JOIN rooms r ON m.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      JOIN blocks b ON f.block_id = b.id
      JOIN buildings bld ON b.building_id = bld.id
      ORDER BY m.reported_date DESC 
      LIMIT 5
    `).all();

    res.json({
      totalBuildings: totalBuildings.count,
      availableNow: availableNow,
      equipmentIssues: equipmentIssues.count,
      pendingBookings: pendingBookings.count,
      scheduledRooms: currentlyScheduled.count,
      recentAlerts
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- VACANCY CHECK ROUTE ---

app.get("/api/rooms/vacant", authenticate, (req, res) => {
  const { date, time, duration, members } = req.query;
  if (!date || !time || !duration) {
    return res.status(400).json({ error: "Date, time, and duration are required" });
  }

  if (isPastDateTime(date as string, time as string)) {
    return res.status(400).json({ error: "Past search times are not allowed." });
  }

  const dayOfWeek = new Date(date as string).toLocaleDateString('en-US', { weekday: 'long' });
  const requestedStart = time as string;
  
  // Calculate end time
  const [h, m] = requestedStart.split(':').map(Number);
  const durationMinutes = Math.round((parseFloat(duration as string) || 1) * 60);
  const endDate = new Date();
  endDate.setHours(h, m || 0, 0, 0);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);
  const requestedEnd = `${endDate.getHours().toString().padStart(2, '0')}:${endDate.getMinutes().toString().padStart(2, '0')}`;

  // Find all rooms
  let roomsQuery = "SELECT * FROM rooms WHERE status = 'Available'";
  if (members) {
    roomsQuery += ` AND capacity >= ${members}`;
  }
  const allRooms = db.prepare(roomsQuery).all() as any[];

  // Filter out rooms that have schedules
  const busySchedules = db.prepare(`
    SELECT room_id FROM schedules 
    WHERE day_of_week = ? 
    AND NOT (end_time <= ? OR start_time >= ?)
  `).all(dayOfWeek, requestedStart, requestedEnd) as any[];

  // Filter out rooms that have bookings
  const busyBookings = db.prepare(`
    SELECT room_id FROM bookings 
    WHERE date = ? 
    AND status = 'Approved'
    AND NOT (end_time <= ? OR start_time >= ?)
  `).all(date, requestedStart, requestedEnd) as any[];

  const busyRoomIds = new Set([
    ...busySchedules.map(s => s.room_id),
    ...busyBookings.map(b => b.room_id)
  ]);

  const vacantRooms = allRooms.filter(r => !busyRoomIds.has(r.id));
  res.json(vacantRooms);
});

// --- USAGE REPORTS & AI SUGGESTIONS ---

app.get("/api/events/search-rooms", authenticate, (req, res) => {
  const { date, startTime, endTime, strength } = req.query;
  const targetStrength = parseInt(strength as string) || 0;
  const dayOfWeek = new Date(date as string).toLocaleDateString('en-US', { weekday: 'long' });

  try {
    // 1. Get all rooms
    const allRooms = db.prepare("SELECT * FROM rooms WHERE status = 'Available'").all() as any[];
    
    // 2. Get busy rooms from schedules
    const busyInSchedules = db.prepare(`
      SELECT DISTINCT room_id FROM schedules 
      WHERE day_of_week = ? 
      AND (
        (start_time < ? AND end_time > ?) OR
        (start_time < ? AND end_time > ?) OR
        (start_time >= ? AND start_time < ?)
      )
    `).all(dayOfWeek, endTime, startTime, startTime, endTime, startTime, endTime) as any[];
    const busyRoomIdsSchedules = new Set(busyInSchedules.map(s => s.room_id));

    // 3. Get busy rooms from bookings
    const busyInBookings = db.prepare(`
      SELECT DISTINCT room_id FROM bookings 
      WHERE date = ? AND status = 'Approved'
      AND (
        (start_time < ? AND end_time > ?) OR
        (start_time < ? AND end_time > ?) OR
        (start_time >= ? AND start_time < ?)
      )
    `).all(date, endTime, startTime, startTime, endTime, startTime, endTime) as any[];
    const busyRoomIdsBookings = new Set(busyInBookings.map(b => b.room_id));

    // 4. Filter vacant rooms
    const vacantRooms = allRooms.filter(r => !busyRoomIdsSchedules.has(r.id) && !busyRoomIdsBookings.has(r.id));

    // 5. Find single room options
    const singleOptions = vacantRooms
      .filter(r => r.capacity >= targetStrength)
      .sort((a, b) => a.capacity - b.capacity); // Closest fit first

    // 6. Find multi-room options if no single room is large enough or as alternatives
    const multiOptions: any[] = [];
    if (singleOptions.length === 0) {
      const sortedVacant = [...vacantRooms].sort((a, b) => b.capacity - a.capacity);
      let currentCapacity = 0;
      const combination = [];
      for (const r of sortedVacant) {
        combination.push(r);
        currentCapacity += r.capacity;
        if (currentCapacity >= targetStrength) break;
      }
      if (currentCapacity >= targetStrength) {
        multiOptions.push({
          rooms: combination,
          totalCapacity: currentCapacity,
          proximityScore: 100
        });
      }
    }

    res.json({ singleOptions, multiOptions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/reports/utilization", authenticate, (req, res) => {
  try {
    const rooms = db.prepare(`
      SELECT r.*, bld.name as building_name, da.department_id
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      JOIN blocks b ON f.block_id = b.id
      JOIN buildings bld ON b.building_id = bld.id
      LEFT JOIN department_allocations da ON r.id = da.room_id
    `).all() as any[];
    const schedules = db.prepare("SELECT * FROM schedules").all() as any[];
    const bookings = db.prepare("SELECT * FROM bookings WHERE status = 'Approved'").all() as any[];
    const departments = db.prepare("SELECT * FROM departments").all() as any[];
    const schools = db.prepare("SELECT * FROM schools").all() as any[];

    const calculateHours = (start: string, end: string) => {
      if (!start || !end) return 0;
      const [h1, m1] = start.split(':').map(Number);
      const [h2, m2] = end.split(':').map(Number);
      return (h2 + m2 / 60) - (h1 + m1 / 60);
    };

    const reports = rooms.map(room => {
      const roomSchedules = schedules.filter(s => s.room_id === room.id);
      const roomBookings = bookings.filter(b => b.room_id === room.id);

      const scheduledHours = roomSchedules.reduce((acc, s) => acc + calculateHours(s.start_time, s.end_time), 0);
      const bookedHours = roomBookings.reduce((acc, b) => {
        const h = calculateHours(b.start_time, b.end_time);
        return acc + h;
      }, 0);
      
      const totalUsedHours = scheduledHours + bookedHours;
      const availableHours = 72; // Assuming 12h * 6 days
      const utilization = (totalUsedHours / availableHours) * 100;

      return {
        room_number: room.room_number,
        building: room.building_name,
        department_id: room.department_id,
        utilization: Math.min(100, Math.round(utilization)),
        totalUsedHours: Math.round(totalUsedHours * 10) / 10,
        scheduledHours: Math.round(scheduledHours * 10) / 10,
        bookedHours: Math.round(bookedHours * 10) / 10
      };
    });

    // Aggregate by Department
    const deptReports = departments.map(dept => {
      const deptRooms = reports.filter(r => r.department_id === dept.id);
      const totalUtilization = deptRooms.reduce((acc, r) => acc + r.utilization, 0);
      const avgUtilization = deptRooms.length > 0 ? totalUtilization / deptRooms.length : 0;

      return {
        name: dept.name,
        school_id: dept.school_id,
        avgUtilization: Math.round(avgUtilization),
        roomCount: deptRooms.length
      };
    });

    // Aggregate by School
    const schoolReports = schools.map(school => {
      const schoolDepts = deptReports.filter(d => d.school_id === school.id);
      const totalUtilization = schoolDepts.reduce((acc, d) => acc + d.avgUtilization, 0);
      const avgUtilization = schoolDepts.length > 0 ? totalUtilization / schoolDepts.length : 0;

      return {
        name: school.name,
        avgUtilization: Math.round(avgUtilization),
        deptCount: schoolDepts.length
      };
    });

    res.json({ roomReports: reports, deptReports, schoolReports });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ANALYTICS ENDPOINTS ---

app.get("/api/analytics/utilization-trends", authenticate, (req, res) => {
  try {
    const rooms = db.prepare("SELECT id, room_number FROM rooms").all() as any[];
    const schedules = db.prepare("SELECT room_id, start_time, end_time FROM schedules").all() as any[];
    const bookings = db.prepare("SELECT room_id, start_time, end_time FROM bookings WHERE status = 'Approved'").all() as any[];

    const calculateHours = (start: string, end: string) => {
      if (!start || !end) return 0;
      const [h1, m1] = start.split(':').map(Number);
      const [h2, m2] = end.split(':').map(Number);
      return (h2 + m2 / 60) - (h1 + m1 / 60);
    };

    const data = rooms.map(room => {
      const sHours = schedules.filter(s => s.room_id === room.id).reduce((acc, s) => acc + calculateHours(s.start_time, s.end_time), 0);
      const bHours = bookings.filter(b => b.room_id === room.id).reduce((acc, b) => acc + calculateHours(b.start_time, b.end_time), 0);
      const total = sHours + bHours;
      const utilization = Math.min(100, Math.round((total / 72) * 100)); // 72h week
      return { name: room.room_number, utilization };
    });

    res.json(data.sort((a, b) => b.utilization - a.utilization).slice(0, 10));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/analytics/booking-frequency", authenticate, (req, res) => {
  try {
    const data = db.prepare(`
      SELECT bld.name as name, COUNT(*) as count 
      FROM bookings bk
      JOIN rooms r ON bk.room_id = r.id
      JOIN floors f ON r.floor_id = f.id
      JOIN blocks b ON f.block_id = b.id
      JOIN buildings bld ON b.building_id = bld.id
      GROUP BY bld.name
    `).all();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function healInfrastructureHierarchy() {
  const campus = db.prepare("SELECT * FROM campuses LIMIT 1").get();
  let defaultCampusId = campus?.id;
  if (!defaultCampusId) {
    const info = db.prepare("INSERT INTO campuses (campus_id, name, location, description) VALUES (?, ?, ?, ?)").run('CAMPUS-1', 'Default Campus', 'Default Location', 'Auto-healed campus');
    defaultCampusId = Number(info.lastInsertRowid);
  }

  // Buildings
  const buildings = db.prepare("SELECT * FROM buildings").all();
  for (const b of buildings) {
    const exists = db.prepare("SELECT 1 FROM campuses WHERE id = ?").get(b.campus_id);
    if (!exists) {
      db.prepare("UPDATE buildings SET campus_id = ? WHERE id = ?").run(defaultCampusId, b.id);
    }
  }
  const buildingCheck = db.prepare("SELECT * FROM buildings LIMIT 1").get();
  let defaultBuildingId = buildingCheck?.id;
  if (!defaultBuildingId) {
    const info = db.prepare("INSERT INTO buildings (building_id, campus_id, name, description) VALUES (?, ?, ?, ?)").run('BUILD-1', defaultCampusId, 'Default Building', 'Auto-healed building');
    defaultBuildingId = Number(info.lastInsertRowid);
  }

  // Blocks
  const blocks = db.prepare("SELECT * FROM blocks").all();
  for (const bl of blocks) {
    const exists = db.prepare("SELECT 1 FROM buildings WHERE id = ?").get(bl.building_id);
    if (!exists) {
      db.prepare("UPDATE blocks SET building_id = ? WHERE id = ?").run(defaultBuildingId, bl.id);
    }
  }
  const blockCheck = db.prepare("SELECT * FROM blocks LIMIT 1").get();
  let defaultBlockId = blockCheck?.id;
  if (!defaultBlockId) {
    const info = db.prepare("INSERT INTO blocks (block_id, building_id, name, description) VALUES (?, ?, ?, ?)").run('BLOCK-1', defaultBuildingId, 'Default Block', 'Auto-healed block');
    defaultBlockId = Number(info.lastInsertRowid);
  }

  // Floors
  const floors = db.prepare("SELECT * FROM floors").all();
  for (const f of floors) {
    const exists = db.prepare("SELECT 1 FROM blocks WHERE id = ?").get(f.block_id);
    if (!exists) {
      db.prepare("UPDATE floors SET block_id = ? WHERE id = ?").run(defaultBlockId, f.id);
    }
  }
  const floorCheck = db.prepare("SELECT * FROM floors LIMIT 1").get();
  let defaultFloorId = floorCheck?.id;
  if (!defaultFloorId) {
    const info = db.prepare("INSERT INTO floors (floor_id, block_id, floor_number, description) VALUES (?, ?, ?, ?)").run('FLR-1', defaultBlockId, 1, 'Auto-healed floor');
    defaultFloorId = Number(info.lastInsertRowid);
  }

  // Rooms
  const rooms = db.prepare("SELECT * FROM rooms").all();
  for (const r of rooms) {
    const exists = db.prepare("SELECT 1 FROM floors WHERE id = ?").get(r.floor_id);
    if (!exists) {
      db.prepare("UPDATE rooms SET floor_id = ? WHERE id = ?").run(defaultFloorId, r.id);
    }
  }
  const roomCheck = db.prepare("SELECT * FROM rooms LIMIT 1").get();
  if (!roomCheck) {
    db.prepare("INSERT INTO rooms (room_id, room_number, floor_id, room_type, capacity) VALUES (?, ?, ?, ?, ?)").run('ROOM-1', '101', defaultFloorId, 'Lecture', 40);
  }

  return {
    status: 'healed',
    campus: defaultCampusId,
    building: defaultBuildingId,
    block: defaultBlockId,
    floor: defaultFloorId,
  };
}

app.get('/api/health/heal', authenticate, (req, res) => {
  try {
    const healed = healInfrastructureHierarchy();
    res.json({ success: true, healed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const startPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  let currentPort = isNaN(startPort) ? 3000 : startPort;

  const launchServer = () => {
    const server = app.listen(currentPort, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${currentPort}`);
    });

    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`Port ${currentPort} already in use. Trying ${currentPort + 1}...`);
        currentPort += 1;
        if (currentPort > 3100) {
          console.error("No free port available between 3000 and 3100. Exiting.");
          process.exit(1);
        }
        launchServer();
      } else {
        console.error("Server error:", err);
        process.exit(1);
      }
    });
  };

  launchServer();
}

startServer();

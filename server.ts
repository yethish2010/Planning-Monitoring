import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const JWT_SECRET = process.env.JWT_SECRET || "smart-campus-secret-key";
const isProduction = process.env.NODE_ENV === "production";
const isVercelRuntime = process.env.VERCEL === "1";
const defaultDatabasePath = isVercelRuntime
  ? path.join("/tmp", "campus.db")
  : path.join(process.cwd(), "campus.db");
const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : defaultDatabasePath;
const normalizeOrigin = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
};
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_ORIGIN,
    process.env.APP_URL,
    "https://yethish2010.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

const databaseDir = path.dirname(databasePath);
if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}

// Database Setup
const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

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
    responsibilities TEXT,
    access_limits TEXT,
    access_paths TEXT,
    force_password_change INTEGER DEFAULT 0,
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
    FOREIGN KEY(campus_id) REFERENCES campuses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id TEXT UNIQUE NOT NULL,
    building_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY(building_id) REFERENCES buildings(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS floors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor_id TEXT UNIQUE NOT NULL,
    block_id INTEGER NOT NULL,
    floor_number INTEGER NOT NULL,
    description TEXT,
    FOREIGN KEY(block_id) REFERENCES blocks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT UNIQUE NOT NULL,
    room_number TEXT NOT NULL,
    floor_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    lab_name TEXT,
    restroom_type TEXT,
    capacity INTEGER NOT NULL,
    accessibility TEXT,
    status TEXT DEFAULT 'Available',
    FOREIGN KEY(floor_id) REFERENCES floors(id) ON DELETE CASCADE
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
    FOREIGN KEY(school_id) REFERENCES schools(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS department_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    room_id INTEGER NOT NULL,
    semester TEXT,
    room_type TEXT,
    capacity INTEGER,
    FOREIGN KEY(school_id) REFERENCES schools(id) ON DELETE CASCADE,
    FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
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
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
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
    FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
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
    purpose TEXT,
    notes TEXT,
    date DATE,
    start_time TEXT,
    end_time TEXT,
    status TEXT DEFAULT 'Pending',
    recommended_by TEXT,
    decided_by TEXT,
    FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
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
    FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
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

const ensureBookingColumns = () => {
  ensureColumn("bookings", "purpose", "TEXT");
  ensureColumn("bookings", "notes", "TEXT");
  ensureColumn("bookings", "recommended_by", "TEXT");
  ensureColumn("bookings", "decided_by", "TEXT");
  ensureColumn("bookings", "request_group_id", "TEXT");
};

ensureBookingColumns();
ensureColumn("rooms", "lab_name", "TEXT");
ensureColumn("rooms", "restroom_type", "TEXT");
ensureColumn("users", "responsibilities", "TEXT");
ensureColumn("users", "access_limits", "TEXT");
ensureColumn("users", "access_paths", "TEXT");
ensureColumn("users", "force_password_change", "INTEGER DEFAULT 0");

const normalizeRoomTypeValue = (value: any) => {
  const normalized = value?.toString().trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "restroom" || normalized === "restrooms") return "Restroom";
  if (normalized === "lab" || normalized === "laboratory") return "Lab";
  return value?.toString().trim() || "";
};

const normalizeRestroomTypeValue = (value: any) => {
  const normalized = value?.toString().trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "male" || normalized === "boys" || normalized === "men") return "Male";
  if (normalized === "female" || normalized === "girls" || normalized === "women") return "Female";
  return value?.toString().trim() || "";
};

const normalizeRoomPayload = (payload: any) => {
  const nextPayload = { ...payload };
  nextPayload.room_type = normalizeRoomTypeValue(nextPayload.room_type);
  nextPayload.lab_name = nextPayload.lab_name?.toString().trim() || null;
  nextPayload.restroom_type = normalizeRestroomTypeValue(nextPayload.restroom_type) || null;

  if (nextPayload.room_type === "Lab") {
    if (!nextPayload.lab_name) {
      throw new Error("Lab name is required when the room type is Lab.");
    }
    nextPayload.restroom_type = null;
  } else if (nextPayload.room_type === "Restroom") {
    if (!["Male", "Female"].includes(nextPayload.restroom_type || "")) {
      throw new Error("Please choose Male or Female when the room type is Restroom.");
    }
    nextPayload.lab_name = null;
  } else {
    nextPayload.lab_name = null;
    nextPayload.restroom_type = null;
  }

  return nextPayload;
};

const ensureNotificationsTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_role TEXT,
    target_name TEXT,
    target_department TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn("notifications", "target_department", "TEXT");
};

const ensureNotificationReadsTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      notification_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id),
      FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
};

ensureNotificationsTable();
ensureNotificationReadsTable();

const createNotification = (targetRole: string | null, targetName: string | null, title: string, message: string, targetDepartment: string | null = null) => {
  ensureNotificationsTable();
  db.prepare("INSERT INTO notifications (target_role, target_name, target_department, title, message) VALUES (?, ?, ?, ?, ?)")
    .run(targetRole, targetName, targetDepartment, title, message);
};

const getDepartmentNameById = (departmentId?: string | number | null) => {
  if (!departmentId) return null;
  const department = db.prepare("SELECT name FROM departments WHERE id = ?").get(departmentId) as any;
  return department?.name || null;
};

const backfillNotificationsIfEmpty = () => {
  ensureNotificationsTable();
  ensureNotificationReadsTable();
  const notificationCount = db.prepare("SELECT COUNT(*) as count FROM notifications").get() as any;
  if ((notificationCount?.count || 0) > 0) return;

  const bookings = db.prepare("SELECT * FROM bookings ORDER BY id ASC").all() as any[];
  for (const booking of bookings) {
    const bookingLabel = booking.event_name || "room request";
    const bookingTime = booking.date && booking.start_time && booking.end_time
      ? `${booking.date} from ${booking.start_time} to ${booking.end_time}`
      : booking.date || "the selected slot";
    const departmentName = getDepartmentNameById(booking.department_id);

    if (booking.status === "Pending") {
      createNotification(null, booking.faculty_name, "Room request submitted", `${bookingLabel} was submitted for approval for ${bookingTime}.`);
      notifyBookingAuthorities(booking, "New room request", `${booking.faculty_name} requested ${bookingLabel} on ${bookingTime}.`);
      continue;
    }

    if (booking.status === "HOD Recommended") {
      createNotification(null, booking.faculty_name, "Request recommended", `${bookingLabel} was recommended by HOD for ${bookingTime}.`);
      createNotification("Dean (P&M)", null, "Request recommended", `${bookingLabel} was recommended by HOD for ${bookingTime}.`);
      createNotification("Deputy Dean (P&M)", null, "Request recommended", `${bookingLabel} was recommended by HOD for ${bookingTime}.`);
      if (departmentName) {
        createNotification("HOD", null, "Request recommended", `${bookingLabel} was recommended by HOD for ${bookingTime}.`, departmentName);
      }
      continue;
    }

    if (booking.status === "Approved") {
      createNotification(null, booking.faculty_name, "Room booking approved", `${bookingLabel} was approved for ${bookingTime}.`);
      continue;
    }

    if (booking.status === "Rejected" || booking.status === "Postponed") {
      createNotification(null, booking.faculty_name, `Request ${booking.status}`, `${bookingLabel} was marked as ${booking.status.toLowerCase()} for ${bookingTime}.`);
    }
  }
};

const getNotificationAudienceParams = (user: any) => {
  const normalizedRole = user?.role || null;
  const normalizedName = user?.name?.toString().trim().toLowerCase() || null;
  const normalizedDepartment = user?.department?.toString().trim().toLowerCase() || null;

  return { normalizedRole, normalizedName, normalizedDepartment };
};

const getNotificationsForUser = (user: any, limit = 20) => {
  ensureNotificationsTable();
  ensureNotificationReadsTable();
  const { normalizedRole, normalizedName, normalizedDepartment } = getNotificationAudienceParams(user);

  return db.prepare(`
    SELECT
      n.*,
      CASE WHEN nr.notification_id IS NULL THEN 0 ELSE 1 END as is_read
    FROM notifications n
    LEFT JOIN notification_reads nr
      ON nr.notification_id = n.id
      AND nr.user_id = ?
    WHERE (n.target_role IS NULL AND n.target_name IS NULL AND n.target_department IS NULL)
      OR (n.target_role = ? AND n.target_department IS NULL)
      OR LOWER(TRIM(COALESCE(n.target_name, ''))) = ?
      OR (n.target_role = ? AND LOWER(TRIM(COALESCE(n.target_department, ''))) = ?)
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ?
  `).all(user.id, normalizedRole, normalizedName, normalizedRole, normalizedDepartment, limit);
};

const markAllNotificationsRead = (user: any, notificationIds?: number[]) => {
  ensureNotificationsTable();
  ensureNotificationReadsTable();
  const normalizedIds = Array.isArray(notificationIds)
    ? notificationIds.map(id => parseInt(id as any, 10)).filter(id => Number.isInteger(id) && id > 0)
    : [];
  const visibleNotificationIds = getNotificationsForUser(user, 1000)
    .map((notification: any) => notification.id)
    .filter((id: number) => normalizedIds.length === 0 || normalizedIds.includes(id));

  if (visibleNotificationIds.length === 0) return;

  const insertRead = db.prepare(`
    INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const markReadTransaction = db.transaction((ids: number[]) => {
    ids.forEach(id => insertRead.run(id, user.id));
  });

  markReadTransaction(visibleNotificationIds);
};

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  const requestOrigin = normalizeOrigin(typeof req.headers.origin === "string" ? req.headers.origin : "");

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.header("Access-Control-Allow-Origin", requestOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header("Vary", "Origin");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
  }

  next();
});

const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
});

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

const getUserSessionPayload = (user: any) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  name: user.full_name,
  department: user.department,
  designation: user.designation,
  responsibilities: user.responsibilities,
  access_limits: user.access_limits,
  access_paths: user.access_paths,
  force_password_change: !!user.force_password_change
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const sessionUser = getUserSessionPayload(user);
  const token = jwt.sign(sessionUser, JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, getAuthCookieOptions());
  res.json({ user: sessionUser });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", getAuthCookieOptions());
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

app.get("/api/notifications", authenticate, (req: any, res) => {
  const notifications = getNotificationsForUser(req.user);
  res.json(notifications);
});

app.post("/api/notifications/read-all", authenticate, (req: any, res) => {
  try {
    markAllNotificationsRead(req.user, req.body?.notificationIds);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/forgot-password", (req, res) => {
  res.status(403).json({ error: "Password reset is handled by the Administrator." });
});

app.post("/api/auth/reset-password", (req, res) => {
  res.status(403).json({ error: "Password reset is handled by the Administrator." });
});

app.post("/api/auth/change-password", authenticate, (req: any, res) => {
  const { password } = req.body;
  if (!password || password.toString().trim().length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const hashedPassword = bcrypt.hashSync(password.toString(), 10);
  db.prepare("UPDATE users SET password = ?, force_password_change = 0 WHERE id = ?").run(hashedPassword, req.user.id);
  const user: any = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const sessionUser = getUserSessionPayload(user);
  const token = jwt.sign(sessionUser, JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, getAuthCookieOptions());
  res.json({ user: sessionUser });
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

const getBookingDepartmentName = (booking: any) => {
  if (!booking?.department_id) return null;
  const department = db.prepare("SELECT name FROM departments WHERE id = ?").get(booking.department_id) as any;
  return department?.name || null;
};

const isDecisionRole = (role: string) => ["Administrator", "Dean (P&M)", "Deputy Dean (P&M)"].includes(role);
const openBookingStatuses = ["Pending", "HOD Recommended", "Approved"];

const getApprovedBookingConflict = (booking: any, excludeId?: string | number) => {
  if (!booking?.room_id || !booking?.date || !booking?.start_time || !booking?.end_time) return null;
  return db.prepare(`
    SELECT id FROM bookings
    WHERE room_id = ?
    AND date = ?
    AND status = 'Approved'
    ${excludeId ? "AND id != ?" : ""}
    AND NOT (end_time <= ? OR start_time >= ?)
  `).get(
    booking.room_id,
    booking.date,
    ...(excludeId ? [excludeId] : []),
    booking.start_time,
    booking.end_time
  ) as any;
};

const getDuplicateOpenBookingRequest = (booking: any, excludeId?: string | number) => {
  if (!booking?.faculty_name || !booking?.room_id || !booking?.date || !booking?.start_time || !booking?.end_time) return null;
  return db.prepare(`
    SELECT id FROM bookings
    WHERE faculty_name = ?
    AND room_id = ?
    AND date = ?
    AND start_time = ?
    AND end_time = ?
    AND status IN (${openBookingStatuses.map(() => "?").join(", ")})
    ${excludeId ? "AND id != ?" : ""}
  `).get(
    booking.faculty_name,
    booking.room_id,
    booking.date,
    booking.start_time,
    booking.end_time,
    ...openBookingStatuses,
    ...(excludeId ? [excludeId] : [])
  ) as any;
};

const getCompetingOpenBookingRequests = (booking: any, excludeId?: string | number) => {
  if (!booking?.room_id || !booking?.date || !booking?.start_time || !booking?.end_time) return [];
  return db.prepare(`
    SELECT id, faculty_name, event_name FROM bookings
    WHERE room_id = ?
    AND date = ?
    AND status IN ('Pending', 'HOD Recommended')
    ${excludeId ? "AND id != ?" : ""}
    AND NOT (end_time <= ? OR start_time >= ?)
  `).all(
    booking.room_id,
    booking.date,
    ...(excludeId ? [excludeId] : []),
    booking.start_time,
    booking.end_time
  ) as any[];
};

const notifyBookingAuthorities = (booking: any, title: string, message: string) => {
  const departmentName = getBookingDepartmentName(booking);
  if (departmentName) {
    createNotification("HOD", null, title, message, departmentName);
  }
  createNotification("Dean (P&M)", null, title, message);
  createNotification("Deputy Dean (P&M)", null, title, message);
};

backfillNotificationsIfEmpty();

const createCrudRoutes = (tableName: string, idField: string = "id") => {
  app.get(`/api/${tableName}`, authenticate, (req, res) => {
    if (tableName === "bookings") {
      const bookings = db.prepare(`
        SELECT bk.*, r.room_number, d.name as department_name
        FROM bookings bk
        LEFT JOIN rooms r ON bk.room_id = r.id
        LEFT JOIN departments d ON bk.department_id = d.id
      `).all();
      const user = (req as any).user;
      if (isDecisionRole(user.role)) return res.json(bookings);
      if (user.role === "HOD") {
        return res.json(bookings.filter((booking: any) =>
          booking.faculty_name === user.name || (!!user.department && booking.department_name === user.department)
        ));
      }
      return res.json(bookings.filter((booking: any) => booking.faculty_name === user.name));
    }

    const items = db.prepare(`SELECT * FROM ${tableName}`).all();
    res.json(items);
  });

  app.post(`/api/${tableName}`, authenticate, (req, res) => {
    if (tableName === "users" && (req as any).user?.role !== "Administrator") {
      return res.status(403).json({ error: "Only Administrator can manage users and passwords." });
    }
    if (tableName === "users" && !req.body.password) {
      req.body.password = "Welcome123";
    }
    if (tableName === "users" && req.body.password) {
      req.body.force_password_change = 1;
    }
    if (tableName === "bookings") {
      ensureBookingColumns();
      if (!req.body.status) {
        req.body.status = "Pending";
      }
    }
    if (tableName === "rooms") {
      req.body = normalizeRoomPayload(req.body);
    }
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

      if (tableName === "department_allocations") {
        const room = db.prepare("SELECT room_number, capacity, room_type FROM rooms WHERE id = ?").get(req.body.room_id) as any;
        if (!room) return res.status(400).json({ error: "Please select a valid room." });
        if ((parseInt(req.body.capacity, 10) || 0) > room.capacity) {
          return res.status(400).json({ error: `Room ${room.room_number} capacity is ${room.capacity}, but required capacity is ${req.body.capacity}.` });
        }
        req.body.room_type = room.room_type;
        const roomTypeIndex = fields.indexOf("room_type");
        if (roomTypeIndex >= 0) values[roomTypeIndex] = req.body.room_type;
      }

      if (tableName === "bookings") {
        if (!req.body.room_id || !req.body.date || !req.body.start_time || !req.body.end_time) {
          return res.status(400).json({ error: "Room, date, start time, and end time are required." });
        }
        if (!req.body.department_id) {
          return res.status(400).json({ error: "Department is required so the request can go to the respective HOD." });
        }
        const department = db.prepare("SELECT name FROM departments WHERE id = ?").get(req.body.department_id) as any;
        if (!department) {
          return res.status(400).json({ error: "Please select a valid department." });
        }
        if (!["Pending", "Approved"].includes(req.body.status || "Pending")) {
          req.body.status = "Pending";
          const statusIndex = fields.indexOf("status");
          if (statusIndex >= 0) values[statusIndex] = req.body.status;
        }
        if (req.body.status === "Approved" && !["Administrator", "Dean (P&M)"].includes((req as any).user.role)) {
          req.body.status = "Pending";
          const statusIndex = fields.indexOf("status");
          if (statusIndex >= 0) values[statusIndex] = req.body.status;
        }

        if (isPastDateTime(req.body.date, req.body.start_time)) {
          return res.status(400).json({ error: "Past booking times are not allowed." });
        }

        const duplicateOpenRequest = getDuplicateOpenBookingRequest(req.body);
        if (duplicateOpenRequest) {
          return res.status(400).json({ error: "You already have an active request for this room and time slot." });
        }

        const conflictingBooking = getApprovedBookingConflict(req.body);
        if (conflictingBooking) {
          return res.status(400).json({ error: "This room already has an approved booking for the selected time slot." });
        }
      }

      const info = db.prepare(`INSERT INTO ${tableName} (${fields.join(", ")}) VALUES (${placeholders})`).run(...values);
      if (tableName === "bookings") {
        const message = `${req.body.faculty_name} requested ${req.body.event_name || "a room"} on ${req.body.date} from ${req.body.start_time} to ${req.body.end_time}.`;
        if (req.body.status === "Pending") {
          createNotification(null, req.body.faculty_name, "Room request submitted", `${req.body.event_name || "Your room request"} was submitted for approval.`);
          notifyBookingAuthorities(req.body, "New room request", message);
          const competingRequests = getCompetingOpenBookingRequests(req.body, info.lastInsertRowid);
          if (competingRequests.length > 0) {
            notifyBookingAuthorities(
              req.body,
              "Competing room requests",
              `${req.body.event_name || "A room request"} overlaps with ${competingRequests.length} other active request(s) for the same room and time. Dean (P&M) can take the final decision.`
            );
          }
        } else {
          createNotification(null, req.body.faculty_name, "Room booking approved", `${req.body.event_name || "Your room request"} is approved.`);
          notifyBookingAuthorities(req.body, "Room booking approved", `${req.body.event_name || "A room request"} was approved directly.`);
        }
      }
      res.json({ id: info.lastInsertRowid, ...req.body });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put(`/api/${tableName}/:id`, authenticate, (req, res) => {
    if (tableName === "users" && (req as any).user?.role !== "Administrator") {
      return res.status(403).json({ error: "Only Administrator can manage users and passwords." });
    }
    if (tableName === "users" && !req.body.password) {
      delete req.body.password;
    }
    if (tableName === "users" && req.body.password) {
      req.body.force_password_change = 1;
    }
    if (tableName === "bookings") {
      ensureBookingColumns();
    }
    if (tableName === "rooms") {
      req.body = normalizeRoomPayload(req.body);
    }
    let fields = Object.keys(req.body);
    let setClause = fields.map(f => `${f} = ?`).join(", ");
    let values = [...Object.values(req.body), req.params.id];

    try {
      const existingItem = db.prepare(`SELECT * FROM ${tableName} WHERE ${idField} = ?`).get(req.params.id) as any;
      const duplicateError = checkDuplicateRecord(tableName, { ...existingItem, ...req.body }, req.params.id);
      if (duplicateError) {
        return res.status(400).json({ error: duplicateError });
      }

      if (tableName === "department_allocations") {
        const nextAllocation = { ...existingItem, ...req.body };
        const room = db.prepare("SELECT room_number, capacity, room_type FROM rooms WHERE id = ?").get(nextAllocation.room_id) as any;
        if (!room) return res.status(400).json({ error: "Please select a valid room." });
        if ((parseInt(nextAllocation.capacity, 10) || 0) > room.capacity) {
          return res.status(400).json({ error: `Room ${room.room_number} capacity is ${room.capacity}, but required capacity is ${nextAllocation.capacity}.` });
        }
        req.body.room_type = room.room_type;
      }

      if (tableName === "bookings") {
        const nextBooking = { ...existingItem, ...req.body };
        const requestedStatus = req.body.status;
        const role = (req as any).user.role;
        const isRequester = existingItem.faculty_name === (req as any).user.name;
        const departmentName = getBookingDepartmentName(nextBooking);
        const isDepartmentHod = role === "HOD" && !!departmentName && departmentName === (req as any).user.department;

        if (requestedStatus === "HOD Recommended") {
          if (!isDepartmentHod) {
            return res.status(403).json({ error: "Only the respective department HOD can recommend this room request." });
          }
          if (existingItem.status !== "Pending") {
            return res.status(400).json({ error: "Only pending requests can be recommended by HOD." });
          }
        }
        if (["Approved", "Rejected", "Postponed"].includes(requestedStatus)) {
          const deanCanDecide = ["Administrator", "Dean (P&M)"].includes(role);
          const deputyCanDecide = role === "Deputy Dean (P&M)" && existingItem.status === "HOD Recommended";
          const requesterCanCancel = requestedStatus === "Rejected" && isRequester;
          if (!deanCanDecide && !deputyCanDecide && !requesterCanCancel) {
            return res.status(403).json({ error: "Deputy Dean can decide only after HOD recommendation. Dean (P&M) can decide directly." });
          }
        }
        if (requestedStatus === "Pending" && !isRequester && !["Administrator", "Dean (P&M)"].includes(role)) {
          return res.status(403).json({ error: "Only the requester, Administrator, or Dean (P&M) can reopen this request." });
        }
        if (requestedStatus === "Pending" && !["Rejected", "Postponed"].includes(existingItem.status)) {
          return res.status(400).json({ error: "Only rejected or postponed requests can be reopened." });
        }
        if (requestedStatus === "HOD Recommended") {
          req.body.recommended_by = (req as any).user.name;
        }
        if (["Approved", "Rejected", "Postponed"].includes(requestedStatus)) {
          req.body.decided_by = (req as any).user.name;
        }
        if (nextBooking.room_id && nextBooking.date && nextBooking.start_time && nextBooking.end_time && isPastDateTime(nextBooking.date, nextBooking.start_time)) {
          return res.status(400).json({ error: "Past booking times are not allowed." });
        }

        if (openBookingStatuses.includes(nextBooking.status)) {
          const duplicateOpenRequest = getDuplicateOpenBookingRequest(nextBooking, req.params.id);
          if (duplicateOpenRequest) {
            return res.status(400).json({ error: "This requester already has an active request for this room and time slot." });
          }
        }

        if (nextBooking.status === "Approved" && nextBooking.room_id && nextBooking.date && nextBooking.start_time && nextBooking.end_time) {
          const conflictingBooking = getApprovedBookingConflict(nextBooking, req.params.id);
          if (conflictingBooking) {
            return res.status(400).json({ error: "This room already has an approved booking for the selected time slot." });
          }
        }
      }

      fields = Object.keys(req.body);
      setClause = fields.map(f => `${f} = ?`).join(", ");
      values = [...Object.values(req.body), req.params.id];
      if (tableName === 'users' && req.body.password) {
        const passIdx = fields.indexOf('password');
        values[passIdx] = bcrypt.hashSync(req.body.password, 10);
      }
      db.prepare(`UPDATE ${tableName} SET ${setClause} WHERE ${idField} = ?`).run(...values);
      if (tableName === "bookings" && req.body.status) {
        const title = req.body.status === "HOD Recommended" ? "Request recommended" : `Request ${req.body.status}`;
        const actor = (req as any).user.name;
        const message = `${actor} updated ${existingItem.event_name || "a room request"} to ${req.body.status}.`;
        createNotification(null, existingItem.faculty_name, title, message);
        if (req.body.status === "HOD Recommended") {
          createNotification("Dean (P&M)", null, title, message);
          createNotification("Deputy Dean (P&M)", null, title, message);
        }
        if (["Approved", "Rejected", "Postponed"].includes(req.body.status)) {
          createNotification("Dean (P&M)", null, title, message);
          createNotification("Deputy Dean (P&M)", null, title, message);
          const departmentName = getBookingDepartmentName(existingItem);
          if (departmentName) {
            createNotification("HOD", null, title, message, departmentName);
          }
        }
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete(`/api/${tableName}/reset`, authenticate, (req, res) => {
    if (tableName === "users" && (req as any).user?.role !== "Administrator") {
      return res.status(403).json({ error: "Only Administrator can remove users." });
    }
    try {
      db.prepare(`DELETE FROM ${tableName}`).run();
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete(`/api/${tableName}/:id`, authenticate, (req, res) => {
    if (tableName === "users" && (req as any).user?.role !== "Administrator") {
      return res.status(403).json({ error: "Only Administrator can remove users." });
    }
    try {
      const existingItem = db.prepare(`SELECT * FROM ${tableName} WHERE ${idField} = ?`).get(req.params.id) as any;
      db.prepare(`DELETE FROM ${tableName} WHERE ${idField} = ?`).run(req.params.id);
      if (tableName === "bookings" && existingItem) {
        const actor = (req as any).user.name;
        const title = "Room request deleted";
        const message = `${actor} deleted ${existingItem.event_name || "a room request"} for ${existingItem.date || "the selected date"}.`;
        createNotification(null, existingItem.faculty_name, title, message);
        notifyBookingAuthorities(existingItem, title, message);
      }
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

  const minimumCapacity = members !== undefined
    ? parseInt(members as string, 10)
    : null;
  if (members !== undefined && (!Number.isInteger(minimumCapacity) || minimumCapacity < 0)) {
    return res.status(400).json({ error: "Members must be a valid non-negative number." });
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
  const allRooms = minimumCapacity !== null
    ? db.prepare("SELECT * FROM rooms WHERE status = 'Available' AND capacity >= ?").all(minimumCapacity) as any[]
    : db.prepare("SELECT * FROM rooms WHERE status = 'Available'").all() as any[];

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

  if (!date || !startTime || !endTime || !strength) {
    return res.status(400).json({ error: "Date, start time, end time, and strength are required." });
  }

  if (isPastDateTime(date as string, startTime as string)) {
    return res.status(400).json({ error: "Past event searches are not allowed." });
  }

  if ((startTime as string) >= (endTime as string)) {
    return res.status(400).json({ error: "End time must be later than start time." });
  }

  const targetStrength = parseInt(strength as string, 10);
  if (!Number.isInteger(targetStrength) || targetStrength <= 0) {
    return res.status(400).json({ error: "Strength must be a valid positive number." });
  }

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
      SELECT r.*, bld.name as building_name, b.name as block_name, f.floor_number
      FROM rooms r
      JOIN floors f ON r.floor_id = f.id
      JOIN blocks b ON f.block_id = b.id
      JOIN buildings bld ON b.building_id = bld.id
    `).all() as any[];
    const schedules = db.prepare("SELECT * FROM schedules").all() as any[];
    const bookings = db.prepare("SELECT * FROM bookings WHERE status = 'Approved'").all() as any[];
    const allBookings = db.prepare("SELECT * FROM bookings").all() as any[];
    const maintenance = db.prepare("SELECT * FROM maintenance").all() as any[];
    const departments = db.prepare("SELECT * FROM departments").all() as any[];
    const schools = db.prepare("SELECT * FROM schools").all() as any[];
    const allocations = db.prepare(`
      SELECT room_id, department_id, school_id, id
      FROM department_allocations
      ORDER BY id DESC
    `).all() as any[];

    const calculateHours = (start: string, end: string) => {
      if (!start || !end) return 0;
      const [h1, m1] = start.split(':').map(Number);
      const [h2, m2] = end.split(':').map(Number);
      return (h2 + m2 / 60) - (h1 + m1 / 60);
    };

    const latestAllocationByRoom = new Map<number, any>();
    allocations.forEach((allocation) => {
      if (!latestAllocationByRoom.has(allocation.room_id)) {
        latestAllocationByRoom.set(allocation.room_id, allocation);
      }
    });

    const reports = rooms.map(room => {
      const roomSchedules = schedules.filter(s => s.room_id === room.id);
      const roomBookings = bookings.filter(b => b.room_id === room.id);
      const allRoomBookings = allBookings.filter(b => b.room_id === room.id);
      const allocation = latestAllocationByRoom.get(room.id);
      const inferredDepartmentCounts = new Map<number, number>();
      [...roomSchedules, ...allRoomBookings].forEach((entry: any) => {
        if (!entry.department_id) return;
        inferredDepartmentCounts.set(entry.department_id, (inferredDepartmentCounts.get(entry.department_id) || 0) + 1);
      });
      const inferredDepartmentId = Array.from(inferredDepartmentCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      const resolvedDepartmentId = allocation?.department_id || inferredDepartmentId || null;
      const department = departments.find(dept => dept.id === resolvedDepartmentId);
      const resolvedSchoolId = allocation?.school_id || department?.school_id || null;
      const school = schools.find(item => item.id === resolvedSchoolId);
      const maintenanceIssues = maintenance.filter(item => item.room_id === room.id && item.status !== "Completed").length;

      const scheduledHours = roomSchedules.reduce((acc, s) => acc + calculateHours(s.start_time, s.end_time), 0);
      const bookedHours = roomBookings.reduce((acc, b) => {
        const h = calculateHours(b.start_time, b.end_time);
        return acc + h;
      }, 0);
      
      const totalUsedHours = scheduledHours + bookedHours;
      const availableHours = 72; // Assuming 12h * 6 days
      const utilization = (totalUsedHours / availableHours) * 100;

      return {
        room_id: room.id,
        room_number: room.room_number,
        building: room.building_name,
        block: room.block_name,
        floor_number: room.floor_number,
        department_id: resolvedDepartmentId,
        department: department?.name || "Unmapped",
        school: school?.name || "Unmapped",
        room_type: room.room_type,
        lab_name: room.lab_name,
        restroom_type: room.restroom_type,
        capacity: room.capacity,
        status: room.status,
        maintenanceIssues,
        utilization: Math.min(100, Math.round(utilization)),
        totalUsedHours: Math.round(totalUsedHours * 10) / 10,
        scheduledHours: Math.round(scheduledHours * 10) / 10,
        bookedHours: Math.round(bookedHours * 10) / 10,
        bookingStatuses: Array.from(new Set(allRoomBookings.map(booking => booking.status).filter(Boolean))),
        bookingDates: allRoomBookings.map(booking => booking.date).filter(Boolean),
        approvedBookingDates: roomBookings.map(booking => booking.date).filter(Boolean),
        flags: [
          utilization < 20 ? "Underused" : null,
          utilization > 80 ? "Overused" : null,
          maintenanceIssues > 0 ? "Maintenance Risk" : null,
          !department ? "Department Unmapped" : null,
        ].filter(Boolean)
      };
    });

    const buildingReports = Array.from(new Set(reports.map(report => report.building))).map(building => {
      const buildingRooms = reports.filter(report => report.building === building);
      const avgUtilization = buildingRooms.reduce((acc, report) => acc + report.utilization, 0) / (buildingRooms.length || 1);
      return {
        name: building,
        roomCount: buildingRooms.length,
        avgUtilization: Math.round(avgUtilization),
        maintenanceIssues: buildingRooms.reduce((acc, report) => acc + report.maintenanceIssues, 0)
      };
    });

    const bookingStatusReports = ["Pending", "HOD Recommended", "Approved", "Postponed", "Rejected"].map(status => ({
      name: status,
      count: allBookings.filter(booking => booking.status === status).length
    }));

    // Aggregate by Department
    const deptReports = departments.map(dept => {
      const deptRooms = reports.filter(r => r.department_id === dept.id);
      const totalUtilization = deptRooms.reduce((acc, r) => acc + r.utilization, 0);
      const avgUtilization = deptRooms.length > 0 ? totalUtilization / deptRooms.length : 0;

      return {
        name: dept.name,
        school_id: dept.school_id,
        school: schools.find(school => school.id === dept.school_id)?.name || "Unmapped",
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

    res.json({ roomReports: reports, deptReports, schoolReports, buildingReports, bookingStatusReports });
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

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === __filename
  : false;

if (isDirectExecution) {
  startServer();
}

export default app;

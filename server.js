/**
 * ══════════════════════════════════════════════════════════
 * MUST Odoo HR Implementation Tracker — Backend Server
 * Express + sql.js (pure JS SQLite) + JWT + bcrypt
 * ══════════════════════════════════════════════════════════
 */

const express  = require("express");
const cors     = require("cors");
const jwt      = require("jsonwebtoken");
const bcrypt   = require("bcryptjs");
const path     = require("path");
const initSqlJs = require("sql.js");
const fs       = require("fs");

const app  = express();
const PORT = process.env.PORT || 3200;
const JWT_SECRET = process.env.JWT_SECRET || "must-odoo-hr-tracker-secret-2026";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = path.join(__dirname, "db", "tracker.db");
let db; // sql.js database instance

/* ══════════════════════════════════════════════════════════
   HELPERS — sql.js wrappers
   ══════════════════════════════════════════════════════════ */
function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Run a statement, return { changes, lastInsertRowid }
function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const rid = db.exec("SELECT last_insert_rowid() as id");
  const lastInsertRowid = rid.length > 0 ? rid[0].values[0][0] : 0;
  saveDb();
  return { changes, lastInsertRowid };
}

// Get one row as object
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    stmt.free();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    return row;
  }
  stmt.free();
  return null;
}

// Get all rows as array of objects
function all(sql, params = []) {
  const result = db.exec(sql, params);
  if (result.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

// Parameterized all — workaround for sql.js parameter binding with exec
function allP(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  const cols = [];
  let gotCols = false;
  while (stmt.step()) {
    if (!gotCols) {
      stmt.getColumnNames().forEach(c => cols.push(c));
      gotCols = true;
    }
    const vals = stmt.get();
    const row = {};
    cols.forEach((c, i) => row[c] = vals[i]);
    rows.push(row);
  }
  stmt.free();
  return rows;
}

function getP(sql, params = []) {
  const rows = allP(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runP(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const rid = db.exec("SELECT last_insert_rowid() as id");
  const lastInsertRowid = rid.length > 0 ? rid[0].values[0][0] : 0;
  saveDb();
  return { changes, lastInsertRowid };
}

/* ══════════════════════════════════════════════════════════
   DATABASE INITIALIZATION
   ══════════════════════════════════════════════════════════ */

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Run schema
  const schema = fs.readFileSync(path.join(__dirname, "db", "schema.sql"), "utf-8");
  db.exec(schema);
  db.exec("PRAGMA foreign_keys = ON;");
  saveDb();

  // Seed if empty
  const cnt = getP("SELECT COUNT(*) as cnt FROM users");
  if (!cnt || cnt.cnt === 0) seedDefaults();
}

/* ══════════════════════════════════════════════════════════
   SEED DATA
   ══════════════════════════════════════════════════════════ */

function seedDefaults() {
  console.log("⚙️  Seeding default users and roadmap...");
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const users = [
    ["admin",       hash("must2026"), "System Administrator",  "admin",      "admin@must.edu.pk"],
    ["nasra.naqvi", hash("must2026"), "Ms. Nasra Naqvi",       "directorHR", "nasra.naqvi@must.edu.pk"],

    ["registrar",   hash("must2026"), "Registrar",             "registrar",  "registrar@must.edu.pk"],
    ["vpops",       hash("must2026"), "VP Operations",         "vpOps",      "vpops@must.edu.pk"],
  ];
  for (const u of users) {
    runP("INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)", u);
  }

  const ROADMAP = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-roadmap.json"), "utf-8"));

  for (const phase of ROADMAP) {
    const { lastInsertRowid: phaseId } = runP(
      "INSERT INTO phases (phase_number, title, subtitle, timeline, note, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [phase.phase, phase.title, phase.subtitle || "", phase.timeline || "", phase.note || "", phase.phase]
    );
    (phase.tasks || []).forEach((t, i) => {
      runP("INSERT INTO tasks (phase_id, label, category, status, sort_order, completed_date, completed_by, deliverable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [phaseId, t.label, t.category, t.status || "pending", i, t.completedDate || null, t.completedBy || null, t.deliverable || ""]);
    });
    (phase.odooSteps || []).forEach((s, i) => runP("INSERT INTO odoo_steps (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, s, i]));
    (phase.prerequisites || []).forEach((p, i) => runP("INSERT INTO prerequisites (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, p, i]));
    (phase.authorities || []).forEach((a, i) => runP("INSERT INTO authorities (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, a, i]));
  }

  // Seed Week-1 report
  const nasra = getP("SELECT id FROM users WHERE username = 'nasra.naqvi'");
  const completedTaskIds = allP("SELECT id FROM tasks WHERE status = 'completed'").map(r => r.id);
  const { lastInsertRowid: reportId } = runP(
    "INSERT INTO progress_reports (title, summary, submitted_by, submitted_at, phase_number, tasks_snapshot) VALUES (?, ?, ?, ?, ?, ?)",
    ["Week 1 Deliverables — Phase 0 Completion",
     "All 5 Phase 0 tasks completed. Employee master data fields defined, document checklist finalized, policy observations shared, Odoo confirmed as single system, and Nasra Naqvi designated as Odoo administrator.",
     nasra.id, "2026-04-05T00:00:00.000Z", 0, JSON.stringify(completedTaskIds)]
  );
  const findings = [
    "Faculty attendance rules (Section 5.3) need revision before Odoo configuration",
    "Salary Bands (Section 7.3) are yet to be defined — blocks payroll setup",
    "Employment Contracts (Section 8.1) need revision — blocks contract management",
    "Biometric code field has duplicates — needs cleanup",
    "Left Date field to be shown in master data for departed employees",
  ];
  findings.forEach((f, i) => runP("INSERT INTO report_findings (report_id, finding, sort_order) VALUES (?, ?, ?)", [reportId, f, i]));

  console.log("✅ Seed complete — 5 users, 11 phases, Week-1 report");
}

/* ══════════════════════════════════════════════════════════
   AUTH MIDDLEWARE
   ══════════════════════════════════════════════════════════ */

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: "Invalid token" }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}

function logAudit(userId, action, entityType, entityId, oldVal, newVal) {
  runP("INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, action, entityType || null, entityId || null, oldVal || null, newVal || null]);
}

/* ══════════════════════════════════════════════════════════
   AUTH ENDPOINTS
   ══════════════════════════════════════════════════════════ */

// Public: list active users for login dropdown
app.get("/api/auth/users", (req, res) => {
  const users = allP("SELECT username, display_name, role FROM users WHERE active = 1 ORDER BY display_name");
  res.json({ users });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const user = getP("SELECT * FROM users WHERE username = ? AND active = 1", [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
  runP("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, displayName: user.display_name }, JWT_SECRET, { expiresIn: "24h" });
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, email: user.email } });
});

app.post("/api/auth/change-password", authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const user = getP("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: "Current password incorrect" });
  runP("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(newPassword, 10), req.user.id]);
  logAudit(req.user.id, "change_password", "user", req.user.id);
  res.json({ message: "Password changed" });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  const user = getP("SELECT id, username, display_name, role, email FROM users WHERE id = ?", [req.user.id]);
  res.json({ user });
});

/* ══════════════════════════════════════════════════════════
   USER MANAGEMENT (Admin)
   ══════════════════════════════════════════════════════════ */

app.get("/api/users", authMiddleware, requireRole("admin"), (req, res) => {
  res.json({ users: allP("SELECT id, username, display_name, role, email, active, created_at, last_login FROM users") });
});

app.post("/api/users", authMiddleware, requireRole("admin"), (req, res) => {
  const { username, password, displayName, role, email } = req.body;
  if (!username || !password || !displayName || !role) return res.status(400).json({ error: "Missing fields" });
  if (getP("SELECT id FROM users WHERE username = ?", [username])) return res.status(409).json({ error: "Username exists" });
  const { lastInsertRowid } = runP("INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)",
    [username, bcrypt.hashSync(password, 10), displayName, role, email || null]);
  logAudit(req.user.id, "create_user", "user", lastInsertRowid, null, username);
  res.json({ id: lastInsertRowid, message: "User created" });
});

app.put("/api/users/:id/reset-password", authMiddleware, requireRole("admin"), (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Min 6 chars" });
  runP("UPDATE users SET password_hash = ? WHERE id = ?", [bcrypt.hashSync(newPassword, 10), parseInt(req.params.id)]);
  logAudit(req.user.id, "reset_password", "user", parseInt(req.params.id));
  res.json({ message: "Password reset" });
});

/* ══════════════════════════════════════════════════════════
   ROADMAP
   ══════════════════════════════════════════════════════════ */

app.get("/api/roadmap", authMiddleware, (req, res) => {
  const phases = allP("SELECT * FROM phases ORDER BY sort_order, phase_number");
  const result = phases.map(p => ({
    id: p.id, phase: p.phase_number, title: p.title, subtitle: p.subtitle, timeline: p.timeline, note: p.note,
    tasks: allP("SELECT * FROM tasks WHERE phase_id = ? ORDER BY sort_order", [p.id]),
    odooSteps: allP("SELECT label FROM odoo_steps WHERE phase_id = ? ORDER BY sort_order", [p.id]).map(s => s.label),
    prerequisites: allP("SELECT label FROM prerequisites WHERE phase_id = ? ORDER BY sort_order", [p.id]).map(s => s.label),
    authorities: allP("SELECT label FROM authorities WHERE phase_id = ? ORDER BY sort_order", [p.id]).map(s => s.label),
  }));
  res.json({ roadmap: result });
});

/* ══════════════════════════════════════════════════════════
   PHASES (Admin CRUD)
   ══════════════════════════════════════════════════════════ */

app.post("/api/phases", authMiddleware, requireRole("admin"), (req, res) => {
  const { phaseNumber, title, subtitle, timeline, note, odooSteps, prerequisites, authorities } = req.body;
  if (!title) return res.status(400).json({ error: "Title required" });
  const maxRow = getP("SELECT MAX(phase_number) as m FROM phases");
  const num = phaseNumber ?? ((maxRow?.m ?? -1) + 1);
  const { lastInsertRowid: phaseId } = runP(
    "INSERT INTO phases (phase_number, title, subtitle, timeline, note, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [num, title, subtitle || "", timeline || "", note || "", num, req.user.id]
  );
  (odooSteps || []).forEach((s, i) => runP("INSERT INTO odoo_steps (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, s, i]));
  (prerequisites || []).forEach((p, i) => runP("INSERT INTO prerequisites (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, p, i]));
  (authorities || []).forEach((a, i) => runP("INSERT INTO authorities (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, a, i]));
  logAudit(req.user.id, "create_phase", "phase", phaseId, null, title);
  res.json({ id: phaseId, message: "Phase created" });
});

app.put("/api/phases/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const { title, subtitle, timeline, note, tasks, odooSteps, prerequisites, authorities } = req.body;
  const phaseId = parseInt(req.params.id);
  if (title !== undefined) {
    runP("UPDATE phases SET title = ?, subtitle = ?, timeline = ?, note = ?, updated_at = datetime('now') WHERE id = ?",
      [title, subtitle || "", timeline || "", note || "", phaseId]);
  }
  if (tasks) {
    runP("DELETE FROM tasks WHERE phase_id = ?", [phaseId]);
    tasks.forEach((t, i) => {
      runP("INSERT INTO tasks (phase_id, label, category, status, sort_order, completed_date, completed_by, note, deliverable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [phaseId, t.label, t.category || "document", t.status || "pending", i, t.completed_date || null, t.completed_by || null, t.note || "", t.deliverable || ""]);
    });
  }
  if (odooSteps) { runP("DELETE FROM odoo_steps WHERE phase_id = ?", [phaseId]); odooSteps.forEach((s, i) => runP("INSERT INTO odoo_steps (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, s, i])); }
  if (prerequisites) { runP("DELETE FROM prerequisites WHERE phase_id = ?", [phaseId]); prerequisites.forEach((p, i) => runP("INSERT INTO prerequisites (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, p, i])); }
  if (authorities) { runP("DELETE FROM authorities WHERE phase_id = ?", [phaseId]); authorities.forEach((a, i) => runP("INSERT INTO authorities (phase_id, label, sort_order) VALUES (?, ?, ?)", [phaseId, a, i])); }
  logAudit(req.user.id, "update_phase", "phase", phaseId);
  res.json({ message: "Phase updated" });
});

app.delete("/api/phases/:id", authMiddleware, requireRole("admin"), (req, res) => {
  const phaseId = parseInt(req.params.id);
  const phase = getP("SELECT * FROM phases WHERE id = ?", [phaseId]);
  if (!phase) return res.status(404).json({ error: "Not found" });
  // Delete children first (sql.js doesn't always cascade)
  runP("DELETE FROM tasks WHERE phase_id = ?", [phaseId]);
  runP("DELETE FROM odoo_steps WHERE phase_id = ?", [phaseId]);
  runP("DELETE FROM prerequisites WHERE phase_id = ?", [phaseId]);
  runP("DELETE FROM authorities WHERE phase_id = ?", [phaseId]);
  runP("DELETE FROM phases WHERE id = ?", [phaseId]);
  logAudit(req.user.id, "delete_phase", "phase", phaseId, phase.title);
  res.json({ message: "Deleted" });
});

/* ══════════════════════════════════════════════════════════
   TASKS (Admin + Director HR)
   ══════════════════════════════════════════════════════════ */

app.put("/api/tasks/:id", authMiddleware, requireRole("admin", "directorHR"), (req, res) => {
  const taskId = parseInt(req.params.id);
  const task = getP("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task) return res.status(404).json({ error: "Not found" });
  const { status, note, deliverable } = req.body;
  const sets = []; const params = [];
  if (status !== undefined && status !== task.status) {
    sets.push("status = ?"); params.push(status);
    if (status === "completed") {
      sets.push("completed_date = ?", "completed_by = ?");
      params.push(new Date().toISOString().split("T")[0], req.user.displayName || req.user.username);
    } else { sets.push("completed_date = NULL", "completed_by = NULL"); }
  }
  if (note !== undefined) { sets.push("note = ?"); params.push(note); }
  if (deliverable !== undefined) { sets.push("deliverable = ?"); params.push(deliverable); }
  if (sets.length === 0) return res.json({ message: "No changes" });
  sets.push("updated_at = datetime('now')");
  params.push(taskId);
  runP(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
  logAudit(req.user.id, "update_task", "task", taskId, task.status, status || task.status);
  res.json({ task: getP("SELECT * FROM tasks WHERE id = ?", [taskId]) });
});

/* ══════════════════════════════════════════════════════════
   TASK FORWARDING (Director HR)
   ══════════════════════════════════════════════════════════ */

// Forward a task for approval or info
app.post("/api/tasks/:id/forward", authMiddleware, requireRole("admin", "directorHR"), (req, res) => {
  const taskId = parseInt(req.params.id);
  const task = getP("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const { forwardType, title, description } = req.body;
  if (!forwardType || !title) return res.status(400).json({ error: "Forward type and title required" });
  if (!["approval", "info"].includes(forwardType)) return res.status(400).json({ error: "Invalid forward type" });

  const forwardedTo = forwardType === "approval" ? "registrar" : req.body.forwardedTo || "registrar";

  const { lastInsertRowid } = runP(
    "INSERT INTO forwarded_items (task_id, forward_type, title, description, forwarded_by, forwarded_to) VALUES (?, ?, ?, ?, ?, ?)",
    [taskId, forwardType, title, description || "", req.user.id, forwardedTo]
  );

  // Update task status
  const newStatus = forwardType === "approval" ? "forwarded_approval" : "forwarded_info";
  runP("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, taskId]);

  logAudit(req.user.id, "forward_task_" + forwardType, "task", taskId, task.status, newStatus);
  
  const item = getP("SELECT * FROM forwarded_items WHERE id = ?", [lastInsertRowid]);
  res.json({ forwardedItem: item, task: getP("SELECT * FROM tasks WHERE id = ?", [taskId]) });
});

// Get all forwarded items (visible to registrar & admin too)
app.get("/api/forwarded", authMiddleware, (req, res) => {
  const items = allP(`
    SELECT fi.*, t.label as task_label, t.category as task_category, 
           p.title as phase_title, p.phase_number,
           u.display_name as forwarded_by_name
    FROM forwarded_items fi
    JOIN tasks t ON fi.task_id = t.id
    JOIN phases p ON t.phase_id = p.id
    JOIN users u ON fi.forwarded_by = u.id
    ORDER BY fi.forwarded_at DESC
  `);
  res.json({ forwardedItems: items });
});

// Respond to a forwarded item (registrar approves, or marks as noted)
app.put("/api/forwarded/:id/respond", authMiddleware, requireRole("admin", "registrar"), (req, res) => {
  const itemId = parseInt(req.params.id);
  const item = getP("SELECT * FROM forwarded_items WHERE id = ?", [itemId]);
  if (!item) return res.status(404).json({ error: "Not found" });

  const { status, responseNote } = req.body;
  if (!status) return res.status(400).json({ error: "Status required" });

  runP("UPDATE forwarded_items SET status = ?, response_note = ?, responded_at = datetime('now') WHERE id = ?",
    [status, responseNote || "", itemId]);

  // If approved, mark the task as completed
  if (status === "approved") {
    runP("UPDATE tasks SET status = 'completed', completed_date = date('now'), completed_by = 'Registrar (approved)', updated_at = datetime('now') WHERE id = ?", [item.task_id]);
  }

  logAudit(req.user.id, "respond_forward", "forwarded_item", itemId, item.status, status);
  res.json({ forwardedItem: getP("SELECT * FROM forwarded_items WHERE id = ?", [itemId]) });
});

// Get forwarded items for a specific task
app.get("/api/tasks/:id/forwards", authMiddleware, (req, res) => {
  const taskId = parseInt(req.params.id);
  const items = allP(`
    SELECT fi.*, u.display_name as forwarded_by_name
    FROM forwarded_items fi
    JOIN users u ON fi.forwarded_by = u.id
    WHERE fi.task_id = ?
    ORDER BY fi.forwarded_at DESC
  `, [taskId]);
  res.json({ forwardedItems: items });
});

/* ══════════════════════════════════════════════════════════
   PROGRESS REPORTS
   ══════════════════════════════════════════════════════════ */

app.get("/api/reports", authMiddleware, (req, res) => {
  const reports = allP("SELECT pr.*, u.display_name as submitted_by_name FROM progress_reports pr JOIN users u ON u.id = pr.submitted_by ORDER BY pr.submitted_at DESC");
  const result = reports.map(r => ({
    ...r,
    tasksSnapshot: JSON.parse(r.tasks_snapshot || "[]"),
    findings: allP("SELECT finding FROM report_findings WHERE report_id = ? ORDER BY sort_order", [r.id]).map(f => f.finding),
  }));
  res.json({ reports: result });
});

app.post("/api/reports", authMiddleware, requireRole("directorHR"), (req, res) => {
  const { title, summary, keyFindings, phaseNumber } = req.body;
  if (!title || !summary) return res.status(400).json({ error: "Title and summary required" });
  const completedIds = allP("SELECT id FROM tasks WHERE status = 'completed'").map(r => r.id);
  const { lastInsertRowid: reportId } = runP(
    "INSERT INTO progress_reports (title, summary, submitted_by, phase_number, tasks_snapshot) VALUES (?, ?, ?, ?, ?)",
    [title, summary, req.user.id, phaseNumber || null, JSON.stringify(completedIds)]
  );
  (keyFindings || []).filter(f => f.trim()).forEach((f, i) => {
    runP("INSERT INTO report_findings (report_id, finding, sort_order) VALUES (?, ?, ?)", [reportId, f.trim(), i]);
  });
  logAudit(req.user.id, "submit_report", "report", reportId, null, title);
  res.json({ id: reportId, message: "Report submitted" });
});

/* ══════════════════════════════════════════════════════════
   STATS
   ══════════════════════════════════════════════════════════ */

app.get("/api/stats", authMiddleware, (req, res) => {
  const t = getP("SELECT COUNT(*) as cnt FROM tasks").cnt;
  const c = getP("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'completed'").cnt;
  const ip = getP("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'in_progress'").cnt;
  const b = getP("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'blocked'").cnt;
  res.json({
    totalTasks: t, completed: c, inProgress: ip, blocked: b, pending: t - c - ip - b,
    totalPhases: getP("SELECT COUNT(*) as cnt FROM phases").cnt,
    totalOdooSteps: getP("SELECT COUNT(*) as cnt FROM odoo_steps").cnt,
    totalReports: getP("SELECT COUNT(*) as cnt FROM progress_reports").cnt,
    overallProgress: t > 0 ? Math.round((c / t) * 100) : 0,
  });
});

app.get("/api/audit", authMiddleware, requireRole("admin"), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ logs: allP("SELECT al.*, u.display_name as user_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.created_at DESC LIMIT ?", [limit]) });
});

/* ═══ SPA fallback ═══ */
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* ══════════════════════════════════════════════════════════
   START
   ══════════════════════════════════════════════════════════ */

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 MUST Odoo HR Tracker running at http://localhost:${PORT}`);
    console.log(`   Default credentials — all users: password "must2026"`);
    console.log(`   Roles: admin, nasra.naqvi, registrar, vpops\n`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});

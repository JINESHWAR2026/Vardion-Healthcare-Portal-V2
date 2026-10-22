require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const uploadDir = path.join(__dirname, "storage", "private");

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("ERROR: Set JWT_SECRET to a random secret of at least 32 characters.");
  process.exit(1);
}
fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    (err) => {
      if (err && !res.headersSent) {
        console.error("Home page error:", err.message);
        res.status(404).send("Home page not found. Please check public/index.html.");
      }
    }
  );
});

app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false }));

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: "8h" });
}
async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "APPROVED") return res.status(403).json({ error: "Account not approved or active." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Please log in." });
  }
}
function roles(...allowed) {
  return (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: "Not permitted." });
}
async function audit(req, action, entityType, entityId, details = "") {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.id || null, action, entityType, entityId: entityId || null,
        details: String(details).slice(0, 1000),
        ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").slice(0, 100)
      }
    });
  } catch (e) { console.error("Audit log write failed", e.message); }
}
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "Vardion Healthcare Portal", databaseConfigured: Boolean(process.env.DATABASE_URL) }));

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, phone, role, businessName, drugLicenseNo, gstin, address } = req.body || {};
    if (!name || !email || !password || String(password).length < 12) {
      return res.status(400).json({ error: "Name, email and password (at least 12 characters) are required." });
    }
    if (!["CHEMIST", "DEALER"].includes(role)) return res.status(400).json({ error: "Choose CHEMIST or DEALER." });
    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = await bcrypt.hash(String(password), 12);
    const user = await prisma.user.create({
      data: { name: String(name).slice(0,100), email: normalizedEmail, passwordHash,
        phone: phone ? String(phone).slice(0,30) : null, role, status: "PENDING",
        businessName: businessName || null, drugLicenseNo: drugLicenseNo || null,
        gstin: gstin || null, address: address || null }
    });
    res.status(201).json({ message: "Registration submitted for company approval.", userId: user.id, status: user.status });
  } catch (e) {
    if (e.code === "P2002") return res.status(409).json({ error: "Email already registered." });
    console.error(e); res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await prisma.user.findUnique({ where: { email: String(email || "").trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(String(password || ""), user.passwordHash))) return res.status(401).json({ error: "Invalid email or password." });
    if (user.status !== "APPROVED") return res.status(403).json({ error: "Account is awaiting approval or is not active." });
    res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { console.error(e); res.status(500).json({ error: "Login failed." }); }
});

app.get("/api/me", auth, (req, res) => res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, status: req.user.status }));

app.get("/api/products", auth, async (_req, res) => {
  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  res.json(products.map(p => ({ ...p, mrp: p.mrpPaise / 100, dealerPrice: p.dealerPaise / 100, chemistPrice: p.chemistPaise / 100 })));
});

app.post("/api/products", auth, roles("ADMIN"), async (req, res) => {
  try {
    const { sku, name, composition, packSize, mrp, dealerPrice, chemistPrice } = req.body || {};
    if (!sku || !name || ![mrp, dealerPrice, chemistPrice].every(v => Number.isFinite(Number(v)) && Number(v) >= 0)) {
      return res.status(400).json({ error: "SKU, name and valid prices are required." });
    }
    const p = await prisma.product.create({ data: {
      sku: String(sku), name: String(name), composition: composition || null, packSize: packSize || null,
      mrpPaise: Math.round(Number(mrp) * 100), dealerPaise: Math.round(Number(dealerPrice) * 100),
      chemistPaise: Math.round(Number(chemistPrice) * 100)
    }});
    await audit(req, "PRODUCT_CREATED", "Product", p.id);
    res.status(201).json(p);
  } catch (e) { if (e.code === "P2002") return res.status(409).json({ error: "SKU already exists." }); console.error(e); res.status(500).json({ error: "Product creation failed." }); }
});

app.post("/api/orders", auth, roles("CHEMIST"), async (req, res) => {
  try {
    const { items, deliveryAddress, notes } = req.body || {};
    if (!Array.isArray(items) || items.length === 0 || !deliveryAddress) return res.status(400).json({ error: "Items and delivery address are required." });
    let subtotalPaise = 0;
    const prepared = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return res.status(400).json({ error: "Invalid quantity." });
      const product = await prisma.product.findFirst({ where: { id: item.productId, isActive: true } });
      if (!product) return res.status(400).json({ error: "Invalid product." });
      const unitPricePaise = product.chemistPaise;
      const lineTotalPaise = unitPricePaise * quantity;
      subtotalPaise += lineTotalPaise;
      prepared.push({ productId: product.id, quantity, unitPricePaise, lineTotalPaise });
    }
    const order = await prisma.order.create({ data: {
      orderNo: "VHC-" + crypto.randomBytes(5).toString("hex").toUpperCase(),
      chemistId: req.user.id, subtotalPaise, taxPaise: 0, totalPaise: subtotalPaise,
      deliveryAddress: String(deliveryAddress).slice(0,1000), notes: notes ? String(notes).slice(0,1000) : null,
      items: { create: prepared }
    }, include: { items: { include: { product: true } } } });
    await audit(req, "ORDER_PLACED", "Order", order.id);
    res.status(201).json({ message: "Order created. Payment and GST invoice are not yet enabled.", order });
  } catch (e) { console.error(e); res.status(500).json({ error: "Order creation failed." }); }
});

app.get("/api/orders", auth, async (req, res) => {
  const where = req.user.role === "ADMIN" ? {} :
    req.user.role === "CHEMIST" ? { chemistId: req.user.id } : { dealerId: req.user.id };
  const orders = await prisma.order.findMany({ where, include: { items: { include: { product: true } }, chemist: { select: { id: true, name: true, businessName: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json(orders);
});

app.patch("/api/orders/:id/status", auth, roles("ADMIN", "DEALER"), async (req, res) => {
  const allowed = ["ACCEPTED", "PACKED", "DISPATCHED", "DELIVERED", "CANCELLED"];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: "Invalid status." });
  const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Order not found." });
  if (req.user.role === "DEALER" && existing.dealerId !== req.user.id) return res.status(403).json({ error: "Not your order." });
  const updated = await prisma.order.update({ where: { id: existing.id }, data: { status: req.body.status } });
  await audit(req, "ORDER_STATUS_CHANGED", "Order", updated.id, req.body.status);
  res.json(updated);
});

app.get("/api/admin/users", auth, roles("ADMIN"), async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, status: true, businessName: true, drugLicenseNo: true, gstin: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  res.json(users);
});
app.patch("/api/admin/users/:id/status", auth, roles("ADMIN"), async (req, res) => {
  if (!["APPROVED", "REJECTED", "SUSPENDED", "PENDING"].includes(req.body?.status)) return res.status(400).json({ error: "Invalid status." });
  const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: req.body.status } });
  await audit(req, "USER_STATUS_CHANGED", "User", user.id, req.body.status);
  res.json({ id: user.id, email: user.email, role: user.role, status: user.status });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(24).toString("hex") + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png"]);
    if (!allowed.has(file.mimetype)) return cb(new Error("Only PDF, JPG and PNG files are accepted."));
    cb(null, true);
  }
});
app.post("/api/documents/license", auth, roles("CHEMIST", "DEALER"), upload.single("document"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Upload a PDF, JPG or PNG up to 5 MB." });
  const doc = await prisma.licenseDocument.create({ data: {
    userId: req.user.id, originalName: path.basename(req.file.originalname).slice(0,200),
    storedName: req.file.filename, mimeType: req.file.mimetype, sizeBytes: req.file.size
  }});
  await audit(req, "LICENSE_DOCUMENT_UPLOADED", "LicenseDocument", doc.id);
  res.status(201).json({ message: "Document uploaded for review.", documentId: doc.id, status: doc.reviewStatus });
});
app.get("/api/documents/license/:id", auth, async (req, res) => {
  const doc = await prisma.licenseDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return res.status(404).json({ error: "Document not found." });
  if (req.user.role !== "ADMIN" && doc.userId !== req.user.id) return res.status(403).json({ error: "Not permitted." });
  const filePath = path.join(uploadDir, path.basename(doc.storedName));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File is not on this server. Production should use private object storage." });
  res.setHeader("Content-Type", doc.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${path.basename(doc.originalName).replace(/["\\]/g, "")}"`);
  fs.createReadStream(filePath).pipe(res);
});
app.get("/api/admin/documents", auth, roles("ADMIN"), async (_req, res) => {
  const docs = await prisma.licenseDocument.findMany({ include: { user: { select: { id: true, name: true, email: true, businessName: true } } }, orderBy: { createdAt: "desc" } });
  res.json(docs.map(d => ({ id: d.id, originalName: d.originalName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, reviewStatus: d.reviewStatus, reviewNote: d.reviewNote, createdAt: d.createdAt, user: d.user })));
});
app.patch("/api/admin/documents/:id/review", auth, roles("ADMIN"), async (req, res) => {
  const { reviewStatus, reviewNote } = req.body || {};
  if (!["APPROVED", "REJECTED", "PENDING"].includes(reviewStatus)) return res.status(400).json({ error: "Invalid review status." });
  const doc = await prisma.licenseDocument.update({ where: { id: req.params.id }, data: { reviewStatus, reviewNote: reviewNote ? String(reviewNote).slice(0,1000) : null } });
  await audit(req, "LICENSE_DOCUMENT_REVIEWED", "LicenseDocument", doc.id, reviewStatus);
  res.json({ id: doc.id, reviewStatus: doc.reviewStatus });
});

app.get("/api/admin/audit-logs", auth, roles("ADMIN"), async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json(logs);
});

// Integration endpoints intentionally fail closed until provider credentials and verified
// webhook/signature handling are configured. Do not mark orders as paid from the browser.
app.get("/api/integrations/status", auth, roles("ADMIN"), (_req, res) => {
  res.json({
    database: Boolean(process.env.DATABASE_URL),
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET),
    whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    note: "Credentials alone do not finish integration; payment signatures, WhatsApp templates and provider tests are required."
  });
});
app.post("/api/payments/create-order", auth, roles("CHEMIST"), (_req, res) => res.status(501).json({ error: "Payment integration is not enabled. Configure and test Razorpay order creation and signed webhooks before accepting payments." }));
app.post("/api/webhooks/razorpay", (_req, res) => res.status(501).json({ error: "Webhook signature verification must be implemented before this endpoint can be used." }));
app.post("/api/notifications/whatsapp/test", auth, roles("ADMIN"), (_req, res) => res.status(501).json({ error: "WhatsApp Cloud API integration and approved templates must be configured and tested first." }));

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(400).json({ error: err.message || "Request error." });
});
app.listen(PORT, "0.0.0.0", () => console.log(`Vardion portal listening on ${PORT}`));
process.on("SIGTERM", async () => { await prisma.$disconnect(); process.exit(0); });

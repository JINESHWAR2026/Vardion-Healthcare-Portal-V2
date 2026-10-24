
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

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const uploadDir = path.join(__dirname, "storage", "private");

fs.mkdirSync(uploadDir, { recursive: true });

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be at least 32 characters.");
  process.exit(1);
}

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) =>
      cb(null, crypto.randomUUID())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png"
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only PDF, JPG and PNG files are allowed."));
    }
    cb(null, true);
  }
});

function cleanUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function asyncRoute(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Please log in." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Log in again." });
  }
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "Permission denied." });
    }
    next();
  };
}

async function logAction(req, action, entityType, entityId, details) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.id || null,
        action,
        entityType,
        entityId: entityId || null,
        details: details ? JSON.stringify(details).slice(0, 4000) : null,
        ipAddress: req.ip || null
      }
    });
  } catch (error) {
    console.error("Audit log error:", error.message);
  }
}

async function notifyUser(userId, type, title, message, _actorId = null, _link = null) {
  // Keep notification writes compatible with the deployed Prisma Notification model:
  // id, userId, title, message, type, read, createdAt.
  try {
    await prisma.notification.create({
      data: {
        userId,
        type: String(type).slice(0, 80),
        title: String(title).slice(0, 160),
        message: String(message).slice(0, 1000)
      }
    });
  } catch (error) {
    console.error("Notification create error:", error.message);
  }
}

function positiveInt(value, name = "quantity") {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive whole number.`);
  }
  return n;
}

function pricePaise(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) {
    throw new Error(`${name} must be a valid price in rupees.`);
  }
  return Math.round(n * 100);
}

function productInput(body, partial = false) {
  const data = {};

  for (const field of ["sku", "name"]) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "string" || !body[field].trim()) {
        throw new Error(`${field} is required.`);
      }
      data[field] = body[field].trim();
    } else if (!partial) {
      throw new Error(`${field} is required.`);
    }
  }

  for (const field of ["composition", "packSize"]) {
    if (body[field] !== undefined) {
      data[field] = body[field] ? String(body[field]).trim() : null;
    }
  }

  for (const field of ["mrp", "dealerPrice", "chemistPrice"]) {
    if (body[field] !== undefined) {
      const dbField = {
        mrp: "mrpPaise",
        dealerPrice: "dealerPaise",
        chemistPrice: "chemistPaise"
      }[field];
      data[dbField] = pricePaise(body[field], field);
    } else if (!partial) {
      throw new Error(`${field} is required (rupees).`);
    }
  }

  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive);
  }

  return data;
}

function publicProduct(product, role) {
  if (!product) return product;
  const result = { ...product };
  result.mrp = result.mrpPaise / 100;
  result.dealerPrice = result.dealerPaise / 100;
  result.chemistPrice = result.chemistPaise / 100;
  result.price = ["DEALER", "DISTRIBUTOR"].includes(role)
    ? result.dealerPrice
    : result.chemistPrice;
  return result;
}

function publicOrder(order) {
  if (!order) return order;
  return {
    ...order,
    subtotal: order.subtotalPaise / 100,
    tax: order.taxPaise / 100,
    total: order.totalPaise / 100
  };
}

// Health checks
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Vardion Healthcare Portal",
    databaseConfigured: Boolean(process.env.DATABASE_URL)
  });
});

app.get("/api/health/db", asyncRoute(async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true, database: "connected" });
}));


 // Registration with private licence-document uploads
app.post(
  "/api/auth/register",
  authLimiter,
  upload.array("documents", 5),
  asyncRoute(async (req, res) => {
    const files = req.files || [];

    const removeUploadedFiles = () => {
      for (const file of files) {
        fs.unlink(file.path, () => {});
      }
    };

    try {
      const {
        name, email, password, phone, role,
        businessName, drugLicenseNo, gstin, address
      } = req.body || {};

      if (!name?.trim() || !email?.trim() || !password) {
        removeUploadedFiles();
        return res.status(400).json({
          error: "Name, email and password are required."
        });
      }

      if (String(password).length < 10 || String(password).length > 128) {
        removeUploadedFiles();
        return res.status(400).json({
          error: "Password must be 10 to 128 characters."
        });
      }

      if (!["CHEMIST", "DEALER", "DISTRIBUTOR"].includes(role)) {
        removeUploadedFiles();
        return res.status(400).json({
          error: "Registration role must be CHEMIST, DEALER or DISTRIBUTOR."
        });
      }

      const normalizedEmail = String(email).trim().toLowerCase();

      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail }
      });

      if (existing) {
        removeUploadedFiles();
        return res.status(409).json({
          error: "Email already registered."
        });
      }

      const user = await prisma.user.create({
        data: {
          name: String(name).trim(),
          email: normalizedEmail,
          passwordHash: await bcrypt.hash(password, 12),
          phone: phone ? String(phone).trim() : null,
          role,
          status: "PENDING",
          businessName: businessName ? String(businessName).trim() : null,
          drugLicenseNo: drugLicenseNo ? String(drugLicenseNo).trim() : null,
          gstin: gstin ? String(gstin).trim() : null,
          address: address ? String(address).trim() : null,
          documents: {
            create: files.map(file => ({
              originalName: path.basename(file.originalname).slice(0, 255),
              storedName: file.filename,
              mimeType: file.mimetype,
              sizeBytes: file.size,
              reviewStatus: "PENDING"
            }))
          }
        }
      });

      await logAction(
        { user: { id: user.id, role: user.role } },
        "USER_REGISTERED",
        "User",
        user.id,
        { uploadedDocuments: files.length }
      );

      return res.status(201).json({
        message: "Registration submitted. Wait for admin approval.",
        user: cleanUser(user),
        documentsUploaded: files.length
      });
    } catch (error) {
      removeUploadedFiles();
      throw error;
    }
  })
);


// Login
app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;

  if (!email || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (user.status !== "APPROVED") {
    return res.status(403).json({
      error: `Account status: ${user.status}. Contact the administrator.`
    });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "12h", issuer: "vardion-healthcare" }
  );

  res.json({ token, user: cleanUser(user) });
}));

// Compatibility route for frontend requests to /api/me
app.get("/api/me", auth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id }
  });

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  res.json(cleanUser(user));
}));

// Current user can edit their own business profile; edits return account to review.
app.patch("/api/me/profile", auth, asyncRoute(async (req, res) => {
  const fields = ["name", "phone", "businessName", "drugLicenseNo", "gstin", "address"];
  const data = {};
  for (const field of fields) {
    if (req.body?.[field] !== undefined) {
      const value = req.body[field];
      data[field] = value == null || String(value).trim() === "" ? null : String(value).trim();
    }
  }
  if (data.name === null || data.name === "") {
    return res.status(400).json({ error: "Name cannot be empty." });
  }
  data.status = "PENDING";
  data.correctionNote = null;
  data.correctionRequestedAt = null;
  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  await logAction(req, "PROFILE_UPDATED", "User", user.id);
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "APPROVED" }, select: { id: true } });
  await Promise.all(admins.map(a => notifyUser(a.id, "ACCOUNT_UPDATE", "Profile updated", `${user.name} updated their profile and requires review.`, req.user.id)));
  res.json({ message: "Profile updated and sent for admin review.", user: cleanUser(user) });
}));

app.post("/api/me/correction-request", auth, asyncRoute(async (req, res) => {
  const note = String(req.body?.message || "").trim().slice(0, 1000);
  if (!note) return res.status(400).json({ error: "Please describe the correction needed." });
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { correctionNote: note, correctionRequestedAt: new Date() }
  });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "APPROVED" }, select: { id: true } });
  await Promise.all(admins.map(a => notifyUser(a.id, "CORRECTION_REQUEST", "Profile correction requested", `${user.name}: ${note}`, req.user.id)));
  await logAction(req, "CORRECTION_REQUESTED", "User", user.id);
  res.status(201).json({ message: "Correction request sent." });
}));

app.get("/api/notifications", auth, asyncRoute(async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ notifications, unreadCount: notifications.filter(n => !n.read).length });
}));

app.patch("/api/notifications/:id/read", auth, asyncRoute(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id, read: false },
    data: { read: true }
  });
  if (!result.count) {
    const existing = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) return res.status(404).json({ error: "Notification not found." });
  }
  res.json({ message: "Notification marked as read." });
}));

app.post("/api/notifications/read-all", auth, asyncRoute(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true }
  });
  res.json({ message: "Notifications marked as read.", count: result.count });
}));

app.get("/api/admin/dashboard", auth, roles("ADMIN"), asyncRoute(async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [registrationsToday, pending, approved, rejected, suspended, chemists, dealers, distributors, ordersToday, correctionRequests, linkedChemists] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { status: "APPROVED" } }),
    prisma.user.count({ where: { status: "REJECTED" } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.user.count({ where: { role: "CHEMIST" } }),
    prisma.user.count({ where: { role: "DEALER" } }),
    prisma.user.count({ where: { role: "DISTRIBUTOR" } }),
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { correctionRequestedAt: { not: null } } }),
    prisma.user.count({ where: { role: "CHEMIST", OR: [{ assignedDealerId: { not: null } }, { assignedDistributorId: { not: null } }] } })
  ]);
  res.json({ registrationsToday, pending, approved, rejected, suspended, chemists, dealers, distributors, ordersToday, correctionRequests, linkedChemists, unlinkedChemists: Math.max(0, chemists - linkedChemists) });
}));

app.get("/api/admin/assignments", auth, roles("ADMIN"), asyncRoute(async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { in: ["CHEMIST", "DEALER", "DISTRIBUTOR"] } },
    select: { id: true, name: true, email: true, role: true, status: true, assignedDealerId: true, assignedDistributorId: true, parentDistributorId: true },
    orderBy: { name: "asc" }
  });
  res.json({ users });
}));

app.patch("/api/admin/users/:id/assignment", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found." });
  const data = {};
  if (target.role === "CHEMIST") {
    const dealerId = req.body?.dealerId || null;
    const distributorId = req.body?.distributorId || null;
    if (dealerId && distributorId) return res.status(400).json({ error: "Assign a chemist to either a dealer or distributor, not both." });
    if (dealerId) {
      const dealer = await prisma.user.findUnique({ where: { id: dealerId } });
      if (!dealer || dealer.role !== "DEALER" || dealer.status !== "APPROVED") return res.status(400).json({ error: "Choose an approved dealer." });
    }
    if (distributorId) {
      const distributor = await prisma.user.findUnique({ where: { id: distributorId } });
      if (!distributor || distributor.role !== "DISTRIBUTOR" || distributor.status !== "APPROVED") return res.status(400).json({ error: "Choose an approved distributor." });
    }
    data.assignedDealerId = dealerId;
    data.assignedDistributorId = distributorId;
  } else if (target.role === "DEALER") {
    const distributorId = req.body?.parentDistributorId || null;
    if (distributorId) {
      const distributor = await prisma.user.findUnique({ where: { id: distributorId } });
      if (!distributor || distributor.role !== "DISTRIBUTOR" || distributor.status !== "APPROVED") return res.status(400).json({ error: "Choose an approved distributor." });
    }
    data.parentDistributorId = distributorId;
  } else {
    return res.status(400).json({ error: "Only chemists and dealers can be assigned." });
  }
  const user = await prisma.user.update({ where: { id: target.id }, data });
  await notifyUser(user.id, "ASSIGNMENT_UPDATE", "Business assignment updated", "Your fulfillment assignment was updated by the administrator.", req.user.id);
  await logAction(req, "USER_ASSIGNMENT_UPDATED", "User", user.id, data);
  res.json({ user: cleanUser(user) });
}));

// Products
app.get("/api/products", auth, asyncRoute(async (req, res) => {
  const where = req.user.role === "ADMIN"
    ? {}
    : { isActive: true };

  const products = await prisma.product.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      batches: {
        select: { quantity: true, expiryDate: true, batchNo: true }
      }
    }
  });

  res.json({
    products: products.map(p => ({
      ...publicProduct(p, req.user.role),
      availableQuantity: p.batches.reduce((sum, b) => sum + b.quantity, 0)
    }))
  });
}));

app.post("/api/products", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const data = productInput(req.body);
  const product = await prisma.product.create({ data });
  await logAction(req, "PRODUCT_CREATED", "Product", product.id);
  res.status(201).json({ product: publicProduct(product, "ADMIN") });
}));

app.patch("/api/products/:id", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const data = productInput(req.body, true);
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data
  });
  await logAction(req, "PRODUCT_UPDATED", "Product", product.id);
  res.json({ product: publicProduct(product, "ADMIN") });
}));

// Admin-only product removal: deactivate instead of hard-delete so past orders remain intact.
app.delete("/api/products/:id", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const product = await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
  await logAction(req, "PRODUCT_DEACTIVATED", "Product", product.id, { name: product.name });
  res.json({ message: "Product removed from the active catalogue. Previous order records are preserved.", product: publicProduct(product, "ADMIN") });
}));

app.patch("/api/products/:id/restore", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Product not found." });
  const product = await prisma.product.update({ where: { id: req.params.id }, data: { isActive: true } });
  await logAction(req, "PRODUCT_REACTIVATED", "Product", product.id, { name: product.name });
  res.json({ message: "Product restored to the active catalogue.", product: publicProduct(product, "ADMIN") });
}));

// Inventory batches
app.get("/api/inventory", auth, roles("ADMIN", "DEALER", "DISTRIBUTOR"), asyncRoute(async (_req, res) => {
  const batches = await prisma.inventoryBatch.findMany({
    include: { product: true },
    orderBy: { expiryDate: "asc" }
  });
  res.json({ batches });
}));

app.post("/api/inventory/batches", auth, roles("ADMIN", "DEALER", "DISTRIBUTOR"), asyncRoute(async (req, res) => {
  const { productId, batchNo, expiryDate, quantity } = req.body || {};
  if (!productId || !batchNo || !expiryDate) {
    return res.status(400).json({
      error: "productId, batchNo and expiryDate are required."
    });
  }

  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty < 0) {
    return res.status(400).json({ error: "Quantity must be zero or more." });
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return res.status(400).json({ error: "Invalid expiry date." });
  }

  const batch = await prisma.inventoryBatch.create({
    data: {
      productId: String(productId),
      batchNo: String(batchNo).trim(),
      expiryDate: expiry,
      quantity: qty
    },
    include: { product: true }
  });

  await logAction(req, "BATCH_CREATED", "InventoryBatch", batch.id);
  res.status(201).json({ batch });
}));

app.patch("/api/inventory/batches/:id", auth, roles("ADMIN", "DEALER", "DISTRIBUTOR"), asyncRoute(async (req, res) => {
  const data = {};

  if (req.body.quantity !== undefined) {
    const qty = Number(req.body.quantity);
    if (!Number.isSafeInteger(qty) || qty < 0) {
      return res.status(400).json({ error: "Invalid quantity." });
    }
    data.quantity = qty;
  }

  if (req.body.expiryDate !== undefined) {
    const date = new Date(req.body.expiryDate);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: "Invalid expiry date." });
    }
    data.expiryDate = date;
  }

  if (req.body.batchNo !== undefined) {
    data.batchNo = String(req.body.batchNo).trim();
  }

  const batch = await prisma.inventoryBatch.update({
    where: { id: req.params.id },
    data
  });

  await logAction(req, "BATCH_UPDATED", "InventoryBatch", batch.id);
  res.json({ batch });
}));

// Orders
app.post("/api/orders", auth, roles("CHEMIST"), asyncRoute(async (req, res) => {
  const { items, deliveryAddress, notes } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Add at least one order item." });
  }

  if (!deliveryAddress?.trim()) {
    return res.status(400).json({ error: "Delivery address is required." });
  }

  const quantities = new Map();

  for (const item of items) {
    if (!item.productId) {
      return res.status(400).json({ error: "Every item needs a productId." });
    }
    const qty = positiveInt(item.quantity);
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + qty);
  }

  const ids = [...quantities.keys()];
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true }
  });

  if (products.length !== ids.length) {
    return res.status(400).json({ error: "One or more products are unavailable." });
  }

  const productMap = new Map(products.map(p => [p.id, p]));
  const orderItems = [];
  let subtotalPaise = 0;

  for (const [productId, quantity] of quantities) {
    const product = productMap.get(productId);
    const unitPricePaise = ["DEALER", "DISTRIBUTOR"].includes(req.user.role)
      ? product.dealerPaise
      : product.chemistPaise;

    const lineTotalPaise = unitPricePaise * quantity;
    if (!Number.isSafeInteger(lineTotalPaise)) {
      return res.status(400).json({ error: "Order total is too large." });
    }

    subtotalPaise += lineTotalPaise;
    orderItems.push({
      productId,
      quantity,
      unitPricePaise,
      lineTotalPaise
    });
  }

  if (!Number.isSafeInteger(subtotalPaise)) {
    return res.status(400).json({ error: "Order total is too large." });
  }

  const order = await prisma.order.create({
    data: {
      orderNo: `VOR-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      chemistId: req.user.id,
      dealerId: (await prisma.user.findUnique({ where: { id: req.user.id }, select: { assignedDealerId: true } }))?.assignedDealerId || null,
      distributorId: (await prisma.user.findUnique({ where: { id: req.user.id }, select: { assignedDistributorId: true } }))?.assignedDistributorId || null,
      subtotalPaise,
      taxPaise: 0,
      totalPaise: subtotalPaise,
      deliveryAddress: String(deliveryAddress).trim(),
      notes: notes ? String(notes).trim().slice(0, 1000) : null,
      items: { create: orderItems }
    },
    include: { items: { include: { product: true } } }
  });

  await logAction(req, "ORDER_CREATED", "Order", order.id);
  res.status(201).json({ order: publicOrder(order) });
}));

app.get("/api/orders", auth, asyncRoute(async (req, res) => {
  const where = req.user.role === "ADMIN"
    ? {}
    : req.user.role === "DEALER"
      ? { dealerId: req.user.id }
      : req.user.role === "DISTRIBUTOR"
        ? { OR: [{ distributorId: req.user.id }, { chemist: { parentDistributorId: req.user.id } }] }
        : { chemistId: req.user.id };

  const orders = await prisma.order.findMany({
    where,
    include: {
      chemist: { select: { id: true, name: true, email: true, phone: true, businessName: true } },
      dealer: { select: { id: true, name: true, email: true, phone: true } },
      distributor: { select: { id: true, name: true, email: true, phone: true } },
      items: { include: { product: true } },
      payment: true
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  res.json({ orders: orders.map(publicOrder) });
}));

app.get("/api/orders/:id", auth, asyncRoute(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      chemist: { select: { id: true, name: true, email: true, phone: true } },
      dealer: { select: { id: true, name: true, email: true, phone: true } },
      distributor: { select: { id: true, name: true, email: true, phone: true } },
      items: { include: { product: true } },
      payment: true
    }
  });

  if (!order) return res.status(404).json({ error: "Order not found." });

  const permitted = req.user.role === "ADMIN" ||
    order.chemistId === req.user.id ||
    order.dealerId === req.user.id ||
    (req.user.role === "DEALER" && order.dealerId === req.user.id) ||
    (req.user.role === "DISTRIBUTOR" && order.distributorId === req.user.id);

  if (!permitted) return res.status(403).json({ error: "Permission denied." });
  res.json({ order: publicOrder(order) });
}));

app.patch("/api/orders/:id/status", auth, roles("ADMIN", "DEALER", "DISTRIBUTOR"), asyncRoute(async (req, res) => {
  const allowed = [
    "ACCEPTED", "PACKED", "DISPATCHED", "DELIVERED", "CANCELLED"
  ];
  const status = req.body?.status;

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid order status." });
  }

  const existing = await prisma.order.findUnique({
    where: { id: req.params.id }
  });

  if (!existing) return res.status(404).json({ error: "Order not found." });

  if (req.user.role === "DEALER" && existing.dealerId !== req.user.id) {
    return res.status(403).json({ error: "This order is not assigned to your dealer account." });
  }
  if (req.user.role === "DISTRIBUTOR" && existing.distributorId !== req.user.id) {
    return res.status(403).json({ error: "This order is not assigned to your distributor account." });
  }

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status,
      
    },
    include: { items: { include: { product: true } }, chemist: { select: { id: true } } }
  });

  await notifyUser(order.chemistId, "ORDER_UPDATE", "Order status updated", `Order ${order.orderNo} status is now ${status}.`, req.user.id, `/orders/${order.id}`);
  await logAction(req, "ORDER_STATUS_UPDATED", "Order", order.id, { status });
  res.json({ order: publicOrder(order) });
}));

// Admin: user management
app.get("/api/admin/users", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const where = req.query.status ? { status: String(req.query.status) } : {};
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      status: true, businessName: true, drugLicenseNo: true,
      gstin: true, address: true, createdAt: true, updatedAt: true
    },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  res.json({ users });
}));

app.patch("/api/admin/users/:id/status", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const status = req.body?.status;
  if (!["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].includes(status)) {
    return res.status(400).json({ error: "Invalid user status." });
  }

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found." });

  if (target.role === "ADMIN" && target.id === req.user.id && status !== "APPROVED") {
    return res.status(400).json({ error: "You cannot suspend your own admin account." });
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { status }
  });

  await logAction(req, "USER_STATUS_UPDATED", "User", user.id, { status });
  res.json({ user: cleanUser(user) });
}));

app.patch("/api/admin/users/:id", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const data = {};
  for (const field of [
    "name", "phone", "businessName", "drugLicenseNo", "gstin", "address"
  ]) {
    if (req.body[field] !== undefined) {
      data[field] = req.body[field] ? String(req.body[field]).trim() : null;
    }
  }

  if (req.body.role !== undefined) {
    if (!["CHEMIST", "DEALER", "DISTRIBUTOR", "ADMIN"].includes(req.body.role)) {
      return res.status(400).json({ error: "Invalid role." });
    }
    data.role = req.body.role;
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data
  });

  await logAction(req, "USER_UPDATED", "User", user.id);
  res.json({ user: cleanUser(user) });
}));

// Account deletion: Admin only; only CHEMIST and DEALER accounts are eligible.
// Related records may prevent deletion; in that case preserve the account/history and return a clear conflict.
app.delete("/api/admin/users/:id", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: "User not found." });
  if (!["CHEMIST", "DEALER"].includes(target.role)) {
    return res.status(403).json({ error: "Only Chemist and Dealer accounts can be deleted. Distributor and Admin accounts cannot be deleted here." });
  }
  try {
    await logAction(req, "USER_DELETE_REQUESTED", "User", target.id, { role: target.role, email: target.email });
    await prisma.user.delete({ where: { id: target.id } });
    res.json({ message: `${target.role} account deleted.` });
  } catch (error) {
    console.error("Account deletion blocked:", error.message);
    res.status(409).json({ error: "This account has linked orders, documents or assignments and cannot be safely deleted yet. Keep the history intact and unlink/archive the account first." });
  }
}));

// Licence documents: private files, never served as static assets
app.post(
  "/api/documents",
  auth,
  upload.array("documents", 5),
  asyncRoute(async (req, res) => {
    if (!["CHEMIST", "DEALER", "DISTRIBUTOR"].includes(req.user.role)) {
      for (const file of req.files || []) fs.unlink(file.path, () => {});
      return res.status(403).json({ error: "Only chemists, dealers and distributors can upload documents." });
    }

    if (!req.files?.length) {
      return res.status(400).json({ error: "Choose at least one document." });
    }

    const created = await prisma.licenseDocument.createMany({
      data: req.files.map(file => ({
        userId: req.user.id,
        originalName: path.basename(file.originalname).slice(0, 255),
        storedName: file.filename,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        reviewStatus: "PENDING"
      }))
    });

    await logAction(req, "DOCUMENTS_UPLOADED", "LicenseDocument", null, {
      count: created.count
    });

    res.status(201).json({
      message: "Documents uploaded for review.",
      count: created.count
    });
  })
);

app.get("/api/documents", auth, asyncRoute(async (req, res) => {
  const where = req.user.role === "ADMIN"
    ? {}
    : { userId: req.user.id };

  const documents = await prisma.licenseDocument.findMany({
    where,
    select: {
      id: true, userId: true, originalName: true, mimeType: true,
      sizeBytes: true, reviewStatus: true, reviewNote: true, createdAt: true,
      user: { select: { name: true, email: true, role: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  res.json({ documents });
}));

app.get("/api/documents/:id/download", auth, asyncRoute(async (req, res) => {
  const doc = await prisma.licenseDocument.findUnique({
    where: { id: req.params.id }
  });

  if (!doc) return res.status(404).json({ error: "Document not found." });

  if (req.user.role !== "ADMIN" && doc.userId !== req.user.id) {
    return res.status(403).json({ error: "Permission denied." });
  }

  const filePath = path.join(uploadDir, path.basename(doc.storedName));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Stored file is unavailable." });
  }

  res.download(filePath, doc.originalName);
}));

app.patch("/api/admin/documents/:id/review", auth, roles("ADMIN"), asyncRoute(async (req, res) => {
  const { reviewStatus, reviewNote } = req.body || {};

  if (!["APPROVED", "REJECTED", "PENDING"].includes(reviewStatus)) {
    return res.status(400).json({ error: "Invalid review status." });
  }

  const doc = await prisma.licenseDocument.update({
    where: { id: req.params.id },
    data: {
      reviewStatus,
      reviewNote: reviewNote ? String(reviewNote).trim().slice(0, 1000) : null
    }
  });

  await logAction(req, "DOCUMENT_REVIEWED", "LicenseDocument", doc.id, {
    reviewStatus
  });

  res.json({ document: doc });
}));

// Admin audit log
app.get("/api/admin/audit-logs", auth, roles("ADMIN"), asyncRoute(async (_req, res) => {
  const logs = await prisma.auditLog.findMany({
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 300
  });
  res.json({ logs });
}));

// Payment integration placeholder: do not mark payments as paid without provider verification
app.post("/api/payments/create", auth, roles("CHEMIST"), asyncRoute(async (_req, res) => {
  return res.status(501).json({
    error: "Payment gateway is not configured yet. Add and verify Razorpay integration before accepting payments."
  });
}));

app.post("/api/webhooks/razorpay", async (_req, res) => {
  return res.status(501).json({
    error: "Razorpay webhook verification is not configured."
  });
});

// WhatsApp integration placeholder
app.post("/api/notifications/whatsapp", auth, roles("ADMIN"), async (_req, res) => {
  return res.status(501).json({
    error: "WhatsApp provider credentials and template configuration are not set up."
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.use((err, _req, res, _next) => {
  console.error("Request error:", err.message);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }

  const status = err.code === "P2002" ? 409 :
    err.code === "P2025" ? 404 : 400;

  res.status(status).json({
    error: err.code === "P2002"
      ? "A record with this value already exists."
      : err.code === "P2025"
        ? "Record not found."
        : err.message || "Request error."
  });
});

// Initial admin account (configured using Render environment variables)
async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("Admin bootstrap skipped: ADMIN_EMAIL/ADMIN_PASSWORD not configured");
    return;
  }

  if (password.length < 12) {
    console.error("ADMIN_PASSWORD must be at least 12 characters.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log("Admin bootstrap skipped: email already exists");
    return;
  }

  await prisma.user.create({
    data: {
      name: process.env.ADMIN_NAME || "Vardion Admin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "ADMIN",
      status: "APPROVED"
    }
  });

  console.log("Initial admin account created.");
}

// Start HTTP server FIRST so database bootstrap errors do not cause a port timeout
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Vardion Healthcare Portal listening on port ${PORT}`);

  prisma.$connect()
    .then(() => {
      console.log("Database connected.");
      return bootstrapAdmin();
    })
    .catch(error => {
      console.error("Database/admin bootstrap failed:", error.message);
    });
});

server.on("error", error => {
  console.error("HTTP server error:", error);
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
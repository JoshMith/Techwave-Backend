import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import { errorHandler, notFound } from "./middlewares/errorMiddlewares";
import authRoutes from "./routes/authRoutes";
import usersRoute from "./routes/usersRoute";
import sellersRoutes from "./routes/sellersRoutes";
import addressesRoutes from "./routes/addressesRoutes";
import categoriesRoutes from "./routes/categoriesRoutes";
import productsRoutes from "./routes/productsRoutes";
import productImagesRoutes from "./routes/productImagesRoutes";
import ordersRoutes from "./routes/ordersRoutes";
import orderItemsRoutes from "./routes/orderItemsRoutes";
import specialOffersRoutes from "./routes/specialOffersRoutes";
import productOffersRoutes from "./routes/productOffersRoutes";
import paymentsRoutes from "./routes/paymentsRoutes";
import reviewsRoutes from "./routes/reviewsRoutes";
import deliveryPriceRoutes from "./routes/deliveryPriceRoutes";
import passport from "./config/googleStrategy";
import session from "express-session";
import path from "path";
import cartItemsRoutes from "./routes/cartItemsRoutes";
import cartRoutes from "./routes/cartRoutes";
import mpesaRoutes from "./routes/mpesaRoutes";
import adminDashboardRoutes from "./routes/adminDashboardRoutes";
import adminManagementRoutes from "./routes/adminManagementRoutes";

// 1:dotenv
dotenv.config();

//2:instance of express
const app = express();

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Cookie parser middleware
app.use(cookieParser());

// CORS middleware - FIXED VERSION
const allowedOrigins = [process.env.FRONTEND_URL];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-CSRF-Token",
      "ngrok-skip-browser-warning",
    ],
    exposedHeaders: ["Set-Cookie", "Authorization"], // ← Expose Authorization
    maxAge: 86400, // 24 hours
  })
);

// Handle preflight requests explicitly
app.options("*", (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-CSRF-Token, ngrok-skip-browser-warning"
  );
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(200);
});

//4. routes
app.use("/auth", authRoutes);
app.use("/users", usersRoute);
app.use("/sellers", sellersRoutes);
app.use("/addresses", addressesRoutes);
app.use("/categories", categoriesRoutes);
app.use("/products", productsRoutes);
app.use("/product-images", productImagesRoutes);
app.use("/carts", cartRoutes);
app.use("/cart-items", cartItemsRoutes);
app.use("/orders", ordersRoutes);
app.use("/order-items", orderItemsRoutes);
app.use("/special-offers", specialOffersRoutes);
app.use("/product-offers", productOffersRoutes);
app.use("/payments", paymentsRoutes);
app.use("/reviews", reviewsRoutes);
app.use("/delivery-prices", deliveryPriceRoutes);
app.use("/mpesa", mpesaRoutes);
app.use("/admin/dashboard", adminDashboardRoutes);
app.use("/admin/manage", adminManagementRoutes);

// Update your static files configuration
app.use(
  "/public",
  express.static(path.join(__dirname, "../public"), {
    setHeaders: (res, path) => {
      res.set("Cache-Control", "public, max-age=31536000");
    },
  })
);

app.use(express.static(path.join(__dirname, "../public")));

// Google strategy
app.use(
  session({
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "development" ? false : true,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "none", // Important for cross-origin
    },
    proxy: true,
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Techwave Backend API</title>
  <link href="https://fonts.googleapis.com/css?family=Montserrat:700,400&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Montserrat', Arial, sans-serif;
      background: linear-gradient(135deg, #00c6ff 0%, #0072ff 100%);
      color: #fff;
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: rgba(255,255,255,0.08);
      padding: 40px 32px;
      border-radius: 18px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      text-align: center;
      max-width: 420px;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 18px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    p {
      font-size: 1.08rem;
      margin-bottom: 18px;
      font-weight: 400;
    }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      font-size: 1.1rem;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(90deg, #ff512f 0%, #dd2476 100%);
      border: none;
      border-radius: 8px;
      text-decoration: none;
      box-shadow: 0 2px 8px rgba(221,36,118,0.18);
      transition: background 0.2s, transform 0.2s;
      cursor: pointer;
    }
    .btn:hover {
      background: linear-gradient(90deg, #dd2476 0%, #ff512f 100%);
      transform: translateY(-2px) scale(1.04);
    }
    @media (max-width: 500px) {
      .container {
        padding: 24px 8px;
      }
      h1 {
        font-size: 2rem;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Techwave Backend API</h1>
    <p>Welcome to the backend API for <strong>Techwave</strong>.<br>
    Manage products, orders, users, and more with powerful endpoints.</p>
    <p>Ready to explore the frontend?</p>
    <a class="btn" href="https://techwaveelectronics.co.ke " target="_blank">Go to Techwave Frontend</a>
    <br><br>
    <p style="margin-top:22px;font-size:0.95rem;opacity:0.7;">Enjoy building with Techwave!</p>
  </div>
</body>
</html>
  `);
});

//5. middlewares for error handlers
app.use(notFound, errorHandler);

//6: start the serve
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║          🚀 TECHWAVE BACKEND API SERVER ACTIVATED! 🚀         ║
║                                                               ║
║  ✨ Running on port: ${PORT}                                     ║
║  🌐 API Link: https://techwaveelectronics.co.ke/api           ║
║  💪 Ready to handle requests and rock the digital world!      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

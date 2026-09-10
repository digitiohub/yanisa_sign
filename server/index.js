const path = require('path');
// Loaded before anything else is required. Route and service modules read
// settings like rate limits and token lifetimes at module load, so a .env
// parsed after those requires would silently leave every one of them on its
// default. (Container environments set these directly and were unaffected.)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const signRoutes = require('./routes/sign');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { initStorage } = require('./services/storage');
const { bootstrap } = require('./services/bootstrap');
const { warmMailer } = require('./config/mailer');

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: isProduction && !process.env.CLIENT_URL
    ? false
    : (process.env.CLIENT_URL || 'http://localhost:5173'),
  credentials: true,
}));
app.use(compression());
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Broad safety net for the whole API. The tight limits that matter - login,
// OTP send and verify - live on those routes in routes/auth.js.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.RATE_LIMIT_GLOBAL || 1000), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down and try again shortly.' } });
app.use(limiter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Sign service ready', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sign', signRoutes);

if (isProduction) {
  const clientPath = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientPath, { maxAge: '1y', immutable: true }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(clientPath, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  console.error(err.message);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  res.status(err.status || 500).json({ error: isProduction ? 'An unexpected error occurred' : err.message });
});

async function start() {
  try {
    if (process.env.MONGO_URI) {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('MongoDB connected');
      await bootstrap();
      // Surfaces a broken SMTP configuration in the boot log rather than on
      // the first user's sign-in.
      await warmMailer();
    }
    await initStorage();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Application startup failed', err);
    process.exit(1);
  }
}

if (require.main === module) start();
module.exports = { app, start };

const rateLimit = require('express-rate-limit');

/**
 * Three code requests per email per ten minutes.
 *
 * Keyed by address rather than by IP, which is the point of this limiter:
 * the per-IP throttles already in routes/auth.js protect the server, while
 * this one protects a single mailbox from being flooded by an attacker who
 * rotates IPs. Falling back to the IP covers a malformed body that never
 * reaches the handler's validation.
 */
const otpRateLimiter = rateLimit({
  windowMs: Number(process.env.OTP_LOGIN_WINDOW_MINUTES || 10) * 60 * 1000,
  max: Number(process.env.OTP_LOGIN_MAX_REQUESTS || 3),
  standardHeaders: true,
  legacyHeaders: false,
  // Deliberately never falls back to req.ip. Keying a custom limiter on an
  // address means an IPv6 client can sidestep it by hopping to a neighbouring
  // one, so a body with no email shares a single bucket instead; every real
  // request carries an email, and the per-IP limiter in routes/auth.js already
  // covers the malformed ones.
  keyGenerator: req => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    return email ? `otp:${email}` : 'otp:anonymous';
  },
  message: { error: 'Too many codes requested for this email. Please try again in a few minutes.' },
});

module.exports = { otpRateLimiter };

/**
 * Prints the live sign-in code for an address, straight from the database.
 *
 *   node scripts/show-login-code.js someone@example.com
 *
 * Recovery tool for the case that locks everyone out: email codes are a
 * mandatory second factor, so if outgoing mail is broken nobody can finish
 * signing in - including the administrator who would fix the mail settings.
 * Run this on the server, enter the code, then repair SMTP in
 * Administration > Mail.
 *
 * Submit the password on the sign-in page FIRST: that is what mints the code
 * this reads. The code is regenerated from the stored secret, never stored in
 * plain text, and still expires on schedule.
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OtpSecret = require('../server/models/OtpSecret');
const { generateOtp, issuedAtFrom } = require('../server/utils/otp');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/show-login-code.js <email>');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  const record = await OtpSecret.findOne({ email, scope: 'login_mfa' });
  if (!record) {
    console.error(`\nNo sign-in code is waiting for ${email}.`);
    console.error('Enter the email and password on the sign-in page first, then run this again.\n');
    process.exit(1);
  }
  const secondsLeft = Math.round((record.expiresAt - Date.now()) / 1000);
  if (secondsLeft <= 0) {
    console.error(`\nThe code for ${email} has expired. Submit the password again, then re-run this.\n`);
    process.exit(1);
  }
  const otp = await generateOtp(record.secret, issuedAtFrom(record.expiresAt));
  console.log(`\n  Sign-in code for ${email}:  ${otp}`);
  console.log(`  Valid for another ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}.\n`);
  await mongoose.disconnect();
}

main().catch(error => { console.error(error.message); process.exit(1); });

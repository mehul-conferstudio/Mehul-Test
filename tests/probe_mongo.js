// Load .env manually
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?[\s]*$/);
    if (match) {
      let val = (match[2] || '').trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      process.env[match[1]] = val;
    }
  });
}

const { MongoClient } = require('mongodb');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const crypto = require('crypto');
const OTP_SALT = process.env.OTP_SALT || 'jobguard-otp-salt-9876';

function hashOtp(otp) {
  return crypto.createHmac('sha256', OTP_SALT).update(otp).digest('hex');
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const otp = await client.db('jobguard').collection('otps').findOne({email: 'mehulgupta180@gmail.com'});
    if (!otp) {
      console.log('NO_OTP_RECORD');
      return;
    }
    
    // Crack it
    for (let i = 100000; i <= 999999; i++) {
      const code = i.toString();
      if (hashOtp(code) === otp.hash) {
        console.log(`FOUND_OTP:${code}`);
        return;
      }
    }
    console.log('HASH_NOT_MATCHED');
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}
run();

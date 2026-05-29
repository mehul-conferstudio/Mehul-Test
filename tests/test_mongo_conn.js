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

const password = 'cjYzWLb52Ap7ZpeZ';
const user = 'mehultesttest_db_user';

const hostnames = [
  'ac-jjqsmoy-shard-00-00.pg1xrfm.mongodb.net',
  'ac-jjqsmoy-shard-00-01.pg1xrfm.mongodb.net',
  'ac-jjqsmoy-shard-00-02.pg1xrfm.mongodb.net'
];

async function tryHost(hostname) {
  const uri = `mongodb://${user}:${password}@${hostname}:27017/jobguard?tls=true&authSource=admin&directConnection=true`;
  console.log(`\nChecking host: ${hostname}`);
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  });
  try {
    await client.connect();
    const db = client.db('jobguard');
    const status = await db.command({ isMaster: 1 });
    console.log(`  Connected!`);
    console.log(`  isMaster/isWritablePrimary: ${status.ismaster || status.isWritablePrimary}`);
    console.log(`  ReadOnly/Secondary: ${status.secondary}`);
    await client.close();
    return { hostname, isPrimary: !!(status.ismaster || status.isWritablePrimary) };
  } catch (err) {
    console.log(`  ❌ Failed:`, err.message);
    try { await client.close(); } catch {}
    return { hostname, isPrimary: false, error: err.message };
  }
}

async function run() {
  console.log('Finding writable primary shard...');
  for (const host of hostnames) {
    const res = await tryHost(host);
    if (res.isPrimary) {
      console.log(`\n🎯 FOUND PRIMARY SHARD: ${res.hostname}`);
      const winnerUri = `mongodb://${user}:${password}@${res.hostname}:27017/jobguard?tls=true&authSource=admin&directConnection=true`;
      console.log(`Use MONGODB_URI=${winnerUri}`);
      process.exit(0);
    }
  }
  console.log('\n❌ No writable primary shard found among the listed hosts.');
  process.exit(1);
}

run();

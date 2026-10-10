import {Client} from 'pg';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {projectRoot} from '../server/config.mjs';

// Uses PG* environment variables from the user's local administrator file.
// Creates only new project resources; existing resources cause a stop.
if (!['127.0.0.1','localhost','::1'].includes(process.env.PGHOST||'')) throw new Error('Local setup requires a loopback PostgreSQL host.');
const envFile=path.join(projectRoot,'.env');
try {await readFile(envFile);throw new Error('A project .env already exists. Setup will not overwrite it.');} catch(error) {if(error.code!=='ENOENT') throw error;}
const admin=new Client({connectionTimeoutMillis:5000});
const role='arviva_website';
const databases=['arviva_website_dev','arviva_website_test'];
try {
  await admin.connect();
  const occupied=await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1 UNION ALL SELECT 1 FROM pg_database WHERE datname=ANY($2::text[])',[role,databases]);
  if (occupied.rowCount) throw new Error('A requested project role or database already exists. No existing resource was modified.');
  const password=randomBytes(32).toString('hex');
  // Identifier and password contain only fixed names / generated hexadecimal characters.
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  for (const db of databases) await admin.query(`CREATE DATABASE ${db} OWNER ${role}`);
  const host=process.env.PGHOST==='::1'?'[::1]':process.env.PGHOST;
  const prefix=`postgresql://${role}:${password}@${host}:${process.env.PGPORT||5432}/`;
  await writeFile(envFile,[
    'NODE_ENV=development','HOST=127.0.0.1','PORT=4174','APP_ORIGIN=http://127.0.0.1:4174',
    `DATABASE_URL=${prefix}${databases[0]}`,`TEST_DATABASE_URL=${prefix}${databases[1]}`,
    `AUTH_SECRET=${randomBytes(48).toString('hex')}`,
    'MAIL_MODE=development','SMTP_HOST=smtp.qq.com','SMTP_PORT=465','SMTP_USER=','SMTP_PASSWORD=','SMTP_FROM=','TRUST_PROXY=none','',
  ].join('\n'),{mode:0o600,flag:'wx'});
  console.log('Created dedicated project role, arviva_website_dev and arviva_website_test; credentials saved privately in .env.');
} catch(error) {
  console.error('Database setup failed:',error.code||error.message);
  process.exitCode=1;
} finally {await admin.end();}

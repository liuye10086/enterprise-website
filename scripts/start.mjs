import {Pool} from 'pg';
import path from 'node:path';
import {loadConfig,projectRoot} from '../server/config.mjs';
import {createMailer} from '../server/mailer.mjs';
import {createAuthService} from '../server/auth-service.mjs';
import {createApp} from '../server/app.mjs';

const config=loadConfig();
const pool=new Pool({connectionString:config.databaseUrl,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
pool.on('error',error=>console.error('Database connection error:',error.code||error.name));
const mailer=createMailer(config);
const auth=createAuthService({pool,secret:config.authSecret,sendCode:mailer.sendCode});
const server=createApp({config,auth,mailer,root:path.join(projectRoot,'dist')});
try {
  await pool.query('SELECT 1 FROM arviva_schema_migrations LIMIT 1');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});
  console.log(`Arviva application: ${config.origin}/sy`);
  console.log(`Mail mode: ${config.mailMode}${mailer.development?' (local files only; no emails sent)':''}`);
} catch(error){console.error('Startup failed. Check .env and run npm run db:migrate. Error:',error.code||error.name);await pool.end();process.exitCode=1;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;server.close();server.closeAllConnections();await pool.end();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);

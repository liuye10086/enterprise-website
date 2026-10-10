import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {projectRoot} from '../server/config.mjs';

export async function migrate(pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('arviva_schema_migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS arviva_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory=path.join(projectRoot,'db','migrations');
    for(const name of (await readdir(directory)).filter(name=>/^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()){
      const previous=await client.query('SELECT name FROM arviva_schema_migrations WHERE name=$1',[name]);
      if(previous.rowCount)continue;
      await client.query(await readFile(path.join(directory,name),'utf8'));
      await client.query('INSERT INTO arviva_schema_migrations(name) VALUES($1)',[name]);
      console.log(`Applied migration ${name}`);
    }
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before running migrations.');
  const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,max:1});
  try {await migrate(pool);console.log('Database migrations are up to date.');}
  catch(error){console.error('Migration failed:',error.code||error.name);process.exitCode=1;}
  finally {await pool.end();}
}

import pg from 'pg';
import { loadConfig } from './config.js';
import { migrate } from './store.js';
import { createApp } from './app.js';
import { makeGoogle } from './auth.js';
import { makeTranslator } from './provider.js';

const config=loadConfig();
const pool=new pg.Pool({connectionString:config.databaseURL,max:20,statement_timeout:10000});
await migrate(pool);
const server=createApp({pool,config,google:makeGoogle(config),translate:makeTranslator(config)}).listen(config.port,'0.0.0.0',()=>console.log(`ARType listening on ${config.port}`));
server.requestTimeout=60000;server.headersTimeout=10000;
const cleanup=setInterval(()=>pool.query("DELETE FROM oauth_states WHERE expires_at<now(); DELETE FROM devices WHERE expires_at<now(); DELETE FROM sessions WHERE expires_at<now(); UPDATE usage SET status='failed' WHERE status='pending' AND created_at<now()-interval '70 seconds'").catch(()=>console.error('ARType cleanup failed')),60000).unref();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(cleanup);server.close(async()=>{await pool.end();process.exit(0)});setTimeout(()=>process.exit(1),60000).unref()});

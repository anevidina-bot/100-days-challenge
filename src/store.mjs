import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { newState } from './domain.mjs';
export function openStore(directory) {
  mkdirSync(directory,{recursive:true}); const db=new DatabaseSync(join(directory,'challenge.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS preferences(user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL,revision INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS goal_versions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS daily_entries(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS body_entries(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS awards(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS edit_history(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workout_schedules(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,challenge_id TEXT NOT NULL,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workout_moves(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,challenge_id TEXT NOT NULL,json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workout_results(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,scheduled INTEGER NOT NULL,result TEXT);
  CREATE TABLE IF NOT EXISTS sync_operations(user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,id));
  CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS login_codes(email TEXT PRIMARY KEY,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL,sent INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications(user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,event TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,event));
  CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
  PRAGMA user_version=1;`);
  const collections={challenges:'challenges',goals:'goal_versions',days:'daily_entries',body:'body_entries',awards:'awards',audit:'edit_history',photos:'photos',subscriptions:'push_subscriptions'};
  function load(uid) { const s=newState();const p=db.prepare('SELECT json FROM profiles WHERE user_id=?').get(uid);if(p)s.profile=JSON.parse(p.json);const prefs=db.prepare('SELECT json,revision FROM preferences WHERE user_id=?').get(uid);if(prefs){s.settings=JSON.parse(prefs.json);s.revision=prefs.revision;}for(const [k,t]of Object.entries(collections))s[k]=db.prepare(`SELECT json FROM ${t} WHERE user_id=? ORDER BY rowid`).all(uid).map(x=>JSON.parse(x.json));
    const schedules=db.prepare('SELECT challenge_id,json FROM workout_schedules WHERE user_id=? ORDER BY rowid').all(uid),moves=db.prepare('SELECT challenge_id,json FROM workout_moves WHERE user_id=? ORDER BY rowid').all(uid),results=db.prepare('SELECT * FROM workout_results WHERE user_id=?').all(uid);
    for(const c of s.challenges){c.scheduleVersions=schedules.filter(x=>x.challenge_id===c.id).map(x=>JSON.parse(x.json));c.moves=moves.filter(x=>x.challenge_id===c.id).map(x=>JSON.parse(x.json));}
    for(const d of s.days){const r=results.find(x=>x.id===d.id);if(r){d.workout=!!r.scheduled;d.workoutResult=r.result;}}
    return s; }
  function save(uid,s) {db.prepare('INSERT OR REPLACE INTO profiles VALUES (?,?)').run(uid,JSON.stringify(s.profile));db.prepare('INSERT OR REPLACE INTO preferences VALUES (?,?,?)').run(uid,JSON.stringify(s.settings),s.revision);for(const[k,t]of Object.entries(collections)){db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);const q=db.prepare(`INSERT INTO ${t} VALUES (?,?,?)`);for(const x of s[k]){const saved={...x};if(k==='challenges'){delete saved.scheduleVersions;delete saved.moves;}if(k==='days'){delete saved.workout;delete saved.workoutResult;}q.run(x.id,uid,JSON.stringify(saved));}}
    for(const t of ['workout_schedules','workout_moves','workout_results'])db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(uid);
    for(const c of s.challenges){for(const [i,v]of(c.scheduleVersions??[]).entries())db.prepare('INSERT INTO workout_schedules VALUES (?,?,?,?)').run(c.id+':'+i,uid,c.id,JSON.stringify(v));for(const v of c.moves??[])db.prepare('INSERT INTO workout_moves VALUES (?,?,?,?)').run(v.id,uid,c.id,JSON.stringify(v));}
    for(const d of s.days)db.prepare('INSERT INTO workout_results VALUES (?,?,?,?)').run(d.id,uid,d.workout?1:0,d.workoutResult??null);
  }
  function transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
  return {db,load,save,transaction,close:()=>db.close()};
}

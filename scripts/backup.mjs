import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, writeFile, readdir, rm } from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.env.DATA_DIR??join(root,'data')),dest=resolve(process.env.BACKUP_DIR??join(root,'backups'));
// The backup root must be distinct and outside the live data directory.
if(!relative(source,dest)||(!relative(source,dest).startsWith('..')&&!resolve(dest).startsWith('..')))throw new Error('BACKUP_DIR must be outside DATA_DIR');
await mkdir(dest,{recursive:true});const name='backup-'+new Date().toISOString().replaceAll(':','-'),folder=join(dest,name);await mkdir(join(folder,'photos'),{recursive:true});
const live=new DatabaseSync(join(source,'challenge.sqlite'),{readOnly:true});await backup(live,join(folder,'challenge.sqlite'));live.close();
const snapshot=new DatabaseSync(join(folder,'challenge.sqlite'));
// Do not restore sessions or active one-time codes from a backup.
snapshot.exec('DELETE FROM sessions; DELETE FROM login_codes; DELETE FROM rate_limits;');
const photos=snapshot.prepare('SELECT id FROM photos').all();
try{for(const {id}of photos){if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid photo identifier');await copyFile(join(source,'photos',id),join(folder,'photos',id));}if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Invalid backup');snapshot.close();await writeFile(join(folder,'manifest.json'),JSON.stringify({version:1,created:new Date().toISOString(),photoCount:photos.length,retentionDays:30},null,2));}
catch(e){try{snapshot.close();}catch{}await rm(folder,{recursive:true,force:true});throw e;}
// Rotate only the explicitly validated direct backup children of this root.
for(const item of await readdir(dest,{withFileTypes:true})){if(!item.isDirectory()||!/^backup-\d{4}-\d{2}-\d{2}T[\d.-]+Z$/.test(item.name))continue;const candidate=resolve(dest,item.name);if(dirname(candidate)!==dest)throw new Error('Backup path escaped root');let meta;try{meta=JSON.parse(await (await import('node:fs/promises')).readFile(join(candidate,'manifest.json'),'utf8'));}catch{continue;}if(Date.now()-Date.parse(meta.created)>30*86400000)await rm(candidate,{recursive:true,force:true});}
console.log(folder);

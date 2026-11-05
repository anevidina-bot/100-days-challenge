// Separate, explicitly local trial. No email credentials or demonstration health data.
import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.LOCAL_TRIAL='1';process.env.NODE_ENV='development';process.env.HOST='127.0.0.1';process.env.PORT='8788';process.env.APP_ORIGIN='http://localhost:8788';process.env.COOKIE_SECURE='false';process.env.DATA_DIR=process.env.TRIAL_DATA_DIR??resolve(root,'data-local-trial');
for(const key of ['RESEND_API_KEY','EMAIL_FROM','AUTH_SECRET','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'])delete process.env[key];
await import('../src/server.mjs');

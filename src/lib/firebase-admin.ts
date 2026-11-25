import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function loadFirebaseProjectId(): string | undefined {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
      return raw.projectId;
    }
  } catch (err) {
    console.warn('Could not read firebase-applet-config.json:', err);
  }
  return undefined;
}

if (!getApps().length) {
  const projectId = loadFirebaseProjectId();
  initializeApp(projectId ? { projectId } : undefined);
}

export const adminAuth = getAuth();


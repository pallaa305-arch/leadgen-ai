import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';
import { config } from './config';

const adminApp =
  getApps()[0] ||
  initializeApp(
    config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey
      ? {
          credential: cert({
            projectId: config.firebaseProjectId,
            clientEmail: config.firebaseClientEmail,
            privateKey: config.firebasePrivateKey,
          }),
          projectId: firebaseAppletConfig.projectId,
        }
      : {
          projectId: firebaseAppletConfig.projectId,
        }
  );

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp, firebaseAppletConfig.firestoreDatabaseId);
adminDb.settings({ ignoreUndefinedProperties: true });
export { FieldValue };

export function leadDoc(uid: string, leadId: string) {
  return adminDb.doc(`users/${uid}/leads/${leadId}`);
}

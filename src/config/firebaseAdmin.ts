import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import path from "path";


// ✅ Path of service account file in backend root
const serviceAccountPath = path.join(
  process.cwd(),
  "firebase-service-account.json"
);

// ✅ Initialize Firebase only once
if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

// ✅ Export messaging instance
export const firebaseMessaging = getMessaging();
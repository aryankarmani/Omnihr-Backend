import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import path from "path";
import fs from "fs";

// ✅ Helper to get Firebase credentials
const getCredentials = () => {
  // 1. Single environment variable containing the entire JSON string
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (serviceAccount.private_key) {
        // Fix for newlines in private key
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
      return cert(serviceAccount);
    } catch (error) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON environment variable:", error);
    }
  }

  // 2. Individual environment variables (alternative approach)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });
  }

  // 3. Fallback to local file for local development
  const serviceAccountPath = path.join(process.cwd(), "firebase-service-account.json");
  if (fs.existsSync(serviceAccountPath)) {
    return cert(serviceAccountPath);
  }

  throw new Error(
    "Firebase Admin credentials not found. Please set either FIREBASE_SERVICE_ACCOUNT_JSON or individual env variables in Vercel, or ensure firebase-service-account.json is present locally."
  );
};

// ✅ Initialize Firebase only once
if (!getApps().length) {
  initializeApp({
    credential: getCredentials(),
  });
}

// ✅ Export messaging instance
export const firebaseMessaging = getMessaging();
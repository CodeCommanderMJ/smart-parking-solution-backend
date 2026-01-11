// =======================
// SmartPark Backend - Firebase Functions
// Hackathon-ready, full backend
// =======================

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// -------------------
// Health Check
// -------------------
exports.backendStatus = functions.https.onRequest((req, res) => {
  res.status(200).send("SmartPark Backend is LIVE 🚗🔥");
});

// -------------------
// Secure Check-In
// -------------------
exports.secureCheckIn = functions.https.onCall(async (data, context) => {
  const { uid, lotId } = data;

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in");
  }

  const lotRef = db.collection("parkingLots").doc(lotId);

  await db.runTransaction(async (tx) => {
    const lotSnap = await tx.get(lotRef);
    if (!lotSnap.exists) throw new functions.https.HttpsError("not-found", "Parking lot not found");

    if (lotSnap.data().currentOccupancy >= lotSnap.data().maxCapacity) {
      throw new functions.https.HttpsError("resource-exhausted", "Parking Full");
    }

    const sessionRef = db.collection("sessions").doc();
    tx.set(sessionRef, {
      uid,
      lotId,
      status: "ACTIVE",
      checkInTime: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(lotRef, {
      currentOccupancy: admin.firestore.FieldValue.increment(1),
    });

    const logRef = db.collection("auditLogs").doc();
    tx.set(logRef, {
      action: "CHECK_IN",
      user: uid,
      lotId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});

// -------------------
// Secure Check-Out
// -------------------
exports.secureCheckOut = functions.https.onCall(async (data, context) => {
  const { sessionId } = data;

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in");
  }

  const sessionRef = db.collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists || sessionSnap.data().status !== "ACTIVE") {
    throw new functions.https.HttpsError("failed-precondition", "Invalid session");
  }

  const lotRef = db.collection("parkingLots").doc(sessionSnap.data().lotId);

  await db.runTransaction(async (tx) => {
    tx.update(sessionRef, {
      status: "COMPLETED",
      checkOutTime: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(lotRef, {
      currentOccupancy: admin.firestore.FieldValue.increment(-1),
    });

    const logRef = db.collection("auditLogs").doc();
    tx.set(logRef, {
      action: "CHECK_OUT",
      user: context.auth.uid,
      lotId: lotRef.id,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});

// -------------------
// Generate QR Token
// -------------------
const crypto = require('crypto');
exports.generateQR = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in");
  }

  const token = crypto.randomUUID();
  await db.collection("qrTokens").doc(token).set({
    uid: context.auth.uid,
    expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes validity
    used: false
  });

  return { token };
});

// -------------------
// Validate QR Token
// -------------------
exports.validateQR = functions.https.onCall(async (data, context) => {
  const { token } = data;

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be logged in");
  }

  const qrDoc = await db.collection("qrTokens").doc(token).get();
  if (!qrDoc.exists || qrDoc.data().used || qrDoc.data().expiresAt < Date.now()) {
    throw new functions.https.HttpsError("failed-precondition", "Invalid QR");
  }

  await qrDoc.ref.update({ used: true });
  return { uid: qrDoc.data().uid };
});

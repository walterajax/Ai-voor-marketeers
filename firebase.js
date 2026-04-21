// ============================================================
//  STAP 1: Maak een Firebase project op https://console.firebase.google.com
//  STAP 2: Activeer "Realtime Database" (kies testmodus, 30 dagen open)
//  STAP 3: Ga naar Project Settings > Your apps > Add app (Web)
//  STAP 4: Kopieer de config hieronder en vervang de placeholder waarden
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCcl_n3mQ3ko954GG3DBTq6xrtaj5AKoVA",
  authDomain:        "ai-voor-marketeers.firebaseapp.com",
  databaseURL:       "https://ai-voor-marketeers-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "ai-voor-marketeers",
  storageBucket:     "ai-voor-marketeers.firebasestorage.app",
  messagingSenderId: "866201048891",
  appId:             "1:866201048891:web:c7edfbd12259089eda491e"
};

let db = null;

function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    return true;
  } catch (e) {
    console.error("Firebase init error:", e);
    return false;
  }
}

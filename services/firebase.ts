import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// User provided configuration
const firebaseConfig = {
  apiKey: "AIzaSyAElz3qZKex4RFzcLF-cDVGi8RJmoFzpXI",
  authDomain: "jk-chat1.firebaseapp.com",
  databaseURL: "https://jk-chat1-default-rtdb.firebaseio.com",
  projectId: "jk-chat1",
  storageBucket: "jk-chat1.firebasestorage.app",
  messagingSenderId: "383710668286",
  appId: "1:383710668286:web:329e1615c315ce1a880caf"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable Offline Persistence for "Fast" & "Low Internet" usage
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == 'failed-precondition') {
      console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
  } else if (err.code == 'unimplemented') {
      console.warn('The current browser does not support all of the features required to enable persistence');
  }
});

export const storage = getStorage(app);

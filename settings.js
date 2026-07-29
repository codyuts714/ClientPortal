/* ═══════════════════════════════════════════════════════════════
   UTS CLIENT OS — centralized configuration (Phase 1, Step 6)
   Moved out of index.html so environment/version changes don't require
   editing the main app file. Loaded as a plain (non-module) <script>
   before the main app script, so these are ordinary globals — same as
   when they lived inline.

   NOTE: the Firebase apiKey below is not a secret — Firebase client
   apps are secured by Firestore security rules, not by hiding this
   key. See docs/known-issues.md for the full explanation. Moving it
   here is about maintainability, not secrecy.
   ═══════════════════════════════════════════════════════════════ */

const APP_VERSION = "1.1.0-stabilization";

const CFG = {
  apiKey:            "AIzaSyARSyOP-sfro2C24vsuzRsMpg8KDHLXOgI",
  authDomain:        "uts-studio-brain.firebaseapp.com",
  projectId:         "uts-studio-brain",
  storageBucket:     "uts-studio-brain.firebasestorage.app",
  messagingSenderId: "428521283913",
  appId:             "1:428521283913:web:4b890d0af456cfe686ba98",
  measurementId:     "G-S3KBLZZVJZ"
};

/* Feature flags — placeholders for future phases. All false/inert today;
   flipping one on is meant to be the single switch a future phase needs,
   rather than hunting through index.html. Not read anywhere yet. */
const FEATURES = {
  mediaIngest: false,
  premiereXmlGeneration: false,
  driveAutomation: false,
  studioHealth: false  // Studio Health / Client Intelligence layer — see docs/studio-health/
};

/**
 * UTS Client OS — Plaid backend (Firebase Cloud Functions, 2nd gen)
 *
 * Holds your Plaid secret + each bank's access token server-side (never in the browser).
 * The app calls these; the app never sees an access token.
 *
 * Firestore layout this writes:
 *   plaid_items/{item_id}     access_token + sync cursor   (SERVER ONLY — rules deny all client access)
 *   bank_accounts/{acct_id}   name, mask, type, item_id    (owner-readable; app adds a "bucket" tag)
 *   bank_txns/{txn_id}        raw transaction from Plaid   (owner-readable; app adds bucket/override)
 *   bank_recurring/{stream}   Plaid's recurring streams    (owner-readable)
 *
 * Setup:
 *   1) cd functions && npm install
 *   2) Set secrets:  firebase functions:secrets:set PLAID_CLIENT_ID
 *                    firebase functions:secrets:set PLAID_SECRET
 *   3) Set env in .env or as params:  PLAID_ENV = sandbox   (switch to "production" when ready)
 *   4) firebase deploy --only functions
 *   5) Copy the deployed plaidWebhook URL into PLAID_WEBHOOK below (or set as env) and redeploy.
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Configuration, PlaidApi, PlaidEnvironments } = require("plaid");

admin.initializeApp();
const db = admin.firestore();

const PLAID_CLIENT_ID = defineSecret("PLAID_CLIENT_ID");
const PLAID_SECRET = defineSecret("PLAID_SECRET");
const PLAID_ENV = process.env.PLAID_ENV || "sandbox";           // "sandbox" | "production"
const PLAID_WEBHOOK = process.env.PLAID_WEBHOOK || "";           // paste deployed plaidWebhook URL

function plaid() {
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: { headers: {
      "PLAID-CLIENT-ID": PLAID_CLIENT_ID.value(),
      "PLAID-SECRET": PLAID_SECRET.value(),
    } },
  }));
}

// only the studio owner may touch banking
async function assertOwner(request) {
  const email = (request.auth && request.auth.token && request.auth.token.email || "").toLowerCase();
  if (!email) throw new HttpsError("unauthenticated", "Sign in first.");
  const snap = await db.doc("users/" + email).get();
  if (!snap.exists || snap.data().role !== "owner")
    throw new HttpsError("permission-denied", "Owner only.");
  return email;
}

const secrets = [PLAID_CLIENT_ID, PLAID_SECRET];

/* 1) create a Link token — the app opens Plaid Link with this */
exports.plaidCreateLinkToken = onCall({ secrets }, async (request) => {
  const email = await assertOwner(request);
  const res = await plaid().linkTokenCreate({
    user: { client_user_id: email },
    client_name: "Under The Sun Studios",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
    ...(PLAID_WEBHOOK ? { webhook: PLAID_WEBHOOK } : {}),
    transactions: { days_requested: 730 },
  });
  return { link_token: res.data.link_token };
});

/* 2) exchange the public_token Link returns → store access_token, pull accounts, first sync */
exports.plaidExchange = onCall({ secrets }, async (request) => {
  await assertOwner(request);
  const publicToken = request.data && request.data.public_token;
  const institution = (request.data && request.data.institution) || null;
  if (!publicToken) throw new HttpsError("invalid-argument", "Missing public_token.");

  const ex = await plaid().itemPublicTokenExchange({ public_token: publicToken });
  const access_token = ex.data.access_token;
  const item_id = ex.data.item_id;

  await db.doc("plaid_items/" + item_id).set({
    access_token, cursor: null, institution,
    createdAt: Date.now(),
  }, { merge: true });

  // accounts → each gets a default "personal" bucket the owner can flip to "business"
  const acct = await plaid().accountsGet({ access_token });
  const batch = db.batch();
  acct.data.accounts.forEach((a) => {
    batch.set(db.doc("bank_accounts/" + a.account_id), {
      item_id, name: a.name, official_name: a.official_name || null,
      mask: a.mask || null, type: a.type, subtype: a.subtype || null,
      balance_current: a.balances ? a.balances.current : null,
      balance_available: a.balances ? a.balances.available : null,
      institution, ts: Date.now(),
    }, { merge: true });
  });
  await batch.commit();

  await syncItem(item_id);
  await pullRecurring(item_id);
  return { ok: true, item_id };
});

/* 3) manual "refresh now" from the app — syncs every linked item */
exports.plaidSync = onCall({ secrets }, async (request) => {
  await assertOwner(request);
  const items = await db.collection("plaid_items").get();
  let added = 0;
  for (const doc of items.docs) { added += await syncItem(doc.id); await pullRecurring(doc.id); }
  return { ok: true, added };
});

/* 4) Plaid webhook — fires when new transactions are available (near-real-time) */
exports.plaidWebhook = onRequest({ secrets }, async (req, res) => {
  try {
    const { webhook_type, webhook_code, item_id } = req.body || {};
    if (webhook_type === "TRANSACTIONS" &&
        ["SYNC_UPDATES_AVAILABLE", "INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE"].includes(webhook_code)) {
      await syncItem(item_id);
      await pullRecurring(item_id);
    }
    res.status(200).send("ok");
  } catch (e) { console.error(e); res.status(200).send("ok"); } // 200 so Plaid doesn't retry-storm
});

/* ── helpers ── */

// cursor-based sync: handles added / modified / removed, upserts raw txns
async function syncItem(item_id) {
  const ref = db.doc("plaid_items/" + item_id);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const access_token = snap.data().access_token;
  let cursor = snap.data().cursor || null;
  let added = 0, hasMore = true;

  while (hasMore) {
    const r = await plaid().transactionsSync({ access_token, cursor: cursor || undefined });
    const d = r.data;
    const batch = db.batch();
    [...d.added, ...d.modified].forEach((t) => {
      batch.set(db.doc("bank_txns/" + t.transaction_id), {
        item_id, account_id: t.account_id,
        date: t.date, authorized_date: t.authorized_date || null,
        name: t.name, merchant_name: t.merchant_name || null,
        amount: t.amount, iso_currency_code: t.iso_currency_code || "USD",
        pending: !!t.pending,
        pfc_primary: t.personal_finance_category ? t.personal_finance_category.primary : null,
        pfc_detailed: t.personal_finance_category ? t.personal_finance_category.detailed : null,
        removed: false, ts: Date.now(),
      }, { merge: true });
      added++;
    });
    d.removed.forEach((t) => {
      batch.set(db.doc("bank_txns/" + t.transaction_id), { removed: true, ts: Date.now() }, { merge: true });
    });
    await batch.commit();
    cursor = d.next_cursor;
    hasMore = d.has_more;
    await ref.set({ cursor }, { merge: true });

    // keep balances fresh — the sync response carries current account balances
    if (Array.isArray(d.accounts) && d.accounts.length) {
      const b2 = db.batch();
      d.accounts.forEach((a) => {
        b2.set(db.doc("bank_accounts/" + a.account_id), {
          balance_current: a.balances ? a.balances.current : null,
          balance_available: a.balances ? a.balances.available : null,
          ts: Date.now(),
        }, { merge: true });
      });
      await b2.commit();
    }
  }
  return added;
}

// Plaid's own recurring-charge detection → your recurring schedule
async function pullRecurring(item_id) {
  const snap = await db.doc("plaid_items/" + item_id).get();
  if (!snap.exists) return;
  const access_token = snap.data().access_token;
  try {
    const r = await plaid().transactionsRecurringGet({ access_token });
    const streams = [...(r.data.inflow_streams || []).map(s => ({ ...s, flow: "inflow" })),
                     ...(r.data.outflow_streams || []).map(s => ({ ...s, flow: "outflow" }))];
    const batch = db.batch();
    streams.forEach((s) => {
      batch.set(db.doc("bank_recurring/" + s.stream_id), {
        item_id, account_id: s.account_id, flow: s.flow,
        description: s.description || null, merchant_name: s.merchant_name || null,
        average_amount: s.average_amount ? s.average_amount.amount : null,
        last_amount: s.last_amount ? s.last_amount.amount : null,
        frequency: s.frequency || null, status: s.status || null,
        last_date: s.last_date || null, predicted_next_date: s.predicted_next_date || null,
        is_active: s.is_active !== false, ts: Date.now(),
      }, { merge: true });
    });
    await batch.commit();
  } catch (e) { console.warn("recurring pull skipped:", e.message); }
}

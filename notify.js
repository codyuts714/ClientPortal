/**
 * UTS Client OS — SMS relay (Twilio Function)
 * Path: /notify   ·   Visibility: PUBLIC (the app calls it from the browser)
 *
 * Your app POSTs form-encoded fields: kind, to, body, token
 *   - client / editor alerts include `to` (that person's number)
 *   - "studio" alerts have no `to` → they go to your cell (STUDIO env var)
 *
 * Environment variables to set on the Service (Settings → Environment variables):
 *   TOKEN   = the exact same string you paste into the app's "Shared token" field
 *   FROM    = your Twilio number in E.164, e.g. +15625550123
 *   STUDIO  = your personal cell in E.164, e.g. +15625559999  (where studio alerts land)
 *
 * Also: Service → Settings → enable "ACCOUNT_SID and AUTH_TOKEN" so
 * context.getTwilioClient() can authenticate.
 */
exports.handler = function (context, event, callback) {
  const res = new Twilio.Response();
  res.appendHeader("Access-Control-Allow-Origin", "*");
  res.appendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.appendHeader("Access-Control-Allow-Headers", "Content-Type");
  res.appendHeader("Content-Type", "application/json");

  // shared-secret gate — blocks random hits on the public URL
  if ((event.token || "") !== context.TOKEN) {
    res.setStatusCode(403);
    res.setBody({ ok: false, error: "bad token" });
    return callback(null, res);
  }

  const to = (event.to || context.STUDIO || "").trim(); // studio alerts fall back to your cell
  const body = (event.body || "").trim();

  if (!to || !body) {
    // nothing to send (e.g. a client with no number on file) — don't error the app
    res.setBody({ ok: false, error: "missing to/body — skipped" });
    return callback(null, res);
  }

  context
    .getTwilioClient()
    .messages.create({ to: to, from: context.FROM, body: body })
    .then((msg) => {
      res.setBody({ ok: true, sid: msg.sid });
      callback(null, res);
    })
    .catch((err) => {
      // keep 200 so the app's fire-and-forget call doesn't throw; details go to Twilio logs
      res.setBody({ ok: false, error: err.message });
      callback(null, res);
    });
};

/* UTS CLIENT OS — Twilio Function
   Twilio Console → Functions & Assets → Services → Create Service "uts-sms"
   Add a Function at path  /notify  → set it to PUBLIC → paste this → Deploy.

   Environment Variables (same screen, "Environment Variables" tab):
     STUDIO = +15625550123      ← your cell, the one that gets everything
     FROM   = +15625550100      ← your Twilio number
     TOKEN  = any-random-string ← must match the token in the portal's Alerts panel

   The portal never sends your number over the wire. kind:"studio" is routed
   here to STUDIO; only editor/client alerts carry a "to".
*/
exports.handler = function (context, event, callback) {
  const res = new Twilio.Response();
  res.appendHeader("Access-Control-Allow-Origin", "*");
  res.appendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.appendHeader("Access-Control-Allow-Headers", "Content-Type");
  res.appendHeader("Content-Type", "application/json");

  if (event.token !== context.TOKEN) {
    res.setStatusCode(403);
    res.setBody({ error: "bad token" });
    return callback(null, res);
  }

  const to = event.kind === "studio" ? context.STUDIO : event.to;
  const body = String(event.body || "").slice(0, 600);

  if (!to || !body) {
    res.setStatusCode(400);
    res.setBody({ error: "missing to/body" });
    return callback(null, res);
  }

  context
    .getTwilioClient()
    .messages.create({ to, from: context.FROM, body })
    .then(function (m) {
      res.setBody({ ok: true, sid: m.sid });
      callback(null, res);
    })
    .catch(function (err) {
      res.setStatusCode(500);
      res.setBody({ error: err.message });
      callback(null, res);
    });
};

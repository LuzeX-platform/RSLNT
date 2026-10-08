import { test } from "node:test";
import assert from "node:assert/strict";
import { appUrl, mailWaarschuwingen } from "../src/mailer.js";

function metOmgeving(waarden: Record<string, string | undefined>, f: () => void) {
  const oud = Object.fromEntries(Object.keys(waarden).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(waarden)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    f();
  } finally {
    for (const [k, v] of Object.entries(oud)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test("links in mails: APP_URL, anders het Render-adres, nooit localhost op Render", () => {
  metOmgeving({ APP_URL: "https://rslnt.luzex.nl/", RENDER_EXTERNAL_URL: "https://luzex-rslnt.onrender.com" }, () =>
    assert.equal(appUrl(), "https://rslnt.luzex.nl"),
  );
  metOmgeving({ APP_URL: undefined, RENDER_EXTERNAL_URL: "https://luzex-rslnt.onrender.com" }, () =>
    assert.equal(appUrl(), "https://luzex-rslnt.onrender.com"),
  );
  // Een lege waarde in Render telt als niet ingevuld.
  metOmgeving({ APP_URL: "", RENDER_EXTERNAL_URL: "https://luzex-rslnt.onrender.com" }, () =>
    assert.equal(appUrl(), "https://luzex-rslnt.onrender.com"),
  );
  metOmgeving({ APP_URL: undefined, RENDER_EXTERNAL_URL: undefined, PORT: "4200" }, () => assert.equal(appUrl(), "http://localhost:4200"));
});

test("waarschuwing bij het starten als mail niet kan werken (alleen in productie)", () => {
  metOmgeving({ NODE_ENV: "production", SMTP_HOST: undefined, APP_URL: undefined, RENDER_EXTERNAL_URL: "https://x.onrender.com" }, () => {
    const m = mailWaarschuwingen();
    assert.equal(m.length, 2);
    assert.match(m[0], /SMTP_HOST ontbreekt/);
    assert.match(m[1], /https:\/\/x\.onrender\.com/);
  });
  metOmgeving({ NODE_ENV: "production", SMTP_HOST: "smtp.eu.mailgun.org", APP_URL: "https://rslnt.luzex.nl" }, () =>
    assert.deepEqual(mailWaarschuwingen(), []),
  );
  metOmgeving({ NODE_ENV: "development", SMTP_HOST: undefined }, () => assert.deepEqual(mailWaarschuwingen(), []));
});

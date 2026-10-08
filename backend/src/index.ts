import "dotenv/config";
import { bouwApp } from "./app.js";
import { mailWaarschuwingen } from "./mailer.js";

const PORT = Number(process.env.PORT ?? 4200);
const app = await bouwApp();

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`LuzeX RSLNT draait op ${address}`);
  for (const melding of mailWaarschuwingen()) app.log.warn(melding);
});

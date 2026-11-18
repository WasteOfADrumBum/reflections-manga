/**
 * Creates ADMIN_PASSWORD_HASH for the studio sign-in.
 *   npm run hash-password
 * Type the password when asked (it is not echoed or stored). Paste the printed
 * value into the Vercel project's environment variables.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { hashPassword } from "../api/_lib/auth/auth.js";

const muted = new Writable({ write: (_c, _e, cb) => cb() });
const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
process.stdout.write("Studio password (at least 12 characters): ");
rl.question("", async (pw) => {
  rl.close();
  process.stdout.write("\n");
  try {
    console.log(await hashPassword(pw.trim()));
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
});

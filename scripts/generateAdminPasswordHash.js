import { hashPassword, isValidPassword } from "../src/auth/passwords.js";
import { StringDecoder } from "node:string_decoder";

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  console.error("Run this command in an interactive terminal.");
  process.exitCode = 1;
} else {
  const input = process.stdin;
  const decoder = new StringDecoder("utf8");
  let password = "";
  let finished = false;

  const finish = async () => {
    if (finished) return;
    finished = true;
    input.setRawMode(false);
    input.pause();
    process.stdout.write("\n");

    if (!isValidPassword(password)) {
      console.error("Use a password of at least 12 characters and at most 72 UTF-8 bytes.");
      process.exitCode = 1;
      return;
    }

    console.log(await hashPassword(password));
  };

  process.stdout.write("Enter admin password (input hidden): ");
  input.setRawMode(true);
  input.resume();
  input.on("data", async (chunk) => {
    for (const character of decoder.write(chunk)) {
      if (character === "\u0003") {
        input.setRawMode(false);
        process.stdout.write("\nCancelled.\n");
        process.exitCode = 1;
        return;
      }
      if (character === "\r" || character === "\n") {
        await finish();
        return;
      }
      if (character === "\u007f" || character === "\b") {
        password = Array.from(password).slice(0, -1).join("");
      } else if (character >= " ") {
        password += character;
      }
    }
  });
}

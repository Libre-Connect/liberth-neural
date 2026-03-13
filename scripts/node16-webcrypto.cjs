const { webcrypto } = require("node:crypto");
const cryptoModule = require("node:crypto");

if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

if (
  typeof cryptoModule.getRandomValues !== "function"
  && typeof cryptoModule.webcrypto?.getRandomValues === "function"
) {
  cryptoModule.getRandomValues = cryptoModule.webcrypto.getRandomValues.bind(
    cryptoModule.webcrypto,
  );
}

if (
  typeof cryptoModule.randomUUID !== "function"
  && typeof cryptoModule.webcrypto?.randomUUID === "function"
) {
  cryptoModule.randomUUID = cryptoModule.webcrypto.randomUUID.bind(
    cryptoModule.webcrypto,
  );
}

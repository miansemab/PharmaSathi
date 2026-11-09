const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = 1;
const KEY_LENGTH = 64;

function createOfflineAuth({ app, safeStorage }) {
  const storagePath = path.join(
    app.getPath("userData"),
    "secure",
    "offline-auth.dat"
  );

  function readStore() {
    if (!fs.existsSync(storagePath)) return { version: VERSION, accounts: {} };

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure offline storage is unavailable on this device.");
    }

    const encrypted = fs.readFileSync(storagePath);
    const decrypted = safeStorage.decryptString(encrypted);
    const store = JSON.parse(decrypted);

    if (
      store.version !== VERSION ||
      !store.accounts ||
      typeof store.accounts !== "object"
    ) {
      throw new Error("Offline authentication data is invalid.");
    }

    return store;
  }

  function writeStore(store) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure offline storage is unavailable on this device.");
    }

    const directory = path.dirname(storagePath);
    fs.mkdirSync(directory, { recursive: true });

    const encrypted = safeStorage.encryptString(JSON.stringify(store));
    const temporaryPath = `${storagePath}.${crypto.randomUUID()}.tmp`;

    fs.writeFileSync(temporaryPath, encrypted, {
      mode: 0o600,
      flag: "wx",
    });

    fs.renameSync(temporaryPath, storagePath);
  }

  function validateUser(user) {
    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.name !== "string" ||
      typeof user.email !== "string" ||
      !Array.isArray(user.memberships)
    ) {
      throw new Error("Valid account and pharmacy membership data are required.");
    }

    const memberships = user.memberships.map((membership) => {
      const pharmacy = membership?.pharmacy;

      if (
        typeof pharmacy?.id !== "string" ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(pharmacy.id) ||
        typeof pharmacy.name !== "string" ||
        typeof pharmacy.slug !== "string" ||
        typeof membership.role !== "string"
      ) {
        throw new Error("Invalid pharmacy membership data.");
      }

      return {
        role: membership.role,
        pharmacy: {
          id: pharmacy.id,
          name: pharmacy.name,
          slug: pharmacy.slug,
        },
      };
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email.trim().toLowerCase(),
      memberships,
    };
  }

  function saveAccount({ email, password, user }) {
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 1024
    ) {
      throw new Error("Valid login credentials are required.");
    }

    const safeUser = validateUser(user);
    const normalizedEmail = email.trim().toLowerCase();

    if (safeUser.email !== normalizedEmail) {
      throw new Error("The account email does not match the login email.");
    }

    const salt = crypto.randomBytes(32);
    const verifier = crypto.scryptSync(password, salt, KEY_LENGTH);

    const store = readStore();

    store.lastEmail = normalizedEmail;

    store.accounts[normalizedEmail] = {
      user: safeUser,
      salt: salt.toString("base64"),
      verifier: verifier.toString("base64"),
      registeredPharmacies: store.accounts[normalizedEmail]
        ?.registeredPharmacies || [],
      updatedAt: new Date().toISOString(),
    };

    writeStore(store);

    return { success: true };
  }

  function authenticate({ email, password }) {
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 1024
    ) {
      return { success: false, message: "Invalid email or password." };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const store = readStore();
    const account = store.accounts[normalizedEmail];

    if (!account) {
      return {
        success: false,
        message: "No offline account is saved for this email. Connect to the internet and sign in first.",
      };
    }

    const salt = Buffer.from(account.salt, "base64");
    const expected = Buffer.from(account.verifier, "base64");
    const actual = crypto.scryptSync(password, salt, KEY_LENGTH);

    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return { success: false, message: "Invalid email or password." };
    }

    return {
      success: true,
      user: account.user,
      registeredPharmacies: account.registeredPharmacies || [],
    };
  }

  function getSession(email) {
    const store = readStore();
    const normalizedEmail = typeof email === "string" && email.trim()
      ? email.trim().toLowerCase()
      : store.lastEmail;
    if (!normalizedEmail) return { success: false };
    const account = store.accounts[normalizedEmail];

    if (!account) return { success: false };

    return {
      success: true,
      user: account.user,
      registeredPharmacies: account.registeredPharmacies || [],
    };
  }

  function markPharmacyRegistered(email, pharmacyId) {
    if (
      typeof email !== "string" ||
      typeof pharmacyId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(pharmacyId)
    ) {
      throw new Error("Valid account and pharmacy are required.");
    }

    const store = readStore();
    const account = store.accounts[email.trim().toLowerCase()];

    if (!account) {
      throw new Error("No saved offline account exists for this user.");
    }

    const isMember = account.user.memberships.some(
      (membership) => membership.pharmacy.id === pharmacyId
    );

    if (!isMember) {
      throw new Error("This pharmacy does not belong to the saved account.");
    }

    const registered = new Set(account.registeredPharmacies || []);
    registered.add(pharmacyId);
    account.registeredPharmacies = [...registered];

    writeStore(store);
    return { success: true };
  }

  return {
    saveAccount,
    authenticate,
    getSession,
    getLastSession: () => getSession(),
    markPharmacyRegistered,
  };
}

module.exports = { createOfflineAuth };

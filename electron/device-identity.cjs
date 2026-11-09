const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function getDeviceIdentity(userDataPath, pharmacyId) {
  if (
    typeof pharmacyId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(pharmacyId)
  ) {
    throw new Error("A valid pharmacy ID is required for device identity.");
  }

  const identityDirectory = path.join(userDataPath, "device-identities");
  const identityPath = path.join(identityDirectory, `${pharmacyId}.json`);

  fs.mkdirSync(identityDirectory, { recursive: true });

  if (fs.existsSync(identityPath)) {
    const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));

    if (
      typeof identity.deviceCode !== "string" ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(identity.deviceCode) ||
      typeof identity.deviceName !== "string"
    ) {
      throw new Error(
        "Saved pharmacy device identity is invalid. It was not overwritten."
      );
    }

    return identity;
  }

  const identity = {
    deviceCode: crypto.randomUUID().replace(/-/g, ""),
    deviceName: "PharmaSathi Desktop",
  };

  const temporaryPath = `${identityPath}.${crypto.randomUUID()}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(identity, null, 2),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );

  fs.renameSync(temporaryPath, identityPath);

  return identity;
}

module.exports = { getDeviceIdentity };

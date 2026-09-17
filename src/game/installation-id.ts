export const INSTALLATION_ID_STORAGE_KEY = "factory2d.installation-id";

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isInstallationId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && INSTALLATION_ID_PATTERN.test(value);
}

export function getInstallationId(storage: Pick<Storage, "getItem" | "setItem">): string {
  const storedId = storage.getItem(INSTALLATION_ID_STORAGE_KEY);
  if (storedId !== null) {
    if (!isInstallationId(storedId)) {
      throw new Error("Stored installation ID is not a valid UUID");
    }
    return storedId;
  }

  const installationId = crypto.randomUUID();
  storage.setItem(INSTALLATION_ID_STORAGE_KEY, installationId);
  return installationId;
}

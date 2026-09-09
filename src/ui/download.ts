/** Saves a blob through a transient anchor, as browsers require a user gesture to download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const download = document.createElement("a");
  download.href = objectUrl;
  download.download = filename;
  document.body.append(download);
  download.click();
  download.remove();
  URL.revokeObjectURL(objectUrl);
}

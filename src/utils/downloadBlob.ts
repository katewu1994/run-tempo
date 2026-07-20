const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const container = document.body ?? document.documentElement;

  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  container.append(anchor);
  anchor.click();
  anchor.remove();

  // Delay revoke so browsers have time to start the file download.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, DOWNLOAD_URL_REVOKE_DELAY_MS);
}
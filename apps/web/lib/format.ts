const byteFormatter = new Intl.NumberFormat("en-GB");

export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(2)}\u00A0MiB`;
}

export function formatBytesExact(bytes: number): string {
  return `${byteFormatter.format(bytes)}\u00A0bytes`;
}

export function formatBytesShort(bytes: number): string {
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(bytes)}\u00A0bytes`;
}

export function formatSeconds(seconds: number, fractionDigits = 2): string {
  return `${seconds.toFixed(fractionDigits)}\u00A0s`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

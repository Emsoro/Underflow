import { invoke } from '@tauri-apps/api/core';

/** Save flowchart JSON data to a file path */
export async function saveFlowchart(path: string, data: string): Promise<void> {
  await invoke('save_flowchart', { path, data });
}

/** Load flowchart JSON data from a file path */
export async function loadFlowchart(path: string): Promise<string> {
  return await invoke<string>('load_flowchart', { path });
}

/** Open a native save file dialog, returns selected path or null */
export async function saveFileDialog(defaultName: string): Promise<string | null> {
  const result = await invoke<string | null>('save_file_dialog', { defaultName });
  return result;
}

/** Open a native open file dialog, returns selected path or null */
export async function openFileDialog(): Promise<string | null> {
  const result = await invoke<string | null>('open_file_dialog');
  return result;
}

/** Open a native save dialog for images, returns selected path or null */
export async function saveImageDialog(defaultName: string, filterName: string, extensions: string[]): Promise<string | null> {
  const result = await invoke<string | null>('save_image_dialog', { defaultName, filterName, extensions });
  return result;
}

/** Save binary data (base64 encoded) to a file path */
export async function saveBinaryFile(path: string, base64Data: string): Promise<void> {
  await invoke('save_binary_file', { path, base64Data });
}

/** Save text content to a file path */
export async function saveTextFile(path: string, content: string): Promise<void> {
  await invoke('save_text_file', { path, content });
}

/** Check if running inside Tauri */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

// ---------- License Registration API ----------

export interface LicenseInfo {
  hardware_id: string;
  apply_timestamp: number;
  product_name: string;
  expiry_timestamp: number;
}

export interface LicenseStatus {
  is_registered: boolean;
  expiry_timestamp: number | null;
  days_remaining: number | null;
  product_name: string | null;
  machine_id: string;
}

/** Get machine ID (from Windows registry MachineId) */
export async function getMachineId(): Promise<string> {
  return await invoke<string>('get_machine_id');
}

/** Get apply code (machineId + timestamp, base64 encoded) */
export async function getApplyCode(): Promise<string> {
  return await invoke<string>('get_apply_code');
}

/** Get NTP time (for Tauri) - returns Unix timestamp */
export async function getNtpTime(): Promise<number> {
  return await invoke<number>('get_ntp_time');
}

/** Verify a license code */
export async function verifyLicenseCode(licenseCode: string): Promise<LicenseInfo> {
  return await invoke<LicenseInfo>('verify_license_code', { licenseCode });
}

/** Save and activate a license */
export async function saveLicense(licenseCode: string): Promise<void> {
  await invoke('save_license', { licenseCode });
}

/** Get current license status */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  return await invoke<LicenseStatus>('get_license_status');
}

/** Reset/remove current license */
export async function resetLicense(): Promise<void> {
  await invoke('reset_license');
}

/** Open URL in default system browser */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke('open_url', { url });
}

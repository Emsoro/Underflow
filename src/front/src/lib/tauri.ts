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
export async function saveFileDialog(): Promise<string | null> {
  const result = await invoke<string | null>('save_file_dialog');
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

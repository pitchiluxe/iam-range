import { requestApp } from './appLauncher';

export const LOAD_TEXT_FILE_EVENT = 'iam-load-text-file';
export interface TextFile { path: string; content: string }
let pending: TextFile | null = null;

export function openTextFile(path: string, content: string): void {
  pending = { path, content };
  document.dispatchEvent(new CustomEvent<TextFile>(LOAD_TEXT_FILE_EVENT, { detail: pending }));
  requestApp('notepad');
}

export function takePendingTextFile(): TextFile | null {
  const file = pending;
  pending = null;
  return file;
}

/**
 * util/profilePictures.ts — the photo on the sign-in screen.
 *
 * Windows shows a picture where a person has set one and their initial where
 * they have not. Same here, and for the same reason: the sign-in screen is
 * where you confirm you are about to sign in as the right person, and a face
 * does that faster than a letter — especially on a workstation where switching
 * accounts is a routine diagnostic step.
 *
 * Stored per browser as a data URI, keyed by logon name. It never leaves the
 * machine, is never sent anywhere, and is not part of the directory: a photo
 * is a local convenience, not an identity attribute this simulation models.
 */

const KEY = 'profile_pictures';
const CHANGE_EVENT = 'apex-profile-pictures-changed';

/** Longest side of the stored image. Enough for the 104px avatar at 2x, and
 *  small enough that a handful of accounts cannot fill the storage quota. */
const MAX_EDGE = 256;

/** Refused above this, before decoding — a 40MB photograph should not become
 *  a 40MB decode attempt just to be rejected. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type Store = Record<string, string>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Store) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    return true;
  } catch {
    // Quota is the realistic failure. Say so rather than silently not saving.
    return false;
  }
}

/** The picture for a logon name, or null if they have not set one. */
export function getProfilePicture(username: string): string | null {
  return read()[username.toLowerCase()] ?? null;
}

export function setProfilePicture(username: string, dataUri: string): boolean {
  const store = read();
  store[username.toLowerCase()] = dataUri;
  return write(store);
}

export function clearProfilePicture(username: string): void {
  const store = read();
  delete store[username.toLowerCase()];
  write(store);
}

export function onProfilePicturesChanged(handler: () => void): () => void {
  document.addEventListener(CHANGE_EVENT, handler);
  return () => document.removeEventListener(CHANGE_EVENT, handler);
}

/**
 * Read an image file, square-crop it from the centre and shrink it.
 *
 * Done here rather than storing the original because localStorage holds a few
 * megabytes in total: one unscaled phone photograph would fill it and take the
 * desktop layout and saved documents down with it.
 */
export function readImageAsAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That is not an image file.'));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new Error('That image is larger than 8 MB. Choose a smaller one.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be decoded.'));
      img.onload = () => {
        // Centre square crop, so a portrait is not squashed into a circle.
        const edge = Math.min(img.width, img.height);
        const sx = (img.width - edge) / 2;
        const sy = (img.height - edge) / 2;
        const size = Math.min(edge, MAX_EDGE);

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not prepare the image.'));
          return;
        }
        ctx.drawImage(img, sx, sy, edge, edge, 0, 0, size, size);
        // JPEG rather than PNG: a photograph as PNG is several times larger
        // for no visible gain at this size.
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Paint an avatar element: the person's picture if they have one, their
 * initial if not.
 */
export function paintAvatar(el: HTMLElement, username: string, displayName: string): void {
  const picture = getProfilePicture(username);
  if (picture) {
    el.textContent = '';
    el.style.backgroundImage = `url("${picture}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.style.backgroundImage = '';
    el.textContent = (displayName || username).charAt(0).toUpperCase();
  }
}

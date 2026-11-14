/**
 * Image attachment upload. The server validates magic bytes and the declared type again, so this
 * side only gives the user a fast, readable rejection before a round trip.
 */
import { AssetUploadResponseSchema } from '../../../shared/api.ts';
import { apiSend } from '../../app/api.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export async function uploadImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.has(file.type)) {
    throw new Error('Only PNG, JPEG, GIF and WebP images can be attached.');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('Images must be 10 MiB or smaller.');
  }
  const dataBase64 = await readBase64(file);
  const { id } = await apiSend('POST', '/api/assets', { name: file.name, type: file.type, dataBase64 }, AssetUploadResponseSchema);
  return id;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the image.'));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

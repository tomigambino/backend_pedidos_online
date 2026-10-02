import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Valida el MIME declarado por el cliente, que es falseable: la inspección real por magic
 * bytes queda pendiente en PENDING.md. El conteo de archivos (1 en productos, 2 en tenants)
 * lo define cada interceptor, no este helper.
 */
export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
    cb(
      new BadRequestException(
        `Tipo de imagen no permitido: ${file.mimetype}. Permitidos: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
      ),
      false,
    );
    return;
  }
  cb(null, true);
}

export function imageUploadLimits(maxFiles: number): MulterOptions['limits'] {
  // busboy aborta en cuanto el tamaño alcanza el límite (multipart.js:476,
  // fileSize === fileSizeLimit), así que sin el +1 el tope real sería MAX_IMAGE_BYTES - 1
  // y un archivo de exactamente 5 MB sería rechazado.
  return { fileSize: MAX_IMAGE_BYTES + 1, files: maxFiles };
}

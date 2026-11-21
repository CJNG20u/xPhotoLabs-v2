import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import ffmpeg from 'fluent-ffmpeg';
import { config } from './config.ts';
import { db } from './db.ts';
import type { MediaRow } from './db.ts';
import { assertSafePathWithin, sanitizeFilename } from './security.ts';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.avif', '.tiff', '.tif', '.bmp',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi', '.3gp',
]);

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
};

export function classifyMediaExtension(filename: string): { mediaType: 'image' | 'video'; mimeType: string; ext: string } | null {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { mediaType: 'image', mimeType: MIME_BY_EXT[ext] || 'image/jpeg', ext };
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return { mediaType: 'video', mimeType: MIME_BY_EXT[ext] || 'video/mp4', ext };
  }
  return null;
}

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function formatShutterSpeed(exposureTime: number | undefined): string | null {
  if (!exposureTime || !Number.isFinite(exposureTime) || exposureTime <= 0) return null;
  if (exposureTime >= 1) return `${exposureTime.toFixed(1)}s`;
  const denom = Math.round(1 / exposureTime);
  return `1/${denom}s`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

interface ExtractedMeta {
  width: number;
  height: number;
  durationSec: number | null;
  takenAt: string;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: string | null;
  aperture: string | null;
  shutterSpeed: string | null;
  iso: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  dominantColor: string;
}

async function extractImageMetadata(filePath: string, fallbackMtime: Date): Promise<ExtractedMeta> {
  let width = 1600;
  let height = 1200;
  let dominantColor = '#1e293b';

  try {
    const img = sharp(filePath).rotate();
    const meta = await img.metadata();
    if (meta.width && meta.height) {
      width = meta.width;
      height = meta.height;
    }
    const stats = await img.stats();
    if (stats.dominant) {
      dominantColor = rgbToHex(stats.dominant.r, stats.dominant.g, stats.dominant.b);
    }
  } catch {
    // Keep defaults if format metadata cannot be parsed
  }

  let parsedExif: Record<string, unknown> | null = null;
  try {
    parsedExif = (await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      icc: false,
      iptc: false,
      xmp: false,
    })) as Record<string, unknown> | null;
  } catch {
    parsedExif = null;
  }

  let takenAt = fallbackMtime.toISOString();
  const rawDate = parsedExif?.DateTimeOriginal || parsedExif?.CreateDate || parsedExif?.ModifyDate;
  if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
    takenAt = rawDate.toISOString();
  }

  const focalNum = typeof parsedExif?.FocalLength === 'number' ? parsedExif.FocalLength : null;
  const fNum = typeof parsedExif?.FNumber === 'number' ? parsedExif.FNumber : null;
  const expNum = typeof parsedExif?.ExposureTime === 'number' ? parsedExif.ExposureTime : undefined;
  const isoNum = typeof parsedExif?.ISO === 'number' ? Math.round(parsedExif.ISO) : null;
  const lat = typeof parsedExif?.latitude === 'number' && Number.isFinite(parsedExif.latitude) ? parsedExif.latitude : null;
  const lng = typeof parsedExif?.longitude === 'number' && Number.isFinite(parsedExif.longitude) ? parsedExif.longitude : null;

  return {
    width,
    height,
    durationSec: null,
    takenAt,
    cameraMake: typeof parsedExif?.Make === 'string' ? parsedExif.Make.trim() : null,
    cameraModel: typeof parsedExif?.Model === 'string' ? parsedExif.Model.trim() : null,
    lensModel: typeof parsedExif?.LensModel === 'string' ? parsedExif.LensModel.trim() : null,
    focalLength: focalNum ? `${Math.round(focalNum)}mm` : null,
    aperture: fNum ? `f/${Number(fNum.toFixed(1))}` : null,
    shutterSpeed: formatShutterSpeed(expNum),
    iso: isoNum,
    gpsLat: lat,
    gpsLng: lng,
    dominantColor,
  };
}

function probeVideo(filePath: string): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function extractVideoPosterFrame(videoPath: string, outPngPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .screenshots({
        timestamps: ['10%'],
        filename: path.basename(outPngPath),
        folder: path.dirname(outPngPath),
      });
  });
}

async function generateWebpThumbsFromImage(sourceImagePath: string, sha256: string): Promise<{ thumb400: string; thumb1600: string; dominantColor?: string }> {
  const thumb400Path = path.join(config.thumbs400Dir, `${sha256}.webp`);
  const thumb1600Path = path.join(config.thumbs1600Dir, `${sha256}.webp`);

  const base = sharp(sourceImagePath).rotate();
  await Promise.all([
    base
      .clone()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toFile(thumb400Path),
    base
      .clone()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toFile(thumb1600Path),
  ]);

  let dominantColor: string | undefined;
  try {
    const stats = await sharp(thumb400Path).stats();
    if (stats.dominant) {
      dominantColor = rgbToHex(stats.dominant.r, stats.dominant.g, stats.dominant.b);
    }
  } catch {
    // Ignore color extraction failure
  }

  return { thumb400: thumb400Path, thumb1600: thumb1600Path, dominantColor };
}

export interface IngestOverrides {
  takenAt?: string;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  focalLength?: string | null;
  aperture?: string | null;
  shutterSpeed?: string | null;
  iso?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  locationName?: string | null;
  isFavorite?: boolean;
}

export interface IngestResult {
  media: MediaRow;
  duplicate: boolean;
}

const findByShaStmt = db.prepare('SELECT * FROM media WHERE sha256 = ?');
const findByPathStmt = db.prepare('SELECT * FROM media WHERE file_path = ?');
const insertMediaStmt = db.prepare(`
  INSERT INTO media (
    id, sha256, filename, source_type, mount_id, file_path, mime_type, media_type,
    size_bytes, width, height, duration_sec, taken_at, created_at,
    camera_make, camera_model, lens_model, focal_length, aperture, shutter_speed, iso,
    gps_lat, gps_lng, location_name, is_favorite, is_trashed, thumb_400, thumb_1600, dominant_color
  ) VALUES (
    @id, @sha256, @filename, @source_type, @mount_id, @file_path, @mime_type, @media_type,
    @size_bytes, @width, @height, @duration_sec, @taken_at, @created_at,
    @camera_make, @camera_model, @lens_model, @focal_length, @aperture, @shutter_speed, @iso,
    @gps_lat, @gps_lng, @location_name, @is_favorite, 0, @thumb_400, @thumb_1600, @dominant_color
  )
`);

// Tracks normalized paths currently being ingested so mount watchers do not race active uploads
const inFlightPaths = new Set<string>();

export function isPathBeingIngested(filePath: string): boolean {
  return inFlightPaths.has(path.resolve(filePath));
}

/**
 * Resolves a clean, collision-safe destination path directly inside config.uploadDir
 * without overwriting any existing file.
 */
function resolveUniqueUploadPath(uploadDir: string, safeName: string, ext: string): string {
  fs.mkdirSync(uploadDir, { recursive: true });
  const currentExt = path.extname(safeName);
  const rawStem = currentExt ? safeName.slice(0, -currentExt.length) : safeName;
  const stem = rawStem.trim() || 'media';

  let candidate = assertSafePathWithin(path.join(uploadDir, `${stem}${ext}`), uploadDir);
  if (!fs.existsSync(candidate) && !inFlightPaths.has(candidate)) {
    return candidate;
  }

  for (let i = 1; i <= 1000; i++) {
    candidate = assertSafePathWithin(path.join(uploadDir, `${stem} (${i})${ext}`), uploadDir);
    if (!fs.existsSync(candidate) && !inFlightPaths.has(candidate)) {
      return candidate;
    }
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  return assertSafePathWithin(path.join(uploadDir, `${stem}-${suffix}${ext}`), uploadDir);
}

export async function ingestMediaFile(params: {
  sourcePath: string;
  originalFilename: string;
  sourceType: 'upload' | 'mount';
  mountId?: string | null;
  precomputedSha256?: string;
  overrides?: IngestOverrides;
}): Promise<IngestResult> {
  const safeName = sanitizeFilename(params.originalFilename);
  const classified = classifyMediaExtension(safeName);
  if (!classified) {
    throw new Error(`Unsupported media file extension: ${safeName}`);
  }

  const resolvedSourcePath = path.resolve(params.sourcePath);
  const existingByPath = findByPathStmt.get(resolvedSourcePath) as MediaRow | undefined;
  if (existingByPath) {
    return { media: existingByPath, duplicate: true };
  }

  const stat = fs.statSync(resolvedSourcePath);
  const sha256 = params.precomputedSha256 || (await computeFileSha256(resolvedSourcePath));

  const existing = findByShaStmt.get(sha256) as MediaRow | undefined;
  if (existing) {
    return { media: existing, duplicate: true };
  }

  let finalPath = resolvedSourcePath;
  const trackedPaths: string[] = [resolvedSourcePath];
  inFlightPaths.add(resolvedSourcePath);

  try {
    if (params.sourceType === 'upload') {
      finalPath = resolveUniqueUploadPath(config.uploadDir, safeName, classified.ext);
      trackedPaths.push(finalPath);
      inFlightPaths.add(finalPath);

      if (resolvedSourcePath !== finalPath) {
        try {
          fs.renameSync(resolvedSourcePath, finalPath);
        } catch {
          fs.copyFileSync(resolvedSourcePath, finalPath, fs.constants.COPYFILE_EXCL);
          try {
            fs.unlinkSync(resolvedSourcePath);
          } catch {
            // ignore cleanup failure
          }
        }
      }
    }

  let meta: ExtractedMeta = {
    width: 1600,
    height: 1200,
    durationSec: null,
    takenAt: stat.mtime.toISOString(),
    cameraMake: null,
    cameraModel: null,
    lensModel: null,
    focalLength: null,
    aperture: null,
    shutterSpeed: null,
    iso: null,
    gpsLat: null,
    gpsLng: null,
    dominantColor: '#1e293b',
  };

  let thumb400: string | null = null;
  let thumb1600: string | null = null;

  if (classified.mediaType === 'image') {
    meta = await extractImageMetadata(finalPath, stat.mtime);
    try {
      const thumbs = await generateWebpThumbsFromImage(finalPath, sha256);
      thumb400 = thumbs.thumb400;
      thumb1600 = thumbs.thumb1600;
      if (thumbs.dominantColor) meta.dominantColor = thumbs.dominantColor;
    } catch (err) {
      console.warn(`Thumbnail generation failed for image ${safeName}:`, err);
    }
  } else {
    try {
      const probed = await probeVideo(finalPath);
      const videoStream = probed.streams.find((s) => s.codec_type === 'video');
      if (videoStream?.width && videoStream?.height) {
        meta.width = videoStream.width;
        meta.height = videoStream.height;
      }
      if (probed.format?.duration && Number.isFinite(Number(probed.format.duration))) {
        meta.durationSec = Number(Number(probed.format.duration).toFixed(2));
      }
      const tags = (probed.format?.tags || {}) as Record<string, string>;
      if (tags.creation_time) {
        const parsed = new Date(tags.creation_time);
        if (!Number.isNaN(parsed.getTime())) {
          meta.takenAt = parsed.toISOString();
        }
      }
      if (tags.make) meta.cameraMake = tags.make;
      if (tags.model) meta.cameraModel = tags.model;
    } catch (err) {
      console.warn(`ffprobe metadata failed for video ${safeName}:`, err);
    }

    const tempPoster = path.join(config.tmpDir, `poster-${sha256}.png`);
    try {
      await extractVideoPosterFrame(finalPath, tempPoster);
      if (fs.existsSync(tempPoster)) {
        const thumbs = await generateWebpThumbsFromImage(tempPoster, sha256);
        thumb400 = thumbs.thumb400;
        thumb1600 = thumbs.thumb1600;
        if (thumbs.dominantColor) meta.dominantColor = thumbs.dominantColor;
      }
    } catch (err) {
      console.warn(`Video thumbnail extraction failed for ${safeName}:`, err);
    } finally {
      if (fs.existsSync(tempPoster)) {
        try {
          fs.unlinkSync(tempPoster);
        } catch {
          // ignore
        }
      }
    }
  }

  const ov = params.overrides;
  const nowIso = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = {
    id,
    sha256,
    filename: safeName,
    source_type: params.sourceType,
    mount_id: params.mountId ?? null,
    file_path: finalPath,
    mime_type: classified.mimeType,
    media_type: classified.mediaType,
    size_bytes: stat.size,
    width: meta.width,
    height: meta.height,
    duration_sec: meta.durationSec,
    taken_at: ov?.takenAt ?? meta.takenAt,
    created_at: nowIso,
    camera_make: ov?.cameraMake !== undefined ? ov.cameraMake : meta.cameraMake,
    camera_model: ov?.cameraModel !== undefined ? ov.cameraModel : meta.cameraModel,
    lens_model: ov?.lensModel !== undefined ? ov.lensModel : meta.lensModel,
    focal_length: ov?.focalLength !== undefined ? ov.focalLength : meta.focalLength,
    aperture: ov?.aperture !== undefined ? ov.aperture : meta.aperture,
    shutter_speed: ov?.shutterSpeed !== undefined ? ov.shutterSpeed : meta.shutterSpeed,
    iso: ov?.iso !== undefined ? ov.iso : meta.iso,
    gps_lat: ov?.gpsLat !== undefined ? ov.gpsLat : meta.gpsLat,
    gps_lng: ov?.gpsLng !== undefined ? ov.gpsLng : meta.gpsLng,
    location_name: ov?.locationName !== undefined ? ov.locationName : null,
    is_favorite: ov?.isFavorite ? 1 : 0,
    thumb_400: thumb400,
    thumb_1600: thumb1600,
    dominant_color: meta.dominantColor,
  };

    try {
      insertMediaStmt.run(row);
    } catch (err) {
      // Handle concurrent ingest of the same file gracefully without overwriting source_type
      const raceExisting = findByShaStmt.get(sha256) as MediaRow | undefined;
      if (raceExisting) {
        return { media: raceExisting, duplicate: true };
      }
      throw err;
    }

    const inserted = db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow;
    return { media: inserted, duplicate: false };
  } finally {
    for (const p of trackedPaths) {
      inFlightPaths.delete(p);
    }
  }
}

function createDemoVideoFromImage(imagePath: string, outputMp4Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .loop(5)
      .videoCodec('libx264')
      .outputOptions([
        '-t 5',
        '-pix_fmt yuv420p',
        '-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,zoompan=z=\'min(zoom+0.0012,1.12)\':d=125:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1280x720',
        '-movflags +faststart',
      ])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputMp4Path);
  });
}

export async function seedInitialGalleryIfEmpty(): Promise<void> {
  if (!config.seedDemoMedia) return;
  const countRow = db.prepare('SELECT COUNT(*) as count FROM media').get() as { count: number };
  if (countRow.count > 0) return;

  const assetsDir = path.resolve(process.cwd(), 'src', 'assets', 'images');
  if (!fs.existsSync(assetsDir)) return;

  const sampleSpecs: Array<{
    filePrefix: string;
    filename: string;
    overrides: IngestOverrides;
  }> = [
    {
      filePrefix: 'sample_alpine_sunrise_',
      filename: 'Dolomites_Tre_Cime_Sunrise.jpg',
      overrides: {
        takenAt: '2026-11-12T06:42:18.000Z',
        cameraMake: 'Leica Camera AG',
        cameraModel: 'Leica Q3',
        lensModel: 'Summilux 28mm f/1.7 ASPH.',
        focalLength: '28mm',
        aperture: 'f/5.6',
        shutterSpeed: '1/250s',
        iso: 100,
        gpsLat: 46.6187,
        gpsLng: 12.3027,
        locationName: 'Dolomites, Italy',
        isFavorite: true,
      },
    },
    {
      filePrefix: 'sample_kyoto_alley_',
      filename: 'Kyoto_Ninenzaka_BlueHour.jpg',
      overrides: {
        takenAt: '2026-10-28T18:19:05.000Z',
        cameraMake: 'FUJIFILM',
        cameraModel: 'X-T5',
        lensModel: 'XF35mmF1.4 R',
        focalLength: '35mm',
        aperture: 'f/2.0',
        shutterSpeed: '1/60s',
        iso: 800,
        gpsLat: 34.9977,
        gpsLng: 135.7808,
        locationName: 'Kyoto, Japan',
        isFavorite: true,
      },
    },
    {
      filePrefix: 'sample_coastal_cliffs_',
      filename: 'Big_Sur_Pacific_Overlook.jpg',
      overrides: {
        takenAt: '2026-10-14T17:48:32.000Z',
        cameraMake: 'Hasselblad',
        cameraModel: 'X2D 100C',
        lensModel: 'XCD 2,5/38V',
        focalLength: '38mm',
        aperture: 'f/8',
        shutterSpeed: '1/500s',
        iso: 64,
        gpsLat: 36.2704,
        gpsLng: -121.8081,
        locationName: 'Big Sur, California',
        isFavorite: false,
      },
    },
    {
      filePrefix: 'sample_brutalist_arch_',
      filename: 'Zurich_Kunsthaus_Atrium.jpg',
      overrides: {
        takenAt: '2026-09-21T14:35:11.000Z',
        cameraMake: 'SONY',
        cameraModel: 'ILCE-7CR',
        lensModel: 'FE 24mm F1.4 GM',
        focalLength: '24mm',
        aperture: 'f/4',
        shutterSpeed: '1/320s',
        iso: 200,
        gpsLat: 47.3702,
        gpsLng: 8.5482,
        locationName: 'Zurich, Switzerland',
        isFavorite: false,
      },
    },
    {
      filePrefix: 'sample_nordic_fjord_',
      filename: 'Lofoten_Reine_MirrorFjord.jpg',
      overrides: {
        takenAt: '2026-08-19T21:14:40.000Z',
        cameraMake: 'NIKON CORPORATION',
        cameraModel: 'NIKON Z 8',
        lensModel: 'NIKKOR Z 24-70mm f/2.8 S',
        focalLength: '26mm',
        aperture: 'f/5.6',
        shutterSpeed: '1/125s',
        iso: 160,
        gpsLat: 67.9325,
        gpsLng: 13.0886,
        locationName: 'Lofoten, Norway',
        isFavorite: true,
      },
    },
    {
      filePrefix: 'sample_espresso_macro_',
      filename: 'Lisbon_Chiado_Morning_Espresso.jpg',
      overrides: {
        takenAt: '2026-07-08T09:11:27.000Z',
        cameraMake: 'Leica Camera AG',
        cameraModel: 'Leica M11',
        lensModel: 'APO-Summicron-M 50mm f/2',
        focalLength: '50mm',
        aperture: 'f/2.4',
        shutterSpeed: '1/160s',
        iso: 400,
        gpsLat: 38.7106,
        gpsLng: -9.1422,
        locationName: 'Lisbon, Portugal',
        isFavorite: false,
      },
    },
  ];

  const availableFiles = fs.readdirSync(assetsDir);
  const ingestedIds: Record<string, string> = {};
  let fjordSourcePath: string | null = null;

  for (const spec of sampleSpecs) {
    const match = availableFiles.find((f) => f.startsWith(spec.filePrefix));
    if (!match) continue;
    const srcPath = path.join(assetsDir, match);
    if (spec.filePrefix === 'sample_nordic_fjord_') fjordSourcePath = srcPath;
    const tmpCopy = path.join(config.tmpDir, `seed-${spec.filename}`);
    fs.copyFileSync(srcPath, tmpCopy);
    try {
      const result = await ingestMediaFile({
        sourcePath: tmpCopy,
        originalFilename: spec.filename,
        sourceType: 'upload',
        overrides: spec.overrides,
      });
      ingestedIds[spec.filePrefix] = result.media.id;
    } catch (err) {
      console.warn(`Seed photo ingest failed for ${spec.filename}:`, err);
    }
  }

  // Generate a real 5-second MP4 video clip using ffmpeg so HTTP Range video streaming works out of the box
  if (fjordSourcePath) {
    const tmpMp4 = path.join(config.tmpDir, 'seed-Lofoten_Fjord_Timelapse.mp4');
    try {
      await createDemoVideoFromImage(fjordSourcePath, tmpMp4);
      const vidResult = await ingestMediaFile({
        sourcePath: tmpMp4,
        originalFilename: 'Lofoten_Fjord_Timelapse.mp4',
        sourceType: 'upload',
        overrides: {
          takenAt: '2026-08-19T21:20:00.000Z',
          cameraMake: 'NIKON CORPORATION',
          cameraModel: 'NIKON Z 8',
          lensModel: 'NIKKOR Z 24-70mm f/2.8 S',
          focalLength: '26mm',
          gpsLat: 67.9325,
          gpsLng: 13.0886,
          locationName: 'Lofoten, Norway',
          isFavorite: false,
        },
      });
      ingestedIds['sample_video_'] = vidResult.media.id;
    } catch (err) {
      console.warn('Could not create sample video clip with ffmpeg:', err);
    }
  }

  // Create curated virtual albums from seeded media
  const now = new Date().toISOString();
  const album1Id = crypto.randomUUID();
  const album2Id = crypto.randomUUID();
  const insertAlbum = db.prepare(
    'INSERT INTO albums (id, title, description, cover_media_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertAlbumMedia = db.prepare(
    'INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?, ?, ?)'
  );

  const alpineId = ingestedIds['sample_alpine_sunrise_'];
  const fjordId = ingestedIds['sample_nordic_fjord_'];
  const coastId = ingestedIds['sample_coastal_cliffs_'];
  const videoId = ingestedIds['sample_video_'];
  const kyotoId = ingestedIds['sample_kyoto_alley_'];
  const zurichId = ingestedIds['sample_brutalist_arch_'];
  const lisbonId = ingestedIds['sample_espresso_macro_'];

  if (alpineId || fjordId || coastId) {
    insertAlbum.run(
      album1Id,
      'Alpine & Coastal Horizons',
      'Landscape expeditions across the Dolomites, Lofoten fjords, and Big Sur.',
      alpineId || fjordId || coastId || null,
      now,
      now
    );
    for (const id of [alpineId, fjordId, coastId, videoId]) {
      if (id) insertAlbumMedia.run(album1Id, id, now);
    }
  }

  if (kyotoId || zurichId || lisbonId) {
    insertAlbum.run(
      album2Id,
      'Urban Architecture & Cafes',
      'Street studies, concrete light shafts, and morning rituals in Kyoto, Zurich, and Lisbon.',
      kyotoId || zurichId || lisbonId || null,
      now,
      now
    );
    for (const id of [kyotoId, zurichId, lisbonId]) {
      if (id) insertAlbumMedia.run(album2Id, id, now);
    }
  }
}

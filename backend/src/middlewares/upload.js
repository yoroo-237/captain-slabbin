import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

// Configure Cloudinary if credentials are present
if (env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key:    env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
  });
}

// Always use memory storage — files go to Cloudinary, not disk
const memStorage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported format (jpg, png, webp, gif only)'));
};

const mediaFilter = (req, file, cb) => {
  const images = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const videos = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
  if (images.includes(file.mimetype) || videos.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Unsupported format (jpg, png, webp, gif, mp4, webm, mov, avi allowed)'));
};

export const upload = multer({
  storage:    memStorage,
  limits:     { fileSize: env.maxFileSize },
  fileFilter: imageFilter,
});

export const uploadMedia = multer({
  storage:    memStorage,
  limits:     { fileSize: 100 * 1024 * 1024 },
  fileFilter: mediaFilter,
});

// Upload a buffer to Cloudinary and return { url, thumbnail }
export async function uploadToCloudinary(buffer, mimetype, folder = 'botb') {
  const isVideo    = mimetype.startsWith('video/');
  const resourceType = isVideo ? 'video' : 'image';

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url:       result.secure_url,
          thumbnail: isVideo
            ? result.secure_url.replace('/upload/', '/upload/so_0,w_400,h_400,c_fill,f_jpg/')
            : result.secure_url.replace('/upload/', '/upload/w_400,h_400,c_fill,f_auto,q_auto/'),
        });
      },
    );
    stream.end(buffer);
  });
}

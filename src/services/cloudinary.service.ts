import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dzew4prjo',
  api_key: process.env.CLOUDINARY_API_KEY || '463417784788454',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'qa1i5hniiTzY7icIcKNpl9xi1Pk',
  secure: true,
});

/**
 * Upload a local file to Cloudinary and delete the local file on success.
 * Returns the secure HTTPS URL and metadata.
 */
export const uploadToCloudinary = async (
  filePath: string,
  folder: string = 'omnihr',
  deleteLocalOnSuccess: boolean = true
): Promise<UploadApiResponse> => {
  try {
    const isPdf = filePath.toLowerCase().endsWith('.pdf');
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: isPdf ? 'raw' : 'auto',
      use_filename: true,
      unique_filename: true,
    });

    if (deleteLocalOnSuccess && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn('[Cloudinary] Could not remove temporary local file:', err);
      }
    }

    return result;
  } catch (error) {
    console.error('[Cloudinary] Upload failed:', error);
    throw error;
  }
};

/**
 * Delete a file from Cloudinary by its public_id or URL.
 */
export const deleteFromCloudinary = async (publicIdOrUrl: string): Promise<any> => {
  try {
    if (!publicIdOrUrl) return;
    
    // If a full Cloudinary URL is passed, extract the public_id
    let publicId = publicIdOrUrl;
    if (publicIdOrUrl.includes('cloudinary.com')) {
      const parts = publicIdOrUrl.split('/upload/');
      if (parts.length > 1) {
        // e.g. v1234567890/omnihr/profile_pictures/abc.jpg -> omnihr/profile_pictures/abc
        const pathAfterUpload = parts[1].replace(/^v\d+\//, '');
        publicId = pathAfterUpload.replace(/\.[^/.]+$/, '');
      }
    }

    return await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('[Cloudinary] Delete error:', error);
  }
};

export default cloudinary;

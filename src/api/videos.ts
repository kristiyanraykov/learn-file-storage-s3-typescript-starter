import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "path";
import { randomBytes } from "crypto";
import { getVideoAspectRatio } from "./assets";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024; // 1GB

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading video", videoId, "by user", userID);
  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Invalid file");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }
  if (mediaType !== "video/mp4") {
    throw new BadRequestError("Invalid Content-Type for video");
  }

  const buffer = await file.arrayBuffer();

  if (buffer.byteLength > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File too large");
  }

  const video = getVideo(cfg.db, videoId);
  if (video?.userID !== userID) {
    throw new UserForbiddenError(
      "User not allowed to upload thumbnail for this video",
    );
  }

  const fileData = await file.arrayBuffer();
  if (!fileData) {
    throw new Error("Error reading file data");
  }

  const fileName = randomBytes(32).toString("base64url");
  const fullFileName = `${fileName}.${mediaType.split("/")[1]}`;
  const filePath = path.join("assets", fullFileName);

  try {
    await Bun.write(filePath, fileData);
  } catch (error) {
    throw new Error("Error writing file");
  }

  const orientation = await getVideoAspectRatio(filePath);
  const s3Path = `${orientation}/${fullFileName}`;

  await cfg.s3Client?.write(s3Path, Bun.file(filePath), {
    type: mediaType,
  });

  const videoUrl = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Path}`;
  video.videoURL = videoUrl;

  updateVideo(cfg.db, video);

  await Bun.file(filePath)
    .unlink()
    .catch((err) => {
      console.error("Error deleting file:", err);
    });

  return respondWithJSON(200, video);
}

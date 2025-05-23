import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const videoThumbnails: Map<string, Thumbnail> = new Map();
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);
  const formData = await req.formData();
  const file = formData.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("Invalid file");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }
  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("Invalid Content-Type for thumbnail");
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

  const filePath = path.join(
    "assets",
    `${randomBytes(32).toString("base64url")}.${mediaType.split("/")[1]}`,
  );

  video.thumbnailURL = filePath;

  try {
    Bun.write(filePath, fileData);
  } catch (error) {
    throw new Error("Error writing file");
  }
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}

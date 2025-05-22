import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";
import { S3Client } from "bun";
import type { Video } from "../db/videos";

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

type VideoAspectRatio = "landscape" | "portrait" | "other";
const calculateAspectRatio = (
  width: number,
  height: number,
): VideoAspectRatio => {
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.1) {
    return "landscape";
  } else if (Math.abs(ratio - 9 / 16) < 0.1) {
    return "portrait";
  }
  return "other";
};

export async function getVideoAspectRatio(
  filePath: string,
): Promise<VideoAspectRatio> {
  const subprocess = Bun.spawn({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const { stdout, stderr } = subprocess;
  const output = await Bun.readableStreamToText(stdout);
  const error = await Bun.readableStreamToText(stderr);
  if (error) {
    throw new Error(`Error getting video aspect ratio: ${error}`);
  }
  const data = JSON.parse(output);
  const { width, height } = data.streams[0];

  if (!width || !height) {
    return "other";
  }

  return calculateAspectRatio(Number(width), Number(height));
}

export async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath.replace(/\.mp4$/, "_processed.mp4");
  const subprocess = Bun.spawn({
    cmd: [
      "ffmpeg",
      "-y", // Automatically overwrite output files
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      "-loglevel", // Only log actual errors
      "error",
      outputFilePath,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await subprocess.exited;

  if (exitCode !== 0) {
    const errorOutput = await Bun.readableStreamToText(subprocess.stderr);
    throw new Error(
      `Error processing video for fast start (exit code ${exitCode}): ${errorOutput.trim()}`,
    );
  }
  return outputFilePath;
}

async function generatePresignedURL(
  cfg: ApiConfig,
  key: string,
  expireTime: number,
) {
  return cfg.s3Client.presign(key, {
    expiresIn: expireTime,
  });
}

export async function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  if (!video.videoURL) {
    return video;
  }

  const presignedURL = await generatePresignedURL(
    cfg,
    video.videoURL,
    60 * 60, // 1 hour
  );
  return {
    ...video,
    videoURL: presignedURL,
  };
}

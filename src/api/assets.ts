import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";

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

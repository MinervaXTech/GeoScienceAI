import { PNG } from "pngjs";
import type { EnhancementSettings } from "../src/geo/muse.ts";

export function validateEnhancement(value: unknown): EnhancementSettings {
  if (!value || typeof value !== "object") throw Error("Muse returned invalid enhancement settings.");
  const settings = value as EnhancementSettings;
  for (const [name, min, max] of [["brightness", -25, 25], ["contrast", 0.8, 1.6], ["saturation", 0.5, 1.5], ["sharpen", 0, 1]] as const) {
    if (!Number.isFinite(settings[name]) || settings[name] < min || settings[name] > max) throw Error(`Muse returned an out-of-range ${name} adjustment.`);
  }
  if (typeof settings.reason !== "string" || !settings.reason.trim() || settings.reason.length > 1500) throw Error("Muse did not explain the enhancement.");
  return { brightness: settings.brightness, contrast: settings.contrast, saturation: settings.saturation, sharpen: settings.sharpen, reason: settings.reason };
}

/** Photometric adjustments only. Dimensions, alpha and pixel locations stay fixed. */
export function enhancePng(bytes: Buffer, settings: EnhancementSettings) {
  validateEnhancement(settings);
  const image = PNG.sync.read(bytes, { checkCRC: true });
  const { width, height, data } = image;
  if (width > 1024 || height > 1024) throw Error("Image is too large for enhancement.");
  const adjusted = new Float32Array(width * height * 3);
  const output = Buffer.from(data);
  for (let i = 0; i < width * height; i++) {
    if (!data[i * 4 + 3]) continue;
    const rgb = [0, 1, 2].map((c) => (data[i * 4 + c]! - 128) * settings.contrast + 128 + settings.brightness);
    const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    for (let c = 0; c < 3; c++) adjusted[i * 3 + c] = luminance + (rgb[c]! - luminance) * settings.saturation;
  }
  let changedPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!data[i * 4 + 3]) continue;
    let changed = false;
    for (let c = 0; c < 3; c++) {
      let sum = 0, weight = 0;
      if (settings.sharpen) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const j = ny * width + nx, alpha = data[j * 4 + 3]! / 255;
        sum += adjusted[j * 3 + c]! * alpha; weight += alpha;
      }
      const value = adjusted[i * 3 + c]!;
      output[i * 4 + c] = Math.max(0, Math.min(255, Math.round(value + (weight ? settings.sharpen * (value - sum / weight) : 0))));
      changed ||= output[i * 4 + c] !== data[i * 4 + c];
    }
    if (changed) changedPixels++;
  }
  image.data = output;
  return { bytes: PNG.sync.write(image), width, height, changedPixels };
}

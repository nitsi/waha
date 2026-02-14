import { AvailableInPlusVersion } from '../exceptions';

import { execFile } from 'child_process';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface IMediaConverter {
  voice(content: Buffer): Promise<Buffer>;
  video(content: Buffer): Promise<Buffer>;
}

export class CoreMediaConverter implements IMediaConverter {
  video(content: Buffer): Promise<Buffer> {
    throw new AvailableInPlusVersion();
  }

  voice(content: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Create temporary files for ffmpeg input/output
      const tmpDir = os.tmpdir();
      const inputPath = path.join(tmpDir, `waha-voice-in-${Date.now()}`);
      const outputPath = path.join(tmpDir, `waha-voice-out-${Date.now()}.opus`);

      // Write input buffer to temp file
      fs.writeFileSync(inputPath, content);

      // Convert to opus using ffmpeg
      execFile(
        'ffmpeg',
        [
          '-i', inputPath,
          '-y',             // Overwrite output file
          '-vn',            // No video
          '-acodec', 'libopus',
          '-ac', '1',       // Mono
          '-ar', '48000',   // 48kHz sample rate
          '-b:a', '128k',   // Audio bitrate
          '-f', 'ogg',      // Output format
          outputPath,
        ],
        (error) => {
          // Clean up input file
          try {
            fs.unlinkSync(inputPath);
          } catch {
            // ignore cleanup errors
          }

          if (error) {
            // Clean up output file on error
            try {
              fs.unlinkSync(outputPath);
            } catch {
              // ignore cleanup errors
            }
            reject(
              new Error(`ffmpeg voice conversion failed: ${error.message}`),
            );
            return;
          }

          try {
            const result = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            resolve(result);
          } catch (readError) {
            reject(
              new Error(
                `Failed to read ffmpeg output: ${(readError as Error).message}`,
              ),
            );
          }
        },
      );
    });
  }
}

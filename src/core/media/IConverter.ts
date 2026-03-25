import { AvailableInPlusVersion } from '../exceptions';

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface IMediaConverter {
  voice(content: Buffer): Promise<Buffer>;
  video(content: Buffer): Promise<Buffer>;
}

/**
 * Detect audio format from magic bytes and return the corresponding
 * file extension so ffmpeg can identify the input format reliably.
 */
export function detectAudioExtension(buffer: Buffer): string {
  if (buffer.length < 12) {
    return '';
  }
  // ID3 tag (MP3 with metadata)
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return '.mp3';
  }
  // MP3 sync word
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return '.mp3';
  }
  // OGG
  if (buffer.toString('ascii', 0, 4) === 'OggS') {
    return '.ogg';
  }
  // RIFF / WAV
  if (buffer.toString('ascii', 0, 4) === 'RIFF') {
    return '.wav';
  }
  // FLAC
  if (buffer.toString('ascii', 0, 4) === 'fLaC') {
    return '.flac';
  }
  // ftyp box (M4A / AAC / MP4)
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    return '.m4a';
  }
  // WebM / MKV (EBML header)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return '.webm';
  }
  // AMR
  if (buffer.toString('ascii', 0, 5) === '#!AMR') {
    return '.amr';
  }
  return '';
}

export class CoreMediaConverter implements IMediaConverter {
  video(content: Buffer): Promise<Buffer> {
    throw new AvailableInPlusVersion();
  }

  voice(content: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const tmpDir = os.tmpdir();
      const timestamp = Date.now();
      const ext = detectAudioExtension(content);
      const inputPath = path.join(tmpDir, `waha-voice-in-${timestamp}${ext}`);
      const outputPath = path.join(
        tmpDir,
        `waha-voice-out-${timestamp}.opus`,
      );

      // Write input buffer to temp file (with detected extension so
      // ffmpeg can identify the format reliably).
      fs.writeFileSync(inputPath, content);

      const ffmpeg = spawn('ffmpeg', [
        '-i',
        inputPath,
        '-y', // Overwrite output file
        '-vn', // No video
        '-acodec',
        'libopus',
        '-b:a',
        '128k', // Audio bitrate
        '-vbr',
        'on',
        '-compression_level',
        '10',
        '-frame_duration',
        '20',
        '-application',
        'voip',
        '-ac',
        '1', // Mono
        '-ar',
        '48000', // 48kHz sample rate
        '-f',
        'ogg', // Output format
        outputPath,
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('error', (error) => {
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // ignore cleanup errors
        }
        try {
          fs.unlinkSync(outputPath);
        } catch {
          // ignore cleanup errors
        }
        reject(new Error(`ffmpeg voice conversion failed: ${error.message}`));
      });

      ffmpeg.on('close', (code) => {
        // Clean up input file
        try {
          fs.unlinkSync(inputPath);
        } catch {
          // ignore cleanup errors
        }

        if (code !== 0) {
          // Clean up output file on error
          try {
            fs.unlinkSync(outputPath);
          } catch {
            // ignore cleanup errors
          }
          // Include last 500 chars of stderr for diagnostics
          const stderrTail = stderr.slice(-500);
          reject(
            new Error(
              `ffmpeg voice conversion failed (exit code ${code}): ${stderrTail}`,
            ),
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
      });
    });
  }
}

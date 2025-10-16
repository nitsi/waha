import { AvailableInPlusVersion } from '../exceptions';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface IMediaConverter {
  voice(content: Buffer): Promise<Buffer>;
  video(content: Buffer): Promise<Buffer>;
}

export class CoreMediaConverter implements IMediaConverter {
  video(content: Buffer): Promise<Buffer> {
    throw new AvailableInPlusVersion();
  }

  async voice(content: Buffer): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waha-voice-'));
    const inputPath = path.join(tmpDir, `input-${randomUUID()}`);
    const outputPath = path.join(tmpDir, `output-${randomUUID()}.opus`);

    try {
      await fs.writeFile(inputPath, content);
      await this.runFfmpeg([
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-ar',
        '48000',
        '-ac',
        '1',
        outputPath,
      ]);

      return await fs.readFile(outputPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown ffmpeg error';
      throw new Error(`Failed to convert voice message: ${message}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
        // Ignore cleanup errors
      });
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';

      process.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      process.on('error', (err) => {
        reject(
          new Error(`Failed to start ffmpeg process: ${err.message || err}`),
        );
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `ffmpeg exited with code ${code}: ${
                stderr.trim() || 'no stderr output'
              }`,
            ),
          );
        }
      });
    });
  }
}

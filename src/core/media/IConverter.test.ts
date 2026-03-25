import { detectAudioExtension } from './IConverter';

describe('detectAudioExtension', () => {
  it('should detect MP3 with ID3 tag', () => {
    // ID3v2 header: 0x49 0x44 0x33
    const buffer = Buffer.alloc(16);
    buffer[0] = 0x49; // 'I'
    buffer[1] = 0x44; // 'D'
    buffer[2] = 0x33; // '3'
    expect(detectAudioExtension(buffer)).toBe('.mp3');
  });

  it('should detect MP3 sync word', () => {
    // MP3 frame sync: 0xFF followed by 0xFB/0xF3/0xF2
    const buffer = Buffer.alloc(16);
    buffer[0] = 0xff;
    buffer[1] = 0xfb;
    expect(detectAudioExtension(buffer)).toBe('.mp3');
  });

  it('should detect OGG', () => {
    const buffer = Buffer.from('OggS' + '\0'.repeat(12));
    expect(detectAudioExtension(buffer)).toBe('.ogg');
  });

  it('should detect WAV', () => {
    const buffer = Buffer.from('RIFF' + '\0'.repeat(12));
    expect(detectAudioExtension(buffer)).toBe('.wav');
  });

  it('should detect FLAC', () => {
    const buffer = Buffer.from('fLaC' + '\0'.repeat(12));
    expect(detectAudioExtension(buffer)).toBe('.flac');
  });

  it('should detect M4A/AAC (ftyp box)', () => {
    const buffer = Buffer.alloc(16);
    // ftyp at offset 4
    buffer.write('ftyp', 4, 'ascii');
    expect(detectAudioExtension(buffer)).toBe('.m4a');
  });

  it('should detect WebM (EBML header)', () => {
    const buffer = Buffer.alloc(16);
    buffer[0] = 0x1a;
    buffer[1] = 0x45;
    buffer[2] = 0xdf;
    buffer[3] = 0xa3;
    expect(detectAudioExtension(buffer)).toBe('.webm');
  });

  it('should detect AMR', () => {
    const buffer = Buffer.from('#!AMR' + '\0'.repeat(12));
    expect(detectAudioExtension(buffer)).toBe('.amr');
  });

  it('should return empty string for unknown format', () => {
    const buffer = Buffer.alloc(16);
    expect(detectAudioExtension(buffer)).toBe('');
  });

  it('should return empty string for too-small buffer', () => {
    const buffer = Buffer.alloc(5);
    expect(detectAudioExtension(buffer)).toBe('');
  });
});

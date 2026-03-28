import axios from 'axios';
import { Agent as HttpsAgent } from 'https';
// @ts-ignore
import * as UserAgent from 'user-agents';

const InsecureHttpsAgent = new HttpsAgent({
  rejectUnauthorized: false,
});

export async function fetchBuffer(url: string): Promise<Buffer> {
  const userAgent = new UserAgent();
  return axios
    .get(url, {
      responseType: 'arraybuffer',
      httpsAgent: InsecureHttpsAgent,
      timeout: 120000,
      headers: {
        'User-Agent': userAgent.toString(),
      },
    })
    .then((res) => {
      return Buffer.from(res.data);
    });
}

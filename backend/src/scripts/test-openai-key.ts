import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

function maskKey(key: string): string {
  if (key.length <= 12) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

async function main() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();

  if (!apiKey || apiKey === 'dummy-key') {
    console.error('OPENAI_API_KEY is missing or set to dummy-key.');
    process.exit(1);
  }

  console.log(`Testing OpenAI key: ${maskKey(apiKey)}`);

  try {
    const client = new OpenAI({ apiKey });
    const result = await client.models.list();
    const modelCount = Array.isArray((result as any).data) ? (result as any).data.length : 0;
    console.log(`OpenAI key is valid. Models visible: ${modelCount}`);
    process.exit(0);
  } catch (error: any) {
    const status = error?.status || error?.response?.status || 'unknown';
    const message = error?.message || 'Unknown OpenAI error';
    console.error(`OpenAI key test failed (status: ${status}): ${message}`);
    process.exit(2);
  }
}

void main();

